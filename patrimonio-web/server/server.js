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
      // Todas as demais rotas vão para a lógica compartilhada (store.js).
      const r = db.request(req.method, req.url, body, operator);
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
