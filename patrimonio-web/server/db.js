'use strict';
/*
 * Controle Patrimonial — camada de dados do SERVIDOR (base compartilhada).
 * ---------------------------------------------------------------------------
 * Carrega o MESMO store.js usado pelo app dentro de um sandbox Node e troca o
 * localStorage por um arquivo JSON no servidor. Assim o comportamento fica
 * idêntico ao que já foi testado, mas os dados passam a ser compartilhados.
 *
 * Proteções de dados (revisão de segurança):
 *  - Os dados ficam FORA da pasta servida estaticamente (não são baixáveis).
 *  - Se o arquivo existir mas estiver corrompido/ilegível, o servidor NÃO
 *    re-semeia por cima: ele coloca o arquivo suspeito em quarentena e aborta,
 *    preservando qualquer chance de recuperação.
 *  - Gravação durável (fsync) e snapshots automáticos rotativos.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const STORE_JS = path.join(__dirname, '..', 'store.js');
const STORAGE_KEY = 'patrimonio.db.v1'; // chave única usada pelo store.js

// Dados FORA de ROOT (patrimonio-web), para nunca serem servidos como estático.
const DATA_DIR = process.env.PAT_DATA_DIR || path.join(__dirname, '..', '..', 'patrimonio-data');
const DATA_FILE = process.env.PAT_DATA_FILE || path.join(DATA_DIR, 'patrimonio.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const LEGACY_FILE = path.join(__dirname, 'data', 'patrimonio.json'); // local antigo (migração)

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

// Migração automática: se ainda não há arquivo no novo local mas existe no
// antigo (server/data), traz a base para cá uma única vez.
if (!fs.existsSync(DATA_FILE) && fs.existsSync(LEGACY_FILE)) {
  try {
    fs.copyFileSync(LEGACY_FILE, DATA_FILE);
    console.log('[Controle Patrimonial] base migrada de server/data para ' + DATA_DIR);
  } catch (e) { /* segue como primeira execução */ }
}

// ---------------------------------------------------------------------------
// localStorage falso, em arquivo. Leitura com guarda contra corrupção.
// ---------------------------------------------------------------------------
const mem = {};
let firstBoot = false;
try {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw); // pode lançar (JSON inválido/truncado)
  if (!parsed || typeof parsed !== 'object' || typeof parsed[STORAGE_KEY] !== 'string') {
    throw new Error('estrutura inesperada (sem a chave ' + STORAGE_KEY + ')');
  }
  JSON.parse(parsed[STORAGE_KEY]); // valida o conteúdo interno antes de aceitar
  Object.assign(mem, parsed);
} catch (e) {
  if (e.code === 'ENOENT') {
    firstBoot = true; // ok: arquivo ainda não existe → store.js cria com exemplos
  } else {
    // Arquivo EXISTE porém ilegível: NÃO re-semear por cima. Quarentena + abortar.
    const quarantine = DATA_FILE + '.corrupt-' + stamp();
    try { fs.renameSync(DATA_FILE, quarantine); } catch (_) { /* ignore */ }
    console.error('[Controle Patrimonial] FALHA ao ler a base (' + (e && e.message) + ').');
    console.error('[Controle Patrimonial] Arquivo preservado em: ' + quarantine);
    console.error('[Controle Patrimonial] Abortando para evitar sobrescrever dados. ' +
      'Restaure um backup de ' + BACKUP_DIR + ' (renomeie para patrimonio.json) e reinicie.');
    process.exit(1);
  }
}

function flush() {
  const tmp = DATA_FILE + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(mem));
    fs.fsyncSync(fd); // durabilidade: garante que os bytes foram ao disco
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, DATA_FILE); // troca atômica
}

const localStorageShim = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem(k, v) { mem[k] = String(v); flush(); },
  removeItem(k) { delete mem[k]; flush(); },
};

// ---------------------------------------------------------------------------
// Snapshots rotativos (rede de segurança contra import indevido / corrupção).
// ---------------------------------------------------------------------------
function rotateBackups(keep) {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => /^patrimonio-.*\.json$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of files.slice(keep || 40)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, old.f)); } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
}

function snapshot(reason) {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const bak = path.join(BACKUP_DIR, 'patrimonio-' + stamp() + '-' + (reason || 'auto') + '.json');
    fs.copyFileSync(DATA_FILE, bak);
    rotateBackups(40);
    return bak;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// Sandbox: roda store.js com os globais que ele espera.
// ---------------------------------------------------------------------------
const sandbox = {
  localStorage: localStorageShim,
  URLSearchParams,
  console,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(STORE_JS, 'utf8'), sandbox, { filename: 'store.js' });

const Patrimonio = sandbox.Patrimonio;
if (!Patrimonio || typeof Patrimonio.request !== 'function') {
  throw new Error('Falha ao carregar store.js no servidor: Patrimonio.request não encontrado.');
}

// Smoke-test: exercita um caminho real (Date/parseInt/URLSearchParams) para
// pegar logo, no boot, qualquer divergência entre navegador e servidor.
const smoke = Patrimonio.request('GET', '/api/next-tag?prefix=PAT', {}, 'boot');
if (!smoke || smoke.ok !== true) {
  throw new Error('store.js falhou no smoke-test do servidor.');
}

// Snapshot inicial do que foi carregado (não na primeiríssima execução).
if (!firstBoot) snapshot('startup');

Patrimonio.DATA_FILE = DATA_FILE;
Patrimonio.DATA_DIR = DATA_DIR;
Patrimonio.BACKUP_DIR = BACKUP_DIR;
Patrimonio.snapshot = snapshot;
module.exports = Patrimonio;
