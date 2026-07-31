#!/usr/bin/env node
// Proxy de assinatura remota: aponte um túnel (Cloudflare, ngrok…) para esta
// porta e SÓ o necessário para o motorista assinar o termo de EPI vai para a
// internet. Login, painel e todas as outras rotas do sistema ficam de fora.
//
// Uso:  node proxy-assinatura.js
//   PAT_PROXY_PORTA  porta local do proxy (padrão 8791)
//   PAT_PROXY_ALVO   endereço do sistema patrimonial (padrão http://127.0.0.1:8080)
//
// Passo a passo completo em ASSINATURA-REMOTA.md, nesta pasta.
'use strict';

const http = require('http');

const PORTA = parseInt(process.env.PAT_PROXY_PORTA, 10) || 8791;
const ALVO = new URL(process.env.PAT_PROXY_ALVO || 'http://127.0.0.1:8080');
const LIMITE_CORPO = 2 * 1024 * 1024; // a assinatura em PNG fica bem abaixo de 2 MB

const PERMITIDAS = [
  { metodo: 'GET', caminho: '/assinar.html' },
  { metodo: 'GET', caminho: '/api/epi/termo' },
  { metodo: 'POST', caminho: '/api/epi/assinar' },
];

const server = http.createServer((req, res) => {
  const caminho = String(req.url || '').split('?')[0];
  const liberada = PERMITIDAS.some((r) => r.metodo === req.method && r.caminho === caminho);
  if (!liberada) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nada por aqui. Abra o link de assinatura que você recebeu.');
    return;
  }
  const encaminhada = http.request({
    host: ALVO.hostname,
    port: ALVO.port || 80,
    method: req.method,
    path: req.url,
    headers: {
      'content-type': req.headers['content-type'] || 'application/json',
      // Preserva o IP real do assinante (o túnel já preenche o cabeçalho).
      'x-forwarded-for': String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''),
    },
  }, (resposta) => {
    res.writeHead(resposta.statusCode || 502, {
      'Content-Type': resposta.headers['content-type'] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    resposta.pipe(res);
  });
  encaminhada.on('error', () => {
    if (!res.writableEnded) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('O sistema está fora do ar neste momento. Tente de novo em instantes.');
    }
  });
  let tamanho = 0;
  req.on('data', (c) => {
    tamanho += c.length;
    if (tamanho > LIMITE_CORPO) { encaminhada.destroy(); req.destroy(); }
  });
  req.pipe(encaminhada);
});

server.listen(PORTA, '127.0.0.1', () => {
  console.log(`Proxy de assinatura no ar: http://127.0.0.1:${PORTA} -> ${ALVO.href}`);
  console.log('Rotas expostas: GET /assinar.html · GET /api/epi/termo · POST /api/epi/assinar');
});
