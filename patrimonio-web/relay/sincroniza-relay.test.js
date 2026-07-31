'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { criarRelay } = require('./server');
const { sincronizarUmaVez } = require('../server/sincroniza-relay');

const SEGREDO = 'outro-segredo-de-teste-com-32-caracteres';
const TOKEN = 'abcdef0123456789abcdef0123456789abcdef01';
const PNG = `data:image/png;base64,${'B'.repeat(2200)}`;

function responder(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(dados));
}

async function escutar(servidor) {
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${servidor.address().port}`;
}

async function fechar(servidor) {
  await new Promise((resolve, reject) => servidor.close((erro) => erro ? reject(erro) : resolve()));
}

test('sincronizador envia termo, importa assinatura e confirma a baixa', async (t) => {
  const temporario = fs.mkdtempSync(path.join(__dirname, 'test-tmp-'));
  t.after(() => fs.rmSync(temporario, { recursive: true, force: true }));

  let statusLocal = 'pendente';
  let assinaturaRecebida = null;
  const local = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    if (req.method === 'GET' && url.pathname === '/api/epi') {
      return responder(res, 200, [{ id: 1, token: TOKEN, status: statusLocal }]);
    }
    if (req.method === 'GET' && url.pathname === '/api/epi/termo') {
      return responder(res, 200, {
        company: 'Empresa Integração',
        person_name: 'Motorista Integração',
        itens: [{ nome: 'Capacete', ca: '999', quantidade: 1 }],
        obs: null,
        entregue_por: 'Operador',
        created_at: '31/07/2026 18:30',
        status: statusLocal,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/epi/assinar') {
      const partes = [];
      req.on('data', (parte) => partes.push(parte));
      req.on('end', () => {
        if (statusLocal === 'assinado') return responder(res, 409, { error: 'Já assinado.' });
        assinaturaRecebida = JSON.parse(Buffer.concat(partes).toString('utf8'));
        statusLocal = 'assinado';
        responder(res, 200, { ok: true });
      });
      return;
    }
    responder(res, 404, { error: 'Rota não encontrada.' });
  });
  const sistemaUrl = await escutar(local);
  t.after(() => fechar(local));

  const relay = criarRelay({
    segredo: SEGREDO,
    arquivoDados: path.join(temporario, 'relay.json'),
  });
  const relayUrl = await escutar(relay);
  t.after(() => fechar(relay));
  const config = { relayUrl, relaySegredo: SEGREDO, sistemaUrl };

  const primeiro = await sincronizarUmaVez(config);
  assert.equal(primeiro.termos_enviados, 1);
  assert.equal(primeiro.assinaturas_importadas, 0);
  assert.equal(primeiro.erros, 0);

  const respostaAssinatura = await fetch(`${relayUrl}/api/assinar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: TOKEN,
      nome: 'Motorista Integração',
      documento: '12345678900',
      concordo: true,
      assinatura_png: PNG,
    }),
  });
  assert.equal(respostaAssinatura.status, 200);

  const segundo = await sincronizarUmaVez(config);
  assert.equal(segundo.assinaturas_importadas, 1);
  assert.equal(segundo.erros, 0);
  assert.equal(assinaturaRecebida.token, TOKEN);
  assert.equal(assinaturaRecebida.concordo, true);
  assert.equal(assinaturaRecebida.assinatura_png, PNG);

  const pendentes = await fetch(`${relayUrl}/api/assinaturas?pendentes=1`, {
    headers: { 'x-segredo': SEGREDO },
  });
  assert.deepEqual(await pendentes.json(), []);
});
