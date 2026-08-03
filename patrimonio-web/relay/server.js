'use strict';

/*
 * Relay público dos termos de EPI.
 *
 * Não há dependências externas: HTTP, persistência JSON e validações usam
 * somente módulos nativos do Node.js. O arquivo é regravado de forma atômica
 * para que uma interrupção no meio da gravação não deixe a base pela metade.
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const LIMITE_CORPO = 512 * 1024;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,200}$/;
const PNG_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

function cortar(valor, maximo) {
  return String(valor == null ? '' : valor).trim().slice(0, maximo);
}

function erroHttp(status, mensagem) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

function cabecalhosSeguranca(tipo) {
  return {
    'Content-Type': tipo,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

function responderJson(res, status, dados) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, Object.assign(cabecalhosSeguranca('application/json; charset=utf-8'), {
    'Content-Length': Buffer.byteLength(corpo),
  }));
  res.end(corpo);
}

function responderHtml(res, html) {
  res.writeHead(200, Object.assign(cabecalhosSeguranca('text/html; charset=utf-8'), {
    'Content-Length': Buffer.byteLength(html),
    'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  }));
  res.end(html);
}

function lerJson(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let tamanho = 0;
    let terminou = false;

    req.on('data', (parte) => {
      if (terminou) return;
      tamanho += parte.length;
      if (tamanho > LIMITE_CORPO) {
        terminou = true;
        reject(erroHttp(413, 'Corpo da requisição grande demais.'));
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => {
      if (terminou) return;
      terminou = true;
      try {
        resolve(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'));
      } catch (_) {
        reject(erroHttp(400, 'JSON inválido no corpo da requisição.'));
      }
    });
    req.on('error', (erro) => {
      if (!terminou) {
        terminou = true;
        reject(erro);
      }
    });
  });
}

function segredoConfere(recebido, esperado) {
  const a = Buffer.from(String(recebido || ''), 'utf8');
  const b = Buffer.from(String(esperado || ''), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function exigirSegredo(req, segredo) {
  if (!segredoConfere(req.headers['x-segredo'], segredo)) {
    throw erroHttp(401, 'Segredo ausente ou inválido.');
  }
}

function normalizarToken(valor) {
  const token = cortar(valor, 200);
  if (!TOKEN_RE.test(token)) throw erroHttp(400, 'Token inválido.');
  return token;
}

function normalizarTermo(body) {
  const token = normalizarToken(body && body.token);
  const personName = cortar(body && body.person_name, 80);
  const empresa = cortar(body && body.empresa, 120);
  const entreguePor = cortar(body && body.entregue_por, 80);
  const createdAt = cortar(body && body.created_at, 80);
  if (personName.length < 2) throw erroHttp(400, 'Informe o nome de quem recebeu os EPIs.');
  if (!empresa) throw erroHttp(400, 'Informe a empresa.');
  if (!entreguePor) throw erroHttp(400, 'Informe quem entregou os EPIs.');
  if (!createdAt) throw erroHttp(400, 'Informe a data de criação do termo.');

  const brutos = Array.isArray(body && body.itens) ? body.itens : [];
  const itens = brutos.slice(0, 100).map((item) => ({
    nome: cortar(item && item.nome, 120),
    ca: cortar(item && item.ca, 30) || null,
    quantidade: Math.min(100000, Math.max(1, parseInt(item && item.quantidade, 10) || 1)),
  })).filter((item) => item.nome);
  if (!itens.length) throw erroHttp(400, 'Informe ao menos um EPI.');

  return {
    token,
    person_name: personName,
    itens,
    obs: cortar(body && body.obs, 300) || null,
    empresa,
    entregue_por: entreguePor,
    created_at: createdAt,
  };
}

function normalizarAssinatura(body) {
  const token = normalizarToken(body && body.token);
  if (!body || body.concordo !== true) {
    throw erroHttp(400, 'É preciso marcar que leu e concorda com o termo.');
  }
  const nome = cortar(body.nome, 80);
  if (!nome) throw erroHttp(400, 'Informe o seu nome completo.');
  const assinaturaPng = String(body.assinatura_png || '');
  if (!PNG_RE.test(assinaturaPng)) {
    throw erroHttp(400, 'Assinatura inválida. Assine no quadro e tente novamente.');
  }
  if (assinaturaPng.length < 2000) {
    throw erroHttp(400, 'Assinatura muito curta. Assine no quadro antes de confirmar.');
  }
  if (assinaturaPng.length > 400000) {
    throw erroHttp(400, 'Assinatura grande demais. Limpe o quadro e assine de novo.');
  }
  return {
    token,
    nome,
    documento: cortar(body.documento, 20) || null,
    assinatura_png: assinaturaPng,
  };
}

function obterIp(req) {
  // Render e Railway encaminham o IP público; o socket fica como alternativa.
  const encaminhado = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = cortar(req.headers['cf-connecting-ip'] || encaminhado || req.socket.remoteAddress, 80);
  return ip || null;
}

function criarRepositorio(arquivo) {
  const arquivoAbsoluto = path.resolve(arquivo);
  let dados = { versao: 1, termos: {} };

  if (fs.existsSync(arquivoAbsoluto)) {
    const lidos = JSON.parse(fs.readFileSync(arquivoAbsoluto, 'utf8'));
    if (!lidos || lidos.versao !== 1 || !lidos.termos || typeof lidos.termos !== 'object') {
      throw new Error('Formato inválido no arquivo de dados do relay.');
    }
    dados = lidos;
  }

  function salvar() {
    fs.mkdirSync(path.dirname(arquivoAbsoluto), { recursive: true });
    const temporario = `${arquivoAbsoluto}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporario, JSON.stringify(dados, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporario, arquivoAbsoluto);
    } catch (erro) {
      try { fs.unlinkSync(temporario); } catch (_) { /* o temporário pode não existir */ }
      throw erro;
    }
  }

  return {
    buscar(token) {
      return Object.prototype.hasOwnProperty.call(dados.termos, token) ? dados.termos[token] : null;
    },
    inserir(termo) {
      dados.termos[termo.token] = Object.assign({}, termo, {
        assinatura: null,
        baixada_em: null,
      });
      salvar();
      return dados.termos[termo.token];
    },
    assinar(token, assinatura) {
      const termo = dados.termos[token];
      termo.assinatura = assinatura;
      salvar();
      return termo;
    },
    marcarBaixada(token, quando) {
      const termo = dados.termos[token];
      if (!termo.baixada_em) {
        termo.baixada_em = quando;
        salvar();
      }
      return termo;
    },
    listarAssinaturas(somentePendentes) {
      return Object.values(dados.termos)
        .filter((termo) => termo.assinatura && (!somentePendentes || !termo.baixada_em))
        .sort((a, b) => String(a.assinatura.assinado_em).localeCompare(String(b.assinatura.assinado_em)))
        .map((termo) => Object.assign({ token: termo.token }, termo.assinatura, {
          baixada_em: termo.baixada_em || null,
        }));
    },
    total() {
      return Object.keys(dados.termos).length;
    },
  };
}

