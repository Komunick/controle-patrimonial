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
            'Content-Disposition': `inline; filename="termo-epi-${m[1]}-assinado.pdf"`,
            'Content-Length': data.length,
          });
        });
      }
      // Todas as demais rotas vão para a lógica compartilhada (store.js).
      const r = db.request(req.method, req.url, body, operator,
        { ip: (req.socket && req.socket.remoteAddress) || '' });
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

// Snapshot automático periódico (rede de segurança adicional).
const SNAP_MS = parseInt(process.env.PAT_SNAPSHOT_MS, 10) || 6 * 60 * 60 * 1000; // 6 h
setInterval(() => { try { db.snapshot('auto'); } catch (e) { /* ignore */ } }, SNAP_MS).unref();
