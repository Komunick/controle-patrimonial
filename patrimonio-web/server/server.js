'use strict';
/*
 * Controle Patrimonial — servidor HTTP (base compartilhada).
 * ---------------------------------------------------------------------------
 * Servidor Node puro, SEM dependências externas (não precisa de npm install).
 *  - Serve os arquivos estáticos do app (index.html, app.js, css, assets…).
 *  - Roteia /api/* para a lógica compartilhada do db.js (o mesmo store.js).
 *  - /api/export e /api/import fazem a cópia de segurança no servidor.
 *
 * Os dados ficam num único arquivo no servidor e são compartilhados por todos
 * os operadores que acessam pela rede (ex.: via ZeroTier).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, '..'); // pasta patrimonio-web (arquivos do app)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers) {
  res.writeHead(status, headers || {});
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

// ---------------------------------------------------------------------------
// Termo de entrega de EPI em PDF (gerado aqui mesmo, sem dependências).
// A4 = 595 x 842 pt. Fontes padrão Helvetica com WinAnsi (acentos pt-BR ok).
// ---------------------------------------------------------------------------
const EPI_ANEXOS_DIR = path.join(db.DATA_DIR, 'epi-anexos');
fs.mkdirSync(EPI_ANEXOS_DIR, { recursive: true });
// Fotos de evidência das inspeções 5S — também fora da pasta servida na web.
const INSPECAO_FOTOS_DIR = path.join(db.DATA_DIR, 'inspecao-fotos');
fs.mkdirSync(INSPECAO_FOTOS_DIR, { recursive: true });
const zlib = require('zlib');

// Decodifica um PNG RGB 8 bits (colorType 2, sem entrelaçamento) para RGB cru —
// é o formato do assets/logo.png. Usado para embutir a logo no PDF do termo.
function decodificarPngRgb(buf) {
  let pos = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const tipo = buf.toString('latin1', pos + 4, pos + 8);
    const dados = buf.slice(pos + 8, pos + 8 + len);
    if (tipo === 'IHDR') {
      w = dados.readUInt32BE(0); h = dados.readUInt32BE(4);
      bitDepth = dados[8]; colorType = dados[9]; interlace = dados[12];
    } else if (tipo === 'IDAT') idat.push(dados);
    else if (tipo === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 2 || interlace !== 0) {
    throw new Error('logo.png precisa ser PNG RGB 8 bits sem entrelaçamento');
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 3;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
  };
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const linha = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const o = y * stride;
    for (let x = 0; x < stride; x++) {
      const esq = x >= bpp ? out[o + x - bpp] : 0;
      const cima = y > 0 ? out[o + x - stride] : 0;
      const diag = (y > 0 && x >= bpp) ? out[o + x - bpp - stride] : 0;
      let v = linha[x];
      if (f === 1) v = (v + esq) & 255;
      else if (f === 2) v = (v + cima) & 255;
      else if (f === 3) v = (v + ((esq + cima) >> 1)) & 255;
      else if (f === 4) v = (v + paeth(esq, cima, diag)) & 255;
      out[o + x] = v;
    }
  }
  return { w, h, rgb: out };
}

// Logo carregada uma única vez no boot (se falhar, o PDF sai sem a imagem).
let LOGO_PDF = null;
try {
  const png = decodificarPngRgb(fs.readFileSync(path.join(ROOT, 'assets', 'logo.png')));
  LOGO_PDF = { w: png.w, h: png.h, dados: zlib.deflateSync(png.rgb) };
} catch (e) {
  console.warn('[Controle Patrimonial] logo não embutida no PDF:', e && e.message);
}

function pdfEscape(s) {
  return String(s == null ? '' : s)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/–|—/g, '-').replace(/ /g, ' ')
    .replace(/[^\x20-\x7E¡-ÿ]/g, '?') // fora do latin-1 vira '?'
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
function pdfWrap(texto, maxChars) {
  const palavras = String(texto || '').split(/\s+/);
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    if ((atual + ' ' + p).trim().length > maxChars) { if (atual) linhas.push(atual); atual = p; }
    else atual = (atual ? atual + ' ' : '') + p;
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function gerarTermoPdf(t) {
  const ops = [];
  let y = 800;
  const texto = (x, yy, size, bold, s) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${yy} Td (${pdfEscape(s)}) Tj ET`);
  const linha = (x1, yy, x2) => ops.push(`0.75 w ${x1} ${yy} m ${x2} ${yy} l S`);

  // Cabeçalho: logo da empresa + faixa verde com o título
  if (LOGO_PDF) {
    const lh = 34; // altura da logo em pontos
    const lw = Math.round(lh * (LOGO_PDF.w / LOGO_PDF.h));
    ops.push(`q ${lw} 0 0 ${lh} 50 ${842 - 12 - lh} cm /Im1 Do Q`);
    texto(545 - 118, 812, 9, true, 'CONTROLE PATRIMONIAL');
  }
  ops.push('0.075 0.318 0.180 rg 0 762 595 28 re f'); // faixa verde
  ops.push('0.976 0.690 0.192 rg 0 758 595 4 re f');  // filete âmbar
  ops.push('1 1 1 rg');
  ops.push(`BT /F2 13 Tf 50 770 Td (${pdfEscape('TERMO DE RESPONSABILIDADE E ENTREGA DE EPI')}) Tj ET`);
  ops.push('0 0 0 rg');
  y = 736;
  texto(50, y, 11, true, t.company || 'Brazil Transports'); y -= 14;
  texto(50, y, 9, false, 'Documento gerado pelo Controle Patrimonial — dispensa arquivamento em papel.'); y -= 20;
  linha(50, y, 545); y -= 18;

  texto(50, y, 10, true, 'Colaborador(a):'); texto(135, y, 10, false, t.person_name); y -= 14;
  texto(50, y, 10, true, 'Entregue por:'); texto(135, y, 10, false, `${t.entregue_por} em ${t.created_at}`); y -= 14;
  if (t.obs) { texto(50, y, 10, true, 'Observações:'); texto(135, y, 10, false, t.obs); y -= 14; }
  y -= 8;

  // Tabela de itens
  texto(50, y, 11, true, 'EQUIPAMENTOS ENTREGUES'); y -= 6; linha(50, y, 545); y -= 14;
  texto(55, y, 9, true, 'EPI'); texto(400, y, 9, true, 'CA'); texto(490, y, 9, true, 'QTDE'); y -= 4; linha(50, y, 545); y -= 13;
  for (const it of (t.itens || [])) {
    for (const l of pdfWrap(it.nome, 72)) { texto(55, y, 10, false, l); y -= 13; }
    y += 13;
    texto(400, y, 10, false, it.ca || '—'); texto(490, y, 10, false, String(it.quantidade));
    y -= 6; linha(50, y, 545); y -= 13;
  }
  y -= 6;

  // Declaração
  texto(50, y, 11, true, 'DECLARAÇÃO'); y -= 6; linha(50, y, 545); y -= 14;
  const declaracao = `Declaro que recebi da empresa ${t.company}, gratuitamente, os equipamentos de proteção individual (EPIs) relacionados acima, novos e em perfeitas condições de uso, e que fui orientado(a) quanto ao uso correto, guarda e conservação. Comprometo-me a: usá-los apenas para a finalidade a que se destinam; responsabilizar-me pela guarda e conservação; comunicar qualquer alteração que os torne impróprios para uso; e devolvê-los quando solicitado ou no meu desligamento. Estou ciente de que o descumprimento constitui ato faltoso, nos termos da NR-6.`;
  for (const l of pdfWrap(declaracao, 100)) { texto(50, y, 9.5, false, l); y -= 12; }
  y -= 26;

  // Bloco de assinatura
  linha(70, y, 340); texto(70, y - 12, 9, false, 'Assinatura do(a) colaborador(a)');
  texto(370, y, 10, false, 'Data: ______ / ______ / __________'); y -= 40;
  texto(70, y, 10, false, 'Nome completo: ____________________________________________'); y -= 22;
  texto(70, y, 10, false, 'CPF: ____________________________'); y -= 30;
  texto(50, y, 8, false, `Como confirmar: assine este termo, fotografe ou digitalize em PDF e devolva ao setor financeiro/administrativo,`); y -= 10;
  texto(50, y, 8, false, `que anexará o arquivo assinado à entrega nº ${t.id} no Controle Patrimonial.`);

  const contentStr = ops.join('\n');
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>' +
    (LOGO_PDF ? ' /XObject << /Im1 7 0 R >>' : '') + ' >> /Contents 4 0 R >>';
  objs[4] = `<< /Length ${Buffer.byteLength(contentStr, 'latin1')} >>\nstream\n${contentStr}\nendstream`;
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[6] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  if (LOGO_PDF) {
    objs[7] = `<< /Type /XObject /Subtype /Image /Width ${LOGO_PDF.w} /Height ${LOGO_PDF.h} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${LOGO_PDF.dados.length} >>\n` +
      `stream\n${LOGO_PDF.dados.toString('latin1')}\nendstream`;
  }

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// ---------------------------------------------------------------------------
// Tempo real (Server-Sent Events): avisa os navegadores quando os dados mudam.
// ---------------------------------------------------------------------------
const sseClients = new Set();
let revision = 0;

function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');   // navegador reconecta em 3s se a conexão cair
  res.write(': conectado\n\n');
  sseClients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* ignore */ } }, 25000);
  const done = () => { clearInterval(ping); sseClients.delete(res); };
  req.on('close', done);
  req.on('error', done);
}