function termosIguais(a, b) {
  const campos = ['token', 'person_name', 'itens', 'obs', 'empresa', 'entregue_por', 'created_at'];
  const selecionar = (obj) => Object.fromEntries(campos.map((campo) => [campo, obj[campo]]));
  return JSON.stringify(selecionar(a)) === JSON.stringify(selecionar(b));
}

function criarRelay(opcoes) {
  const segredo = String(opcoes && opcoes.segredo || '');
  if (!segredo) throw new Error('Defina RELAY_SEGREDO antes de iniciar o relay.');
  const arquivoDados = opcoes && opcoes.arquivoDados
    ? opcoes.arquivoDados
    : path.join(__dirname, 'data', 'relay.json');
  const repo = criarRepositorio(arquivoDados);
  const pagina = fs.readFileSync(path.join(__dirname, 'assinar.html'), 'utf8');

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://relay.local');

      if (req.method === 'GET' && url.pathname === '/healthz') {
        return responderJson(res, 200, { ok: true, termos: repo.total() });
      }
      if (req.method === 'GET' && url.pathname === '/') {
        return responderJson(res, 200, { ok: true, servico: 'relay-assinatura-epi' });
      }
      if (req.method === 'GET' && url.pathname === '/assinar.html') {
        return responderHtml(res, pagina);
      }

      // Consulta pública necessária para montar a página; o token é a credencial.
      if (req.method === 'GET' && url.pathname === '/api/termo') {
        const token = normalizarToken(url.searchParams.get('token'));
        const termo = repo.buscar(token);
        if (!termo) throw erroHttp(404, 'Termo não encontrado. Confira o link com quem o enviou.');
        return responderJson(res, 200, {
          company: termo.empresa,
          person_name: termo.person_name,
          itens: termo.itens,
          obs: termo.obs,
          entregue_por: termo.entregue_por,
          created_at: termo.created_at,
          status: termo.assinatura ? 'assinado' : 'pendente',
          assinado_em: termo.assinatura ? termo.assinatura.assinado_em : null,
          assinado_nome: termo.assinatura ? termo.assinatura.nome : null,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/termos') {
        exigirSegredo(req, segredo);
        const termo = normalizarTermo(await lerJson(req));
        const existente = repo.buscar(termo.token);
        if (existente) {
          if (!termosIguais(existente, termo)) {
            throw erroHttp(409, 'Já existe outro termo com este token.');
          }
          return responderJson(res, 200, {
            ok: true,
            criado: false,
            token: termo.token,
            status: existente.assinatura ? 'assinado' : 'pendente',
          });
        }
        repo.inserir(termo);
        return responderJson(res, 201, { ok: true, criado: true, token: termo.token, status: 'pendente' });
      }

      if (req.method === 'POST' && url.pathname === '/api/assinar') {
        const recebida = normalizarAssinatura(await lerJson(req));
        const termo = repo.buscar(recebida.token);
        if (!termo) throw erroHttp(404, 'Termo não encontrado. Confira o link com quem o enviou.');
        if (termo.assinatura) {
          throw erroHttp(409, `Este termo já foi assinado em ${termo.assinatura.assinado_em}.`);
        }
        const assinatura = {
          nome: recebida.nome,
          documento: recebida.documento,
          assinatura_png: recebida.assinatura_png,
          assinado_em: new Date().toISOString(),
          ip: obterIp(req),
        };
        repo.assinar(recebida.token, assinatura);
        return responderJson(res, 200, {
          ok: true,
          assinado_em: assinatura.assinado_em,
          assinado_nome: assinatura.nome,
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/assinaturas') {
        exigirSegredo(req, segredo);
        const pendentes = url.searchParams.get('pendentes') === '1';
        return responderJson(res, 200, repo.listarAssinaturas(pendentes));
      }

      const baixar = url.pathname.match(/^\/api\/assinaturas\/([^/]+)\/baixada$/);
      if (req.method === 'POST' && baixar) {
        exigirSegredo(req, segredo);
        let token;
        try { token = normalizarToken(decodeURIComponent(baixar[1])); }
        catch (_) { throw erroHttp(400, 'Token inválido.'); }
        const termo = repo.buscar(token);
        if (!termo) throw erroHttp(404, 'Termo não encontrado.');
        if (!termo.assinatura) throw erroHttp(409, 'O termo ainda não foi assinado.');
        const atualizado = repo.marcarBaixada(token, new Date().toISOString());
        return responderJson(res, 200, { ok: true, token, baixada_em: atualizado.baixada_em });
      }

      responderJson(res, 404, { error: 'Rota não encontrada.' });
    } catch (erro) {
      const status = Number.isInteger(erro && erro.status) ? erro.status : 500;
      if (status === 500) console.error('[relay] Erro interno:', erro);
      if (!res.writableEnded) {
        responderJson(res, status, { error: status === 500 ? 'Erro interno do relay.' : erro.message });
      }
    }
  });
}

function iniciar() {
  const segredo = String(process.env.RELAY_SEGREDO || '');
  const porta = parseInt(process.env.PORT, 10) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const diretorio = process.env.RELAY_DATA_DIR
    ? path.resolve(process.env.RELAY_DATA_DIR)
    : path.join(__dirname, 'data');
  const servidor = criarRelay({ segredo, arquivoDados: path.join(diretorio, 'relay.json') });

  servidor.listen(porta, host, () => {
    console.log(`[relay] No ar em http://${host}:${porta}`);
    console.log(`[relay] Dados em ${path.join(diretorio, 'relay.json')}`);
    if (segredo.length < 16) console.warn('[relay] Aviso: use RELAY_SEGREDO com pelo menos 16 caracteres aleatórios.');
  });

  const encerrar = () => servidor.close(() => process.exit(0));
  process.once('SIGINT', encerrar);
  process.once('SIGTERM', encerrar);
}

if (require.main === module) iniciar();

module.exports = { criarRelay, normalizarTermo, normalizarAssinatura };
