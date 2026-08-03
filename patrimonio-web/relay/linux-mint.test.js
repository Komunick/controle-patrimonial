'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const WEB_DIR = path.join(__dirname, '..');
const LINUX_DIR = path.join(WEB_DIR, 'linux');

function ler(nome) {
  return fs.readFileSync(path.join(LINUX_DIR, nome), 'utf8');
}

async function portaLivre() {
  const servidor = net.createServer();
  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', resolve);
  });
  const porta = servidor.address().port;
  await new Promise((resolve, reject) => servidor.close((erro) => erro ? reject(erro) : resolve()));
  return porta;
}

async function aguardarHealthz(url, processo, logs) {
  let ultimoErro = null;
  for (let tentativa = 0; tentativa < 80; tentativa++) {
    if (processo.exitCode !== null) {
      throw new Error(`Servidor encerrou antes do healthcheck.\n${logs()}`);
    }
    try {
      const resposta = await fetch(url, { signal: AbortSignal.timeout(500) });
      const dados = await resposta.json();
      if (resposta.ok && dados.ok === true) return;
    } catch (erro) {
      ultimoErro = erro;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Healthcheck não respondeu: ${ultimoErro && ultimoErro.message}\n${logs()}`);
}

test('servidor local oferece healthcheck e encerra por SIGTERM', {
  // O Windows não entrega SIGTERM ao processo Node como o systemd/Linux.
  skip: process.platform === 'win32' ? 'Validação de sinal executada no CI Ubuntu.' : false,
}, async (t) => {
  const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'patrimonio-linux-'));
  const porta = await portaLivre();
  let saida = '';
  let erroSaida = '';
  const processo = spawn(process.execPath, [path.join(WEB_DIR, 'server', 'server.js')], {
    cwd: WEB_DIR,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(porta),
      PAT_DATA_DIR: temporario,
      PAT_LINK_ASSINATURA: 'https://relay.example.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processo.stdout.on('data', (parte) => { saida += parte.toString('utf8'); });
  processo.stderr.on('data', (parte) => { erroSaida += parte.toString('utf8'); });

  t.after(async () => {
    if (processo.exitCode === null) {
      processo.kill('SIGTERM');
      await Promise.race([
        once(processo, 'exit'),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
    fs.rmSync(temporario, { recursive: true, force: true });
  });

  await aguardarHealthz(
    `http://127.0.0.1:${porta}/healthz`,
    processo,
    () => `${saida}\n${erroSaida}`,
  );
  const linkBase = await fetch(`http://127.0.0.1:${porta}/api/epi/link-base`);
  assert.equal(linkBase.status, 200);
  assert.deepEqual(await linkBase.json(), {
    base: 'https://controle-patrimonial-relay-epi.onrender.com',
    origem: 'relay-padrao',
  });
  processo.kill('SIGTERM');
  const [codigo] = await once(processo, 'exit');
  assert.equal(codigo, 0, `${saida}\n${erroSaida}`);
  assert.match(saida, /SIGTERM recebido/);
});

test('artefatos Linux Mint usam systemd endurecido e preservam a VM', () => {
  const principal = ler('controle-patrimonial.service.in');
  const sync = ler('controle-patrimonial-relay-sync.service.in');
  const instalador = ler('instalar-linux-mint.sh');
  const verificador = ler('verificar-linux-mint.sh');
  const prompt = ler('DEPLOY-CLAUDE-COWORK-LINUX-MINT.md');
  const app = fs.readFileSync(path.join(WEB_DIR, 'app.js'), 'utf8');

  for (const unidade of [principal, sync]) {
    assert.match(unidade, /User=@@USUARIO@@/);
    assert.match(unidade, /NoNewPrivileges=true/);
    assert.match(unidade, /ProtectSystem=strict/);
    assert.match(unidade, /ProtectHome=read-only/);
    assert.match(unidade, /KillSignal=SIGTERM/);
  }
  assert.match(principal, /ReadWritePaths=\/var\/lib\/controle-patrimonial/);
  assert.match(sync, /ExecStart=@@NODE@@ @@PASTA_WEB@@\/server\/sincroniza-relay\.js/);
  assert.match(instalador, /ID:-.*linuxmint/);
  assert.match(instalador, /id -u.*USUARIO_SERVICO/);
  assert.match(instalador, /porta_8080_ocupada/);
  assert.match(instalador, /--somente-configurar/);
  assert.match(instalador, /--somente-sincronizador/);
  assert.match(instalador, /sistema_local_compativel/);
  assert.match(instalador, /install -m 0600 -o root -g root/);
  assert.ok(
    instalador.indexOf('porta_8080_ocupada()') < instalador.indexOf('systemctl enable'),
    'A verificação da porta deve existir antes de habilitar os serviços.',
  );
  assert.doesNotMatch(instalador, /^\s*(?:sudo\s+)?(?:reboot|shutdown|poweroff|halt|kill|pkill|killall)\b/m);
  assert.doesNotMatch(instalador, /^\s*systemctl\s+(?:stop|restart)\b/m);
  assert.doesNotMatch(verificador, /^\s*systemctl\s+(?:start|stop|restart|enable|disable)\b/m);
  assert.match(app, /https:\/\/controle-patrimonial-relay-epi\.onrender\.com/);
  assert.doesNotMatch(app, /epiBasePublica \|\| location\.origin/);
  assert.match(prompt, /ESTRITAMENTE PROIBIDO/);
  assert.match(prompt, /A VM não foi desligada ou reiniciada/);
});