function broadcast(evt) {
  const payload = 'data: ' + JSON.stringify(evt) + '\n\n';
  for (const res of sseClients) {
    try { res.write(payload); } catch (e) { sseClients.delete(res); }
  }
}

function notifyChange(urlPath, method, operator, req) {
  revision += 1;
  broadcast({ rev: revision, path: urlPath, method, by: operator, origin: req.headers['x-client-id'] || null });
}

function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { return send(res, 400, 'Bad request'); }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const filePath = path.normalize(path.join(ROOT, urlPath));
  // Bloqueia path traversal (../) para fora da pasta do app.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden');
  }
  // Não expor código/infra do servidor pela web (só os arquivos do app).
  const blocked = [path.join(ROOT, 'server'), path.join(ROOT, 'store.js')];
  if (blocked.some((b) => filePath === b || filePath.startsWith(b + path.sep))) {
    return send(res, 403, 'Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Não encontrado');
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  });
}

// ---------------------------------------------------------------------------
// Planilha (XLSX) do relatório de inspeções — gerada aqui mesmo, sem
// dependências: montamos o pacote OOXML (um zip com XMLs) na mão, com duas
// abas e gráficos de barras nativos do Excel.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

// Zip com compressão deflate (zlib) — o suficiente para o Excel abrir.
function ziparPartes(partes) { // [{ nome, xml }] → Buffer
  const agora = new Date();
  const dosData = (((agora.getFullYear() - 1980) & 0x7F) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  const dosHora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | Math.floor(agora.getSeconds() / 2);
  const blocos = [];
  const centrais = [];
  let offset = 0;
  for (const p of partes) {
    const nome = Buffer.from(p.nome, 'utf8');
    const dados = Buffer.from(p.xml, 'utf8');
    const comp = zlib.deflateRawSync(dados);
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // versão mínima
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(8, 8);             // método: deflate
    local.writeUInt16LE(dosHora, 10);
    local.writeUInt16LE(dosData, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);            // extra
    blocos.push(local, nome, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);          // feita por
    central.writeUInt16LE(20, 6);          // versão mínima
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosHora, 12);
    central.writeUInt16LE(dosData, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nome.length, 28);
    // demais campos (extra/comentário/disco/atributos) ficam zerados
    central.writeUInt32LE(offset, 42);
    centrais.push(Buffer.concat([central, nome]));
    offset += 30 + nome.length + comp.length;
  }
  const dirCentral = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(partes.length, 8);
  fim.writeUInt16LE(partes.length, 10);
  fim.writeUInt32LE(dirCentral.length, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...blocos, dirCentral, fim]);
}

