'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { criarRelay } = require('./server');

const SEGREDO = 'segredo-de-teste-com-32-caracteres';
const TOKEN = '0123456789abcdef0123456789abcdef01234567';
const PNG = `data:image/png;base64,${'A'.repeat(2200)}`;

async function abrirServidor(arquivoDados) {
  const servidor = criarRelay({ segredo: SEGREDO, arquivoDados });
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const endereco = servidor.address();
  return {
    servidor,
    base: `http://127.0.0.1:${endereco.port}`,
  };
}

async function fechar(servidor) {
  await new Promise((resolve, reject) => servidor.close((erro) => erro ? reject(erro) : resolve()));
}

async function json(base, caminho, opcoes) {
  const resposta = await fetch(`${base}${caminho}`, opcoes);
  return { resposta, dados: await resposta.json() };
}

test('fluxo completo do termo, assinatura única e baixa', async (t) => {
  const temporario = fs.mkdtempSync(path.join(__dirname, 'test-tmp-'));
  const arquivoDados = path.join(temporario, 'relay.json');
  t.after(() => fs.rmSync(temporario, { recursive: true, force: true }));
  const { servidor, base } = await abrirServidor(arquivoDados);
  t.after(() => fechar(servidor));

  const termo = {
    token: TOKEN,
    person_name: 'Motorista de Teste',
    itens: [{ nome: 'Luva', ca: '123', quantidade: 2 }],
    obs: 'Troca por desgaste',
    empresa: 'Empresa Teste',
    entregue_por: 'Operador',
    created_at: '31/07/2026 18:00',
  };

  const semSegredo = await json(base, '/api/termos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(termo),
  });
  assert.equal(semSegredo.resposta.status, 401);

  const criado = await json(base, '/api/termos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-segredo': SEGREDO },
    body: JSON.stringify(termo),
  });
  assert.equal(criado.resposta.status, 201);
  assert.equal(criado.dados.criado, true);

  const repetido = await json(base, '/api/termos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-segredo': SEGREDO },
    body: JSON.stringify(termo),
  });
  assert.equal(repetido.resposta.status, 200);
  assert.equal(repetido.dados.criado, false);

  const consulta = await json(base, `/api/termo?token=${TOKEN}`);
  assert.equal(consulta.resposta.status, 200);
  assert.equal(consulta.dados.status, 'pendente');
  assert.equal(consulta.dados.company, 'Empresa Teste');

  const pagina = await fetch(`${base}/assinar.html?t=${TOKEN}`);
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /Assinar e confirmar o recebimento/);

  const assinatura = {
    token: TOKEN,
    nome: 'Motorista de Teste',
    documento: '123.456.789-00',
    concordo: true,
    assinatura_png: PNG,
  };
  const assinada = await json(base, '/api/assinar', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.20',
    },
    body: JSON.stringify(assinatura),
  });
  assert.equal(assinada.resposta.status, 200);

  const segunda = await json(base, '/api/assinar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(assinatura),
  });
  assert.equal(segunda.resposta.status, 409);

  const pendentes = await json(base, '/api/assinaturas?pendentes=1', {
    headers: { 'x-segredo': SEGREDO },
  });
  assert.equal(pendentes.resposta.status, 200);
  assert.equal(pendentes.dados.length, 1);
  assert.equal(pendentes.dados[0].ip, '203.0.113.20');
  assert.equal(pendentes.dados[0].assinatura_png, PNG);

  const baixada = await json(base, `/api/assinaturas/${TOKEN}/baixada`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-segredo': SEGREDO },
    body: '{}',
  });
  assert.equal(baixada.resposta.status, 200);
  assert.ok(baixada.dados.baixada_em);

  const vazio = await json(base, '/api/assinaturas?pendentes=1', {
    headers: { 'x-segredo': SEGREDO },
  });
  assert.deepEqual(vazio.dados, []);
  assert.ok(fs.existsSync(arquivoDados));
});