const xmlEsc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const colLetra = (n) => {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

// Linha do sheetData: célula 'n' = número, resto vira texto (inline string).
function linhaXlsx(rowIdx, celulas) {
  let xml = `<row r="${rowIdx}">`;
  celulas.forEach((c, i) => {
    if (c == null || c.v == null || c.v === '') return;
    const ref = colLetra(i + 1) + rowIdx;
    if (c.t === 'n') xml += `<c r="${ref}"><v>${c.v}</v></c>`;
    else xml += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c.v)}</t></is></c>`;
  });
  return xml + '</row>';
}

function folhaXlsx(linhas, larguras, temGrafico) {
  const cols = larguras && larguras.length
    ? `<cols>${larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${cols}<sheetData>${linhas.join('')}</sheetData>${temGrafico ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
}

// Gráfico de barras: categorias na coluna colCat e valores na colVal,
// linhas li..lf da folha indicada (valores em % de 0 a 100).
function graficoXlsx(titulo, nomeFolha, colCat, colVal, li, lf, corHex) {
  const faixa = (col) => `&apos;${xmlEsc(nomeFolha)}&apos;!$${col}$${li}:$${col}$${lf}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:chart>
<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${xmlEsc(titulo)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/>
<c:plotArea><c:layout/>
<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>
<c:ser><c:idx val="0"/><c:order val="0"/>
<c:spPr><a:solidFill><a:srgbClr val="${corHex}"/></a:solidFill></c:spPr>
<c:cat><c:strRef><c:f>${faixa(colCat)}</c:f></c:strRef></c:cat>
<c:val><c:numRef><c:f>${faixa(colVal)}</c:f></c:numRef></c:val>
</c:ser>
<c:axId val="111111111"/><c:axId val="222222222"/>
</c:barChart>
<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222222222"/></c:catAx>
<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/><c:max val="100"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="111111111"/></c:valAx>
</c:plotArea>
<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>
</c:chart>
</c:chartSpace>`;
}

// Âncora do gráfico na folha (intervalo de células que ele ocupa).
function desenhoXlsx(c1, l1, c2, l2) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor editAs="oneCell">
<xdr:from><xdr:col>${c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${l1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${c2}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${l2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro="">
<xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Gráfico"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic>
</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
}

const CLASSIF_ROTULO = { excelente: 'Excelente', organizado: 'Organizado', desorganizado: 'Desorganizado', critico: 'Crítico' };
const fmtDataHoraBr = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : String(s || '');
};
const fmtDataBr = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
};

// Monta o workbook: "Inspeções" (uma linha por inspeção concluída, com gráfico),
// "Resumo semanal" (média por semana, com gráfico), "Locais" (situação da última
// inspeção de cada local, com gráfico) e "Pendências" (respostas "Não" por local).
function gerarRelatorioXlsx(concluidas, rooms) {
  const isoDia = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  // --- aba 1: todas as inspeções concluídas ---
  const cab1 = ['Data', 'Modelo', 'Local', 'Inspetor', 'Pontuação (%)', 'Classificação', 'Sim', 'Não', 'N/A'];
  const linhas1 = [linhaXlsx(1, cab1.map((v) => ({ v })))];
  concluidas.forEach((i, idx) => {
    linhas1.push(linhaXlsx(idx + 2, [
      { v: fmtDataHoraBr(i.concluida_em || i.created_at) },
      { v: i.template_nome || 'Inspeção 5S' },
      { v: i.room_name || '—' },
      { v: i.inspector || '—' },
      { t: 'n', v: typeof i.score === 'number' ? i.score : '' },
      { v: CLASSIF_ROTULO[i.classificacao] || i.classificacao || '' },
      { t: 'n', v: i.conformes == null ? '' : i.conformes },
      { t: 'n', v: i.nao_conformes == null ? '' : i.nao_conformes },
      { t: 'n', v: i.nao_aplicaveis == null ? '' : i.nao_aplicaveis },
    ]));
  });

  // --- aba 2: resumo por semana (segunda a domingo) ---
  const semanas = new Map(); // iso da segunda-feira → { fim, notas: [] }
  for (const i of concluidas) {
    const dia = String(i.concluida_em || i.created_at || '').slice(0, 10);
    const d = new Date(dia + 'T12:00:00');
    if (isNaN(d)) continue;
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // volta até a segunda
    const ini = isoDia(d);
    d.setDate(d.getDate() + 6);
    if (!semanas.has(ini)) semanas.set(ini, { fim: isoDia(d), notas: [] });
    if (typeof i.score === 'number') semanas.get(ini).notas.push(i.score);
  }
  const chavesSemana = [...semanas.keys()].sort();
  const cab2 = ['Semana', 'Inspeções', 'Média (%)'];
  const linhas2 = [linhaXlsx(1, cab2.map((v) => ({ v })))];
  chavesSemana.forEach((ini, idx) => {
    const s = semanas.get(ini);
    const media = s.notas.length ? Math.round(s.notas.reduce((a, b) => a + b, 0) / s.notas.length) : '';
    linhas2.push(linhaXlsx(idx + 2, [
      { v: `${fmtDataBr(ini)} a ${fmtDataBr(s.fim)}` },
      { t: 'n', v: s.notas.length },
      { t: 'n', v: media },
    ]));
  });
  const todas = concluidas.filter((i) => typeof i.score === 'number').map((i) => i.score);
  const mediaGeral = todas.length ? Math.round(todas.reduce((a, b) => a + b, 0) / todas.length) : '';
  linhas2.push(linhaXlsx(chavesSemana.length + 3, [
    { v: 'Média geral' }, { t: 'n', v: todas.length }, { t: 'n', v: mediaGeral },
  ]));

  // --- aba 3: situação por local (última inspeção de cada um) ---
  // Responde direto "quais locais estão em dia e quais não": pontuação geral,
  // situação da limpeza (só perguntas de limpeza) e nº de respostas "Não".
  const ehNao = (it) => it.resp === 'nao' || it.resp === 'nao_conforme';
  const itensLimpeza = (insp) => (insp.items || []).filter((it) =>
    (!it.tipo || it.tipo === 'sim_nao') && String(it.cat || '').toLowerCase().includes('limpeza'));
  const porLocal = new Map(); // chave: room_id (ou nome) → última inspeção concluída
  for (const i of concluidas) { // já vem em ordem crescente: a última sobrescreve
    const chave = i.room_id != null ? 'id:' + i.room_id : 'nome:' + String(i.room_name || '').toLowerCase();
    if (i.room_name) porLocal.set(chave, i);
  }
  const locais = [];
  for (const [, ult] of porLocal) {
    const limp = itensLimpeza(ult);
    const pendLimp = limp.filter(ehNao).length;
    locais.push({
      nome: ult.room_name,
      data: fmtDataHoraBr(ult.concluida_em || ult.created_at),
      modelo: ult.template_nome || 'Inspeção 5S',
      inspetor: ult.inspector || '—',
      score: typeof ult.score === 'number' ? ult.score : null,
      limpeza: limp.length ? (pendLimp ? `${pendLimp} pendência${pendLimp === 1 ? '' : 's'}` : 'Em dia') : '—',
      situacao: CLASSIF_ROTULO[ult.classificacao] || ult.classificacao || '',
      naos: (ult.items || []).filter((it) => (!it.tipo || it.tipo === 'sim_nao') && ehNao(it)).length,
      insp: ult,
    });
  }
  locais.sort((a, b) => (a.score == null ? 999 : a.score) - (b.score == null ? 999 : b.score)); // pior primeiro
  // locais cadastrados que nunca foram inspecionados entram no fim da lista
  const nomesComInspecao = new Set(locais.map((l) => String(l.nome).toLowerCase()));
  for (const r of (rooms || [])) {
    if (nomesComInspecao.has(String(r.name).toLowerCase())) continue;
    locais.push({ nome: r.name, data: 'Nunca inspecionado', modelo: '', inspetor: '', score: null, limpeza: '—', situacao: '', naos: '', insp: null });
  }
  const cab3 = ['Local', 'Última inspeção', 'Modelo', 'Inspetor', 'Pontuação (%)', 'Limpeza', 'Situação', 'Respostas "Não"'];
  const linhas3 = [linhaXlsx(1, cab3.map((v) => ({ v })))];
  locais.forEach((l, idx) => {
    linhas3.push(linhaXlsx(idx + 2, [
      { v: l.nome },
      { v: l.data },
      { v: l.modelo },
      { v: l.inspetor },
      { t: 'n', v: l.score == null ? '' : l.score },
      { v: l.limpeza },
      { v: l.situacao },
      { t: 'n', v: l.naos === '' ? '' : l.naos },
    ]));
  });
  const locaisComScore = locais.filter((l) => l.score != null).length;

  // --- aba 4: pendências (cada resposta "Não" da última inspeção por local) ---
  const cab4 = ['Local', 'Data da inspeção', 'Seção', 'Item com problema', 'Observação do inspetor', 'Inspetor'];
  const linhas4 = [linhaXlsx(1, cab4.map((v) => ({ v })))];
  let l4 = 2;
  for (const l of locais) {
    if (!l.insp) continue;
    for (const it of (l.insp.items || [])) {
      if ((it.tipo && it.tipo !== 'sim_nao') || !ehNao(it)) continue;
      linhas4.push(linhaXlsx(l4++, [
        { v: l.nome },
        { v: l.data },
        { v: it.cat || '' },
        { v: it.item || '' },
        { v: it.obs || '' },
        { v: l.inspetor },
      ]));
    }
  }
  if (l4 === 2) linhas4.push(linhaXlsx(2, [{ v: 'Nenhuma pendência — todos os locais em dia na última inspeção. 🎉' }]));

  const XMLNS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const relsFolha = (rid) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${XMLNS_REL}/drawing" Target="../drawings/drawing${rid}.xml"/></Relationships>`;
  const relsDesenho = (rid) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${XMLNS_REL}/chart" Target="../charts/chart${rid}.xml"/></Relationships>`;

  const partes = [
    { nome: '[Content_Types].xml', xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
<Override PartName="/xl/drawings/drawing2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
<Override PartName="/xl/drawings/drawing3.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
<Override PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
<Override PartName="/xl/charts/chart3.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
</Types>` },
    { nome: '_rels/.rels', xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${XMLNS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nome: 'xl/workbook.xml', xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${XMLNS_REL}"><sheets><sheet name="Inspeções" sheetId="1" r:id="rId1"/><sheet name="Resumo semanal" sheetId="2" r:id="rId2"/><sheet name="Locais" sheetId="3" r:id="rId4"/><sheet name="Pendências" sheetId="4" r:id="rId5"/></sheets></workbook>` },
    { nome: 'xl/_rels/workbook.xml.rels', xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${XMLNS_REL}/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="${XMLNS_REL}/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="${XMLNS_REL}/styles" Target="styles.xml"/>
<Relationship Id="rId4" Type="${XMLNS_REL}/worksheet" Target="worksheets/sheet3.xml"/>
<Relationship Id="rId5" Type="${XMLNS_REL}/worksheet" Target="worksheets/sheet4.xml"/>
</Relationships>` },
    { nome: 'xl/styles.xml', xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>` },
    { nome: 'xl/worksheets/sheet1.xml', xml: folhaXlsx(linhas1, [18, 26, 22, 20, 14, 16, 6, 6, 6], true) },
    { nome: 'xl/worksheets/sheet2.xml', xml: folhaXlsx(linhas2, [24, 11, 11], true) },
    { nome: 'xl/worksheets/sheet3.xml', xml: folhaXlsx(linhas3, [24, 18, 26, 20, 14, 16, 16, 14], true) },
    { nome: 'xl/worksheets/sheet4.xml', xml: folhaXlsx(linhas4, [24, 18, 28, 44, 36, 20], false) },
    { nome: 'xl/worksheets/_rels/sheet1.xml.rels', xml: relsFolha(1) },
    { nome: 'xl/worksheets/_rels/sheet2.xml.rels', xml: relsFolha(2) },
    { nome: 'xl/worksheets/_rels/sheet3.xml.rels', xml: relsFolha(3) },
    // gráfico 1 ao lado das inspeções; 2 ao lado do resumo; 3 ao lado dos locais
    { nome: 'xl/drawings/drawing1.xml', xml: desenhoXlsx(10, 1, 20, 21) },
    { nome: 'xl/drawings/drawing2.xml', xml: desenhoXlsx(4, 1, 14, 21) },
    { nome: 'xl/drawings/drawing3.xml', xml: desenhoXlsx(9, 1, 19, 21) },
    { nome: 'xl/drawings/_rels/drawing1.xml.rels', xml: relsDesenho(1) },
    { nome: 'xl/drawings/_rels/drawing2.xml.rels', xml: relsDesenho(2) },
    { nome: 'xl/drawings/_rels/drawing3.xml.rels', xml: relsDesenho(3) },
    { nome: 'xl/charts/chart1.xml', xml: graficoXlsx('Pontuação por inspeção (%)', 'Inspeções', 'A', 'E', 2, concluidas.length + 1, '1C7A45') },
    { nome: 'xl/charts/chart2.xml', xml: graficoXlsx('Média semanal (%)', 'Resumo semanal', 'A', 'C', 2, chavesSemana.length + 1, '2563EB') },
    { nome: 'xl/charts/chart3.xml', xml: graficoXlsx('Última inspeção por local (%)', 'Locais', 'A', 'E', 2, locaisComScore + 1, 'C2710C') },
  ];
  return ziparPartes(partes);
}

function handleApi(req, res) {
  const chunks = [];
  let size = 0;
  let tooBig = false;
  const LIMIT = parseInt(process.env.PAT_BODY_LIMIT, 10) || 64 * 1024 * 1024; // 64 MB
  req.on('data', (c) => {
    if (tooBig) return;
    size += c.length;
    if (size > LIMIT) {
      tooBig = true;
      sendJson(res, 413, { error: 'Backup grande demais para o servidor. Aumente PAT_BODY_LIMIT se necessário.' });
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    let body = {};
    if (chunks.length) {
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
      catch (e) { return sendJson(res, 400, { error: 'JSON inválido no corpo da requisição.' }); }
    }
    let operator = 'sistema';
    const h = req.headers['x-operator'];
    if (h) { try { operator = decodeURIComponent(h); } catch (e) { operator = String(h); } }

    const urlPath = req.url.split('?')[0];
    try {
      // Cópia de segurança (a base agora vive no servidor).
      // Atenção: o export cobre só os DADOS (JSON). Fotos de inspeção e PDFs de
      // EPI são arquivos em patrimonio-data/ — para backup completo, copie a pasta.
      if (urlPath === '/api/export' && req.method === 'GET') {
        return sendJson(res, 200, JSON.parse(db.dump()));
      }
      if (urlPath === '/api/import' && req.method === 'POST') {
        db.snapshot('pre-import'); // guarda o estado atual antes de substituir tudo
        try {
          db.restore(body);
        } catch (e) {
          return sendJson(res, 400, { error: (e && e.message) || 'Arquivo de backup inválido.' });
        }
        notifyChange(urlPath, 'POST', operator, req);
        return sendJson(res, 200, { ok: true });
      }
      // Endereço público dos links de assinatura (túnel/domínio), se configurado.
      if (urlPath === '/api/epi/link-base' && req.method === 'GET') {
        const base = String(process.env.PAT_LINK_ASSINATURA || '').trim().replace(/\/+$/, '');
        return sendJson(res, 200, { base: base || null });
      }
      // Termo de EPI em PDF para download (pelo token da entrega).
      if (urlPath === '/api/epi/pdf' && req.method === 'GET') {
        const q = new URLSearchParams(req.url.split('?')[1] || '');
        const rt = db.request('GET', '/api/epi/termo?token=' + encodeURIComponent(q.get('token') || ''), {}, operator);
        if (!rt.ok) return sendJson(res, rt.status || 404, rt.data || { error: 'Termo não encontrado.' });
        const pdf = gerarTermoPdf(rt.data);
        // Nome do arquivo: "termo epi" + nome do colaborador (sem acentos/símbolos).
        const slug = String(rt.data.person_name || '')
          .normalize('NFD').replace(/[̀-ͯ]/g, '')
          .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ('entrega-' + rt.data.id);
        return send(res, 200, pdf, {
          'Content-Type': 'application/pdf',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': `attachment; filename="termo-epi-${slug}.pdf"`,
          'Content-Length': pdf.length,
        });
      }
      // Anexar o PDF assinado (confirma a entrega) — arquivo fica fora da web.
      let m = urlPath.match(/^\/api\/epi\/(\d+)\/anexar-pdf$/);
      if (m && req.method === 'POST') {
        const dataUrl = String(body.pdf_base64 || '');
        const b64 = dataUrl.replace(/^data:application\/pdf;base64,/, '');
        if (b64 === dataUrl) return sendJson(res, 400, { error: 'Envie um arquivo PDF.' });
        let buf;
        try { buf = Buffer.from(b64, 'base64'); } catch (e) { return sendJson(res, 400, { error: 'PDF inválido.' }); }
        if (!buf || buf.length < 1024) return sendJson(res, 400, { error: 'PDF vazio ou inválido.' });
        if (buf.length > 15 * 1024 * 1024) return sendJson(res, 400, { error: 'PDF grande demais (máx. 15 MB).' });
        if (buf.slice(0, 5).toString('latin1') !== '%PDF-') return sendJson(res, 400, { error: 'O arquivo não é um PDF.' });
        const arquivo = `entrega-${m[1]}-${Date.now()}.pdf`;
        fs.writeFileSync(path.join(EPI_ANEXOS_DIR, arquivo), buf);
        const rc = db.request('POST', `/api/epi/${m[1]}/confirmar-pdf`, {
          arquivo,
          nome_original: body.nome_arquivo || null,
          assinado_nome: body.assinado_nome || null,
        }, operator);
        if (!rc.ok) {
          try { fs.unlinkSync(path.join(EPI_ANEXOS_DIR, arquivo)); } catch (e) { /* ignore */ }
          return sendJson(res, rc.status || 400, rc.data || { error: 'Não foi possível confirmar.' });
        }
        notifyChange(urlPath, 'POST', operator, req);
        return sendJson(res, 200, rc.data);
      }
      // Baixar o PDF assinado anexado à entrega.
      m = urlPath.match(/^\/api\/epi\/(\d+)\/anexo-pdf$/);
      if (m && req.method === 'GET') {
        const re = db.request('GET', `/api/epi/${m[1]}`, {}, operator);
        if (!re.ok || !re.data.pdf_arquivo) return sendJson(res, 404, { error: 'Nenhum PDF anexado a esta entrega.' });
        const alvo = path.normalize(path.join(EPI_ANEXOS_DIR, re.data.pdf_arquivo));
        if (!alvo.startsWith(EPI_ANEXOS_DIR + path.sep)) return sendJson(res, 403, { error: 'Arquivo inválido.' });
        return fs.readFile(alvo, (err, data) => {
          if (err) return sendJson(res, 404, { error: 'Arquivo do PDF não encontrado no servidor.' });
          send(res, 200, data, {
            'Content-Type': 'application/pdf',
          'X-Content-Type-Options': 'nosniff',
            'Content-Disposition': `inline; filename="termo-epi-${m[1]}-assinado.pdf"`,
            'Content-Length': data.length,
          });
        });
      }
      // Relatório de inspeções em planilha Excel (com gráficos).
      if (urlPath === '/api/inspections/relatorio-xlsx' && req.method === 'GET') {
        const ri = db.request('GET', '/api/inspections', {}, operator);
        if (!ri.ok) return sendJson(res, ri.status || 500, ri.data || { error: 'Não foi possível ler as inspeções.' });
        const concluidas = (ri.data || [])
          .filter((i) => (i.status || 'concluida') === 'concluida')
          .sort((a, b) => String(a.concluida_em || a.created_at).localeCompare(String(b.concluida_em || b.created_at)));
        if (!concluidas.length) return sendJson(res, 400, { error: 'Nenhuma inspeção concluída para exportar.' });
        const rr = db.request('GET', '/api/rooms', {}, operator);
        const xlsx = gerarRelatorioXlsx(concluidas, rr.ok ? rr.data : []);
        return send(res, 200, xlsx, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': 'attachment; filename="relatorio-inspecoes.xlsx"',
          'Content-Length': xlsx.length,
        });
      }
      // Foto de evidência da inspeção 5S: recebe base64, salva o arquivo no
      // servidor e registra só o nome na base (mesmo padrão dos anexos de EPI).
      m = urlPath.match(/^\/api\/inspections\/(\d+)\/foto$/);
      if (m && req.method === 'POST') {
        const dataUrl = String(body.foto_base64 || '');
        const tipos = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
        const cab = /^data:(image\/(?:jpeg|png|webp));base64,/.exec(dataUrl);
        if (!cab) return sendJson(res, 400, { error: 'Envie uma imagem (JPG, PNG ou WebP).' });
        let buf;
        try { buf = Buffer.from(dataUrl.slice(cab[0].length), 'base64'); }
        catch (e) { return sendJson(res, 400, { error: 'Imagem inválida.' }); }
        if (!buf || buf.length < 100) return sendJson(res, 400, { error: 'Imagem vazia ou inválida.' });
        if (buf.length > 10 * 1024 * 1024) return sendJson(res, 400, { error: 'Imagem grande demais (máx. 10 MB).' });
        const magicOk = (buf[0] === 0xFF && buf[1] === 0xD8) // JPEG
          || (buf[0] === 0x89 && buf[1] === 0x50)            // PNG
          || (buf.slice(0, 4).toString('latin1') === 'RIFF'); // WebP
        if (!magicOk) return sendJson(res, 400, { error: 'O arquivo não é uma imagem válida.' });
        const qid = String(body.question_id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
        if (!qid) return sendJson(res, 400, { error: 'Pergunta inválida.' });
        const arquivo = `insp-${m[1]}-${qid}-${Date.now()}.${tipos[cab[1]]}`;
        fs.writeFileSync(path.join(INSPECAO_FOTOS_DIR, arquivo), buf);
        const rc = db.request('POST', `/api/inspections/${m[1]}/fotos`, {
          question_id: body.question_id,
          arquivo,
          nome: body.nome || null,
        }, operator);
        if (!rc.ok) {
          try { fs.unlinkSync(path.join(INSPECAO_FOTOS_DIR, arquivo)); } catch (e) { /* ignore */ }
          return sendJson(res, rc.status || 400, rc.data || { error: 'Não foi possível anexar a foto.' });
        }
        notifyChange(urlPath, 'POST', operator, req);
        return sendJson(res, 200, rc.data);
      }
      // Remover uma foto de evidência (base primeiro; depois o arquivo).
      m = urlPath.match(/^\/api\/inspections\/(\d+)\/foto$/);
      if (m && req.method === 'DELETE') {
        const rc = db.request('DELETE', `/api/inspections/${m[1]}/fotos`, {
          question_id: body.question_id,
          arquivo: body.arquivo,
        }, operator);
        if (!rc.ok) return sendJson(res, rc.status || 400, rc.data || { error: 'Não foi possível remover a foto.' });
        const arq = rc.data && rc.data.arquivo;
        if (arq && arq.startsWith(`insp-${m[1]}-`) && /^insp-\d+-[A-Za-z0-9_.-]+$/.test(arq)) {
          try { fs.unlinkSync(path.join(INSPECAO_FOTOS_DIR, arq)); } catch (e) { /* ignore */ }
        }
        notifyChange(urlPath, 'DELETE', operator, req);
        return sendJson(res, 200, rc.data);
      }
      // Servir uma foto de evidência.
      m = urlPath.match(/^\/api\/inspections\/(\d+)\/foto\/([A-Za-z0-9_.-]+)$/);
      if (m && req.method === 'GET') {
        const arq = m[2];
        if (!arq.startsWith(`insp-${m[1]}-`)) return sendJson(res, 403, { error: 'Arquivo inválido.' });
        const alvo = path.normalize(path.join(INSPECAO_FOTOS_DIR, arq));
        if (!alvo.startsWith(INSPECAO_FOTOS_DIR + path.sep)) return sendJson(res, 403, { error: 'Arquivo inválido.' });
        const ctFoto = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(arq).toLowerCase()];
        if (!ctFoto) return sendJson(res, 403, { error: 'Arquivo inválido.' });
        return fs.readFile(alvo, (err, data) => {
          if (err) return sendJson(res, 404, { error: 'Foto não encontrada no servidor.' });
          send(res, 200, data, {
            'Content-Type': ctFoto,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, max-age=3600',
            'Content-Length': data.length,
          });
        });
      }
      // Excluir inspeção: a base remove o registro e devolve a lista de fotos
      // para apagarmos os arquivos do disco.
      m = urlPath.match(/^\/api\/inspections\/(\d+)$/);
      if (m && req.method === 'DELETE') {
        const rc = db.request('DELETE', urlPath, body, operator);
        if (rc.ok && rc.data && Array.isArray(rc.data.fotos_arquivos)) {
          for (const arq of rc.data.fotos_arquivos) {
            // Só apaga arquivos que pertencem à inspeção excluída.
            if (String(arq).startsWith(`insp-${m[1]}-`) && /^insp-\d+-[A-Za-z0-9_.-]+$/.test(String(arq))) {
              try { fs.unlinkSync(path.join(INSPECAO_FOTOS_DIR, String(arq))); } catch (e) { /* ignore */ }
            }
          }
        }
        if (rc.ok) notifyChange(urlPath, 'DELETE', operator, req);
        return sendJson(res, rc.status || 200, rc.ok ? rc.data : (rc.data || { error: 'Erro' }));
      }
      // Todas as demais rotas vão para a lógica compartilhada (store.js).
      // Atrás do proxy de assinatura/túnel a conexão chega por loopback — o IP
      // verdadeiro do assinante vem então no X-Forwarded-For.
      const ipDireto = (req.socket && req.socket.remoteAddress) || '';
      const ipEncaminhado = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const r = db.request(req.method, req.url, body, operator,
        { ip: (/^(::1$|::ffff:127\.|127\.)/.test(ipDireto) && ipEncaminhado) || ipDireto });
      if (r.ok && (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') && !urlPath.startsWith('/api/auth')) {
        notifyChange(urlPath, req.method, operator, req);
      }
      return sendJson(res, r.status || 200, r.ok ? r.data : (r.data || { error: 'Erro' }));
    } catch (e) {
      return sendJson(res, 500, { error: (e && e.message) || 'Erro interno do servidor.' });
    }
  });
  req.on('error', () => { if (!res.writableEnded) send(res, 400, 'Erro na requisição'); });
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath === '/healthz' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true });
  }
  if (urlPath === '/api/events' && req.method === 'GET') {
    return handleSSE(req, res);
  }
  if (urlPath === '/api' || urlPath.startsWith('/api/')) {
    return handleApi(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Método não permitido');
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`[Controle Patrimonial] servidor no ar em http://${HOST}:${PORT}`);
  console.log(`[Controle Patrimonial] dados em: ${db.DATA_FILE}`);
  console.log(`[Controle Patrimonial] backups em: ${db.BACKUP_DIR}`);
});

// O systemd envia SIGTERM ao parar somente este serviço. Encerramos a escuta
// de forma controlada; as gravações do banco já são síncronas e atômicas.
let encerramentoEmAndamento = false;
function encerrarServidor(sinal) {
  if (encerramentoEmAndamento) return;
  encerramentoEmAndamento = true;
  console.log(`[Controle Patrimonial] ${sinal} recebido; encerrando o servidor.`);
  const limite = setTimeout(() => {
    console.error('[Controle Patrimonial] limite de encerramento atingido.');
    process.exit(1);
  }, 10 * 1000);
  limite.unref();
  server.close((erro) => {
    clearTimeout(limite);
    if (erro) {
      console.error('[Controle Patrimonial] falha ao encerrar:', erro);
      process.exit(1);
    }
    process.exit(0);
  });
}
process.once('SIGINT', () => encerrarServidor('SIGINT'));
process.once('SIGTERM', () => encerrarServidor('SIGTERM'));

// Snapshot automático periódico (rede de segurança adicional).
const SNAP_MS = parseInt(process.env.PAT_SNAPSHOT_MS, 10) || 6 * 60 * 60 * 1000; // 6 h
setInterval(() => { try { db.snapshot('auto'); } catch (e) { /* ignore */ } }, SNAP_MS).unref();
