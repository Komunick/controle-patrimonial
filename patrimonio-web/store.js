'use strict';
/*
 * Controle Patrimonial — camada de dados 100% no navegador.
 * ---------------------------------------------------------------------------
 * Substitui o servidor Node/Express + SQLite por um "banco" em memória que é
 * persistido no localStorage do navegador. Expõe Patrimonio.request(), que imita
 * exatamente as rotas /api/* que o app.js consome, devolvendo os mesmos formatos
 * de resposta. Também gera o QR Code no próprio navegador (qrcode-generator) e
 * oferece exportar/importar para cópia de segurança.
 *
 * Nada aqui depende de rede: abrir o index.html já funciona.
 */
(function (global) {
  // ===========================================================================
  // Configuração
  // ===========================================================================
  const COMPANY = 'Brazil Transports';
  const TAG_PREFIX = 'PAT';
  const STORAGE_KEY = 'patrimonio.db.v1';

  // ===========================================================================
  // Catálogo de tipos (espelha db.js do servidor)
  // ===========================================================================
  const CATALOG = {
    shifts: [
      { key: 'manha', label: 'Manhã' },
      { key: 'noite', label: 'Noite' },
      { key: 'integral', label: 'Integral' },
    ],
    statuses: [
      { key: 'ativo', label: 'Ativo', color: '#0E9F6E' },
      { key: 'manutencao', label: 'Em manutenção', color: '#C2710C' },
      { key: 'emprestado', label: 'Emprestado', color: '#2563EB' },
      { key: 'reservado', label: 'Reservado', color: '#7C3AED' },
      { key: 'inativo', label: 'Inativo', color: '#6B7280' },
      { key: 'baixado', label: 'Baixado', color: '#B91C1C' },
    ],
    conditions: [
      { key: 'novo', label: 'Novo' },
      { key: 'bom', label: 'Bom' },
      { key: 'regular', label: 'Regular' },
      { key: 'ruim', label: 'Ruim' },
      { key: 'descartado', label: 'Descartado' },
    ],
    peripheralTypes: [
      // Entrada
      { key: 'teclado', label: 'Teclado' },
      { key: 'mouse', label: 'Mouse' },
      { key: 'mousepad', label: 'Mouse pad' },
      { key: 'kit_teclado_mouse', label: 'Kit teclado + mouse' },
      // Áudio
      { key: 'headset', label: 'Headset' },
      { key: 'fone_ouvido', label: 'Fone de ouvido' },
      { key: 'fone_bluetooth', label: 'Fone Bluetooth / TWS' },
      { key: 'microfone', label: 'Microfone' },
      { key: 'caixa_som', label: 'Caixa de som' },
      // Vídeo / imagem
      { key: 'webcam', label: 'Webcam' },
      // Energia
      { key: 'carregador_notebook', label: 'Carregador de notebook' },
      { key: 'carregador_celular', label: 'Carregador de celular' },
      { key: 'fonte_energia', label: 'Fonte de energia' },
      { key: 'power_bank', label: 'Power bank' },
      { key: 'cabo_forca', label: 'Cabo de força' },
      // Cabos
      { key: 'cabo_rede', label: 'Cabo de rede (RJ45)' },
      { key: 'cabo_usb', label: 'Cabo USB' },
      { key: 'cabo_hdmi', label: 'Cabo HDMI' },
      { key: 'cabo_displayport', label: 'Cabo DisplayPort' },
      { key: 'cabo_vga', label: 'Cabo VGA' },
      { key: 'cabo', label: 'Cabo (outro)' },
      // Conectividade
      { key: 'adaptador', label: 'Adaptador (USB-C / HDMI)' },
      { key: 'hub_usb', label: 'Hub USB' },
      { key: 'dock_station', label: 'Dock station' },
      { key: 'adaptador_rede', label: 'Adaptador de rede (USB-Ethernet)' },
      // Armazenamento
      { key: 'pen_drive', label: 'Pen drive' },
      { key: 'hd_externo', label: 'HD / SSD externo' },
      { key: 'leitor_cartao', label: 'Leitor de cartão' },
      // Acessórios
      { key: 'suporte_notebook', label: 'Suporte de notebook' },
      { key: 'mochila', label: 'Mochila' },
      { key: 'capa', label: 'Capa / Case' },
      { key: 'outro', label: 'Outro' },
    ],
    groups: [
      {
        key: 'equipamentos', label: 'Equipamentos', category: 'equipamento',
        types: [
          { key: 'notebook', label: 'Notebook' },
          { key: 'celular', label: 'Celular' },
          { key: 'desktop', label: 'Desktop / PC' },
          { key: 'workstation', label: 'Workstation' },
          { key: 'mini_pc', label: 'Mini PC' },
          { key: 'monitor', label: 'Monitor' },
          { key: 'tablet', label: 'Tablet' },
          { key: 'telefone_ip', label: 'Telefone IP' },
        ],
      },
      {
        key: 'mobiliario', label: 'Mobiliário', category: 'patrimonio',
        types: [
          { key: 'mesa', label: 'Mesa de trabalho' },
          { key: 'mesa_reuniao', label: 'Mesa de reunião' },
          { key: 'cadeira', label: 'Cadeira' },
          { key: 'cadeira_gamer', label: 'Cadeira gamer' },
          { key: 'longarina', label: 'Longarina' },
          { key: 'poltrona', label: 'Poltrona' },
          { key: 'sofa', label: 'Sofá' },
          { key: 'gaveteiro', label: 'Gaveteiro' },
          { key: 'armario', label: 'Armário' },
          { key: 'estante', label: 'Estante' },
          { key: 'balcao', label: 'Balcão' },
          { key: 'divisoria', label: 'Divisória' },
        ],
      },
      {
        key: 'redes_ti', label: 'Redes / TI', category: 'patrimonio',
        types: [
          { key: 'roteador', label: 'Roteador' },
          { key: 'switch', label: 'Switch' },
          { key: 'access_point', label: 'Access point' },
          { key: 'modem', label: 'Modem' },
          { key: 'firewall', label: 'Firewall (appliance)' },
          { key: 'servidor', label: 'Servidor' },
          { key: 'storage', label: 'Storage / NAS' },
          { key: 'rack', label: 'Rack' },
          { key: 'patch_panel', label: 'Patch panel' },
          { key: 'nobreak', label: 'Nobreak' },
          { key: 'estabilizador', label: 'Estabilizador' },
        ],
      },
      {
        key: 'impressao', label: 'Impressão', category: 'patrimonio',
        types: [
          { key: 'impressora', label: 'Impressora' },
          { key: 'multifuncional', label: 'Multifuncional' },
          { key: 'scanner', label: 'Scanner' },
          { key: 'plotter', label: 'Plotter' },
          { key: 'etiquetadora', label: 'Etiquetadora' },
        ],
      },
      {
        key: 'eletrica', label: 'Elétrica', category: 'patrimonio',
        types: [
          { key: 'extensao', label: 'Extensão' },
          { key: 'regua_energia', label: 'Régua de energia' },
          { key: 'filtro_linha', label: 'Filtro de linha' },
          { key: 'tomada_parede', label: 'Tomada de parede' },
          { key: 'quadro_energia', label: 'Quadro de energia' },
          { key: 'adaptador_tomada', label: 'Adaptador de tomada' },
        ],
      },
      {
        key: 'predial_seguranca', label: 'Predial / Segurança', category: 'patrimonio',
        types: [
          { key: 'fechadura', label: 'Fechadura' },
          { key: 'fechadura_eletronica', label: 'Fechadura eletrônica' },
          { key: 'camera_seguranca', label: 'Câmera de segurança' },
          { key: 'dvr_nvr', label: 'DVR / NVR' },
          { key: 'alarme', label: 'Alarme' },
          { key: 'sensor_presenca', label: 'Sensor de presença' },
          { key: 'controle_acesso', label: 'Controle de acesso' },
          { key: 'catraca', label: 'Catraca' },
          { key: 'interfone', label: 'Interfone' },
          { key: 'cofre', label: 'Cofre' },
          { key: 'extintor', label: 'Extintor' },
        ],
      },
      {
        key: 'av_comunicacao', label: 'Áudio / Vídeo', category: 'patrimonio',
        types: [
          { key: 'televisao', label: 'Televisão' },
          { key: 'projetor', label: 'Projetor' },
          { key: 'tela_projecao', label: 'Tela de projeção' },
          { key: 'soundbar', label: 'Soundbar' },
          { key: 'lousa_digital', label: 'Lousa digital' },
          { key: 'sistema_som', label: 'Sistema de som' },
          { key: 'microfone', label: 'Microfone' },
          { key: 'telefone_fixo', label: 'Telefone fixo' },
          { key: 'pabx', label: 'Central telefônica (PABX)' },
          { key: 'videoconferencia', label: 'Videoconferência' },
        ],
      },
      {
        key: 'climatizacao', label: 'Climatização', category: 'patrimonio',
        types: [
          { key: 'ar_condicionado', label: 'Ar-condicionado' },
          { key: 'ventilador', label: 'Ventilador' },
          { key: 'aquecedor', label: 'Aquecedor' },
          { key: 'purificador_ar', label: 'Purificador de ar' },
          { key: 'desumidificador', label: 'Desumidificador' },
        ],
      },
      {
        key: 'copa_cozinha', label: 'Copa / Cozinha', category: 'patrimonio',
        types: [
          { key: 'geladeira', label: 'Geladeira' },
          { key: 'frigobar', label: 'Frigobar' },
          { key: 'microondas', label: 'Microondas' },
          { key: 'cafeteira', label: 'Cafeteira' },
          { key: 'bebedouro', label: 'Bebedouro' },
          { key: 'fogao', label: 'Fogão' },
          { key: 'lava_loucas', label: 'Lava-louças' },
        ],
      },
      {
        key: 'diversos', label: 'Diversos', category: 'patrimonio',
        types: [
          { key: 'quadro_branco', label: 'Quadro branco' },
          { key: 'flip_chart', label: 'Flip chart' },
          { key: 'relogio_ponto', label: 'Relógio de ponto' },
          { key: 'cofre_chaves', label: 'Cofre de chaves' },
          { key: 'escada', label: 'Escada' },
          { key: 'carrinho', label: 'Carrinho de transporte' },
          { key: 'caixa_ferramentas', label: 'Caixa de ferramentas' },
          { key: 'lixeira', label: 'Lixeira' },
          { key: 'outro', label: 'Outro' },
        ],
      },
    ],
  };

  // Grupo "Periféricos / Acessórios" como tipos de item (para cadastro avulso).
  // Reaproveita os sub-tipos, sem repetir chaves que já existem em outros grupos.
  (function () {
    const existing = new Set();
    for (const g of CATALOG.groups) for (const t of g.types) existing.add(t.key);
    const accTypes = CATALOG.peripheralTypes.filter((t) => !existing.has(t.key));
    CATALOG.groups.push({ key: 'perifericos', label: 'Periféricos / Acessórios', category: 'patrimonio', types: accTypes });
  })();

  // Mapas auxiliares (tipo -> rótulo, tipo -> categoria)
  const TYPE_LABEL = {};
  const TYPE_CATEGORY = {};
  for (const g of CATALOG.groups) {
    for (const t of g.types) { TYPE_LABEL[t.key] = t.label; TYPE_CATEGORY[t.key] = g.category; }
  }
  for (const t of CATALOG.peripheralTypes) TYPE_LABEL[t.key] = t.label;

  // ===========================================================================
  // Persistência (localStorage; cai para memória se indisponível)
  // ===========================================================================
  const hasLS = (function () {
    try {
      if (typeof localStorage === 'undefined') return false;
      const k = '__pat_test__';
      localStorage.setItem(k, '1'); localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  let DB = null;
  let firstRun = false;

  function nowLocal() {
    // 'AAAA-MM-DD HH:MM:SS' em horário local (equivalente a datetime('now','localtime'))
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  // ===========================================================================
  // Senhas dos operadores — hash SHA-256 com sal (não guardamos a senha em texto)
  // Observação: por ser um app que roda no navegador, isto serve para identificar
  // operadores e registrar quem fez cada ação, não como segurança forte.
  // ===========================================================================
  function sha256(ascii) {
    function rr(n, x) { return (x >>> n) | (x << (32 - n)); }
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const bytes = [];
    for (let i = 0; i < ascii.length; i++) { const c = ascii.charCodeAt(i); if (c < 128) bytes.push(c); else if (c < 2048) { bytes.push(192 | (c >> 6), 128 | (c & 63)); } else { bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } }
    const l = bytes.length * 8; bytes.push(0x80); while ((bytes.length % 64) !== 56) bytes.push(0);
    const hi = Math.floor(l / 4294967296), lo = l >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    const w = new Array(64);
    for (let j = 0; j < bytes.length; j += 64) {
      for (let t = 0; t < 16; t++) w[t] = ((bytes[j + t * 4] << 24) | (bytes[j + t * 4 + 1] << 16) | (bytes[j + t * 4 + 2] << 8) | (bytes[j + t * 4 + 3])) | 0;
      for (let t = 16; t < 64; t++) { const s0 = rr(7, w[t - 15]) ^ rr(18, w[t - 15]) ^ (w[t - 15] >>> 3); const s1 = rr(17, w[t - 2]) ^ rr(19, w[t - 2]) ^ (w[t - 2] >>> 10); w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0; }
      let a = H[0], b = H[1], c2 = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let t = 0; t < 64; t++) { const S1 = rr(6, e) ^ rr(11, e) ^ rr(25, e); const ch = (e & f) ^ ((~e) & g); const t1 = (h + S1 + ch + K[t] + w[t]) | 0; const S0 = rr(2, a) ^ rr(13, a) ^ rr(22, a); const mj = (a & b) ^ (a & c2) ^ (b & c2); const t2b = (S0 + mj) | 0; h = g; g = f; f = e; e = (d + t1) | 0; d = c2; c2 = b; b = a; a = (t1 + t2b) | 0; }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c2) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    let out = ''; for (let i = 0; i < 8; i++) out += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
    return out;
  }
  function randSalt() {
    let s = '';
    for (let i = 0; i < 4; i++) s += ('00000000' + Math.floor(Math.random() * 0x100000000).toString(16)).slice(-8);
    return s;
  }
  function hashPassword(pw) { const salt = randSalt(); return salt + '$' + sha256(salt + (pw || '')); }
  function verifyPassword(pw, stored) {
    if (!stored || stored.indexOf('$') < 0) return false;
    const idx = stored.indexOf('$'); const salt = stored.slice(0, idx); const h = stored.slice(idx + 1);
    return sha256(salt + (pw || '')) === h;
  }
  function defaultUsers() {
    return [{ id: 1, login: 'admin', name: 'Administrador', pass_hash: hashPassword('admin123'), role: 'admin', active: true, created_at: nowLocal() }];
  }
  function defaultSettings() { return { company: COMPANY, tag_prefix: TAG_PREFIX }; }
  const userPublic = (u) => ({ id: u.id, login: u.login, name: u.name, role: u.role, active: u.active !== false, created_at: u.created_at });

  function emptyDB() {
    return {
      version: 1,
      seq: { people: 0, assets: 0, peripherals: 0, assignments: 0, audit_log: 0, users: 1, rooms: 0 },
      settings: defaultSettings(),
      users: defaultUsers(),
      people: [], assets: [], peripherals: [], assignments: [], audit_log: [], rooms: [],
      inventory: { started_at: null, started_by: null, checks: {} },
    };
  }

  function ensureShape() {
    const e = emptyDB();
    if (!DB || typeof DB !== 'object') { DB = e; return; }
    for (const k of ['people', 'assets', 'peripherals', 'assignments', 'audit_log', 'rooms']) {
      if (!Array.isArray(DB[k])) DB[k] = [];
    }
    if (!DB.seq || typeof DB.seq !== 'object') DB.seq = e.seq;
    // configurações (empresa / prefixo do patrimônio)
    if (!DB.settings || typeof DB.settings !== 'object') DB.settings = defaultSettings();
    if (!DB.settings.company) DB.settings.company = COMPANY;
    if (!DB.settings.tag_prefix) DB.settings.tag_prefix = TAG_PREFIX;
    // operadores (sempre deve existir ao menos um admin, senão ninguém entra)
    if (!Array.isArray(DB.users) || DB.users.length === 0) DB.users = defaultUsers();
    if (!DB.users.some((u) => u.role === 'admin' && u.active !== false)) {
      const anyAdmin = DB.users.find((u) => u.role === 'admin');
      if (anyAdmin) anyAdmin.active = true; else DB.users.push(defaultUsers()[0]);
    }
    // inventário (compatibilidade com bancos criados antes desta versão)
    if (!DB.inventory || typeof DB.inventory !== 'object') DB.inventory = { started_at: null, started_by: null, checks: {} };
    if (!DB.inventory.checks || typeof DB.inventory.checks !== 'object') DB.inventory.checks = {};
    if (!('started_at' in DB.inventory)) DB.inventory.started_at = null;
    if (!('started_by' in DB.inventory)) DB.inventory.started_by = null;
    // recalcula contadores a partir do maior id existente (robustez)
    for (const k of ['people', 'assets', 'peripherals', 'assignments', 'audit_log', 'users', 'rooms']) {
      const arr = Array.isArray(DB[k]) ? DB[k] : [];
      let max = 0;
      for (const row of arr) if (row && typeof row.id === 'number' && row.id > max) max = row.id;
      if (!DB.seq[k] || DB.seq[k] < max) DB.seq[k] = max;
    }
  }

  function persist() {
    if (!hasLS) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(DB)); }
    catch (e) { console.warn('[patrimonio] Falha ao salvar no navegador:', e && e.message); }
  }

  function load() {
    if (hasLS) {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try { DB = JSON.parse(raw); ensureShape(); firstRun = false; return; }
        catch (e) { console.warn('[patrimonio] Banco local ilegível, recriando com dados de exemplo.', e && e.message); }
      }
    }
    DB = emptyDB();
    seed();
    ensureShape();
    persist();
    firstRun = true;
  }

  function nextId(table) { DB.seq[table] = (DB.seq[table] || 0) + 1; return DB.seq[table]; }

  // ===========================================================================
  // Seed — dados de exemplo (apenas no primeiro uso), espelha db.js
  // ===========================================================================
  function seed() {
    const ts = nowLocal();
    const addPerson = (name, registration, department, email) => {
      const id = nextId('people');
      DB.people.push({ id, name, registration: registration || null, department: department || null, email: email || null, phone: null, notes: null, created_at: ts });
      return id;
    };
    const ana = addPerson('Ana Souza', 'F-1024', 'Operações', 'ana.souza@empresa.com');
    const bruno = addPerson('Bruno Lima', 'F-1090', 'TI', 'bruno.lima@empresa.com');
    const carla = addPerson('Carla Dias', 'F-1133', 'Comercial', 'carla.dias@empresa.com');

    const addAsset = (o) => {
      const id = nextId('assets');
      DB.assets.push({
        id, asset_tag: o.asset_tag, name: o.name || null, type: o.type, category: o.category,
        brand: o.brand || null, model: o.model || null, serial_number: o.serial_number || null,
        status: o.status || 'ativo', condition: o.condition || null, location: o.location || null,
        value_cents: o.value_cents == null ? null : o.value_cents, purchase_date: o.purchase_date || null,
        invoice_number: o.invoice_number || null, notes: o.notes || null, created_at: ts, updated_at: ts,
      });
      return id;
    };
    const nb1 = addAsset({ asset_tag: 'PAT-000001', name: 'Notebook Operações 01', type: 'notebook', category: 'equipamento', brand: 'Dell', model: 'Latitude 5440', serial_number: 'DL5440-AX12', status: 'ativo', condition: 'bom', location: 'Sala Operações', value_cents: 489000, purchase_date: '2024-03-12', invoice_number: 'NF 10422' });
    const cel1 = addAsset({ asset_tag: 'PAT-000002', name: 'Celular Comercial 01', type: 'celular', category: 'equipamento', brand: 'Samsung', model: 'Galaxy A55', serial_number: 'SM-A556-77', status: 'ativo', condition: 'novo', location: 'Comercial', value_cents: 219900, purchase_date: '2025-01-20', invoice_number: 'NF 11890' });
    addAsset({ asset_tag: 'PAT-000003', name: 'TV Sala de Reunião', type: 'televisao', category: 'patrimonio', brand: 'LG', model: '55UR8750', serial_number: 'LG55-9981', status: 'ativo', condition: 'bom', location: 'Sala de Reunião', value_cents: 329900, purchase_date: '2023-11-05', invoice_number: 'NF 9087' });
    addAsset({ asset_tag: 'PAT-000004', name: 'Roteador Wi-Fi principal', type: 'roteador', category: 'patrimonio', brand: 'Ubiquiti', model: 'UniFi U6 Pro', serial_number: 'UB-U6P-3321', status: 'ativo', condition: 'bom', location: 'Rack TI', value_cents: 119900, purchase_date: '2024-07-02', invoice_number: 'NF 10781' });
    addAsset({ asset_tag: 'PAT-000005', name: 'Cadeira ergonômica', type: 'cadeira', category: 'patrimonio', brand: 'Flexform', model: 'Brizza', serial_number: '', status: 'ativo', condition: 'bom', location: 'Operações', value_cents: 89900, purchase_date: '2024-02-10', invoice_number: 'NF 10010' });

    const addAssign = (asset_id, person_id, shift) => {
      const id = nextId('assignments');
      DB.assignments.push({ id, asset_id, person_id, shift: shift || 'integral', assigned_date: ts, returned_date: null });
      return id;
    };
    addAssign(nb1, ana, 'manha');
    addAssign(nb1, bruno, 'noite');
    addAssign(cel1, carla, 'integral');

    const addPeriph = (o) => {
      const id = nextId('peripherals');
      DB.peripherals.push({
        id, asset_tag: o.asset_tag, parent_asset_id: o.parent_asset_id, owner_id: o.owner_id == null ? null : o.owner_id,
        type: o.type, brand: o.brand || null, model: o.model || null, serial_number: o.serial_number || null,
        value_cents: o.value_cents == null ? null : o.value_cents, purchase_date: o.purchase_date || null,
        invoice_number: o.invoice_number || null, notes: o.notes || null, created_at: ts,
      });
      return id;
    };
    addPeriph({ asset_tag: 'PER-000001', parent_asset_id: nb1, owner_id: ana, type: 'headset', brand: 'Logitech', model: 'H390', value_cents: 18900, purchase_date: '2024-03-12' });
    addPeriph({ asset_tag: 'PER-000002', parent_asset_id: nb1, owner_id: bruno, type: 'mouse', brand: 'Logitech', model: 'M170', value_cents: 6900, purchase_date: '2024-03-12' });
    addPeriph({ asset_tag: 'PER-000003', parent_asset_id: nb1, owner_id: null, type: 'carregador_notebook', brand: 'Dell', model: '65W USB-C', value_cents: 24900, purchase_date: '2024-03-12' });
    addPeriph({ asset_tag: 'PER-000004', parent_asset_id: cel1, owner_id: carla, type: 'carregador_celular', brand: 'Samsung', model: '25W', value_cents: 12900, purchase_date: '2025-01-20' });

    DB.audit_log.push({ id: nextId('audit_log'), ts, actor: 'sistema', action: 'seed', entity_type: 'sistema', entity_id: null, entity_label: 'Dados de exemplo', details: 'Banco inicializado com itens de demonstração' });
  }

  // ===========================================================================
  // Acesso e helpers (espelham server.js)
  // ===========================================================================
  const personById = (id) => DB.people.find((p) => String(p.id) === String(id)) || null;
  const assetById = (id) => DB.assets.find((a) => String(a.id) === String(id)) || null;
  const peripheralById = (id) => DB.peripherals.find((p) => String(p.id) === String(id)) || null;
  const assignmentById = (id) => DB.assignments.find((g) => String(g.id) === String(id)) || null;

  function audit(actor, action, entity_type, entity_id, entity_label, details) {
    DB.audit_log.push({
      id: nextId('audit_log'), ts: nowLocal(), actor: actor || 'sistema', action, entity_type,
      entity_id: entity_id == null ? null : entity_id, entity_label: entity_label == null ? null : entity_label,
      details: details == null ? null : (typeof details === 'string' ? details : JSON.stringify(details)),
    });
  }

  function nextTag(prefix) {
    const re = /(\d+)\s*$/;
    let max = 0;
    const scan = (arr) => {
      for (const r of arr) {
        const t = r.asset_tag || '';
        if (t.indexOf(prefix + '-') === 0) { const m = re.exec(t); if (m) max = Math.max(max, parseInt(m[1], 10)); }
      }
    };
    scan(DB.assets); scan(DB.peripherals);
    return `${prefix}-${String(max + 1).padStart(6, '0')}`;
  }

  const assetLabel = (a) => `${a.asset_tag} · ${a.name || TYPE_LABEL[a.type] || a.type}`;

  function enrichAssetList(rows) {
    return rows.map((r) => {
      const owners = DB.assignments
        .filter((g) => g.asset_id === r.id && g.returned_date == null)
        .map((g) => { const p = personById(g.person_id); return p ? { person_id: p.id, name: p.name, shift: g.shift } : null; })
        .filter(Boolean);
      const peripheral_count = DB.peripherals.filter((pe) => pe.parent_asset_id === r.id).length;
      return Object.assign({}, r, { type_label: TYPE_LABEL[r.type] || r.type, owners, peripheral_count });
    });
  }

  function fullAsset(id) {
    const a0 = assetById(id);
    if (!a0) return null;
    const a = Object.assign({}, a0);
    a.type_label = TYPE_LABEL[a.type] || a.type;
    a.owners = DB.assignments
      .filter((g) => g.asset_id === a0.id && g.returned_date == null)
      .map((g) => { const p = personById(g.person_id); return p ? { id: g.id, shift: g.shift, assigned_date: g.assigned_date, person_id: p.id, name: p.name, department: p.department } : null; })
      .filter(Boolean)
      .sort((x, y) => String(x.name || '').localeCompare(String(y.name || ''), 'pt-BR'));
    a.peripherals = DB.peripherals
      .filter((pe) => pe.parent_asset_id === a0.id)
      .sort((x, y) => x.id - y.id)
      .map((pe) => { const o = personById(pe.owner_id); return Object.assign({}, pe, { owner_name: o ? o.name : null, type_label: TYPE_LABEL[pe.type] || pe.type }); });
    return a;
  }

  function lookupByTag(tagRaw) {
    let tag = (tagRaw || '').trim();
    const m = /([A-Za-z]{2,5}-\d{3,})/.exec(tag);
    if (m) tag = m[1];
    tag = tag.toUpperCase();
    const asset = DB.assets.find((a) => String(a.asset_tag || '').toUpperCase() === tag);
    if (asset) return { kind: 'asset', tag, data: fullAsset(asset.id) };
    const periph = DB.peripherals.find((p) => String(p.asset_tag || '').toUpperCase() === tag);
    if (periph) {
      const parent = fullAsset(periph.parent_asset_id);
      return { kind: 'peripheral', tag, data: Object.assign({}, periph, { type_label: TYPE_LABEL[periph.type] || periph.type, parent }) };
    }
    return null;
  }

  function tagExistsAsset(tag, exceptId) {
    return DB.assets.some((a) => a.asset_tag === tag && String(a.id) !== String(exceptId == null ? '' : exceptId));
  }
  function tagExistsPeripheral(tag, exceptId) {
    return DB.peripherals.some((p) => p.asset_tag === tag && String(p.id) !== String(exceptId == null ? '' : exceptId));
  }

  // --- Inventário (conferência física dos itens) -----------------------------
  function invCheck(assetId) {
    const c = DB.inventory && DB.inventory.checks ? DB.inventory.checks[assetId] : null;
    return c || null;
  }
  function invItem(a) {
    const c = invCheck(a.id);
    return {
      id: a.id, asset_tag: a.asset_tag, name: a.name, type: a.type, type_label: TYPE_LABEL[a.type] || a.type,
      category: a.category, status: a.status, location: a.location,
      conferido: !!c, inv_at: c ? c.at : null, inv_by: c ? c.by : null, inv_location: c ? (c.location || null) : null,
    };
  }
  function invSummary() {
    const total = DB.assets.length;
    let conferred = 0;
    for (const a of DB.assets) if (invCheck(a.id)) conferred++;
    return {
      started_at: DB.inventory.started_at, started_by: DB.inventory.started_by,
      total, conferred, pending: total - conferred,
    };
  }

  // ===========================================================================
  // Roteador — imita as rotas /api/* do servidor Express
  // ===========================================================================
  const ok = (data, status) => ({ ok: true, status: status || 200, data: data == null ? null : data });
  const fail = (status, error) => ({ ok: false, status, data: { error } });
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

  function route(method, seg, query, body, actor) {
    // seg[0] === 'api'
    const r1 = seg[1];

    // --- config / next-tag ---
    if (r1 === 'config' && method === 'GET') {
      return ok({ company: DB.settings.company, tagPrefix: DB.settings.tag_prefix, catalog: CATALOG });
    }
    if (r1 === 'config' && method === 'PUT') {
      const b = body;
      if (has(b, 'company')) {
        const c = String(b.company || '').trim().slice(0, 80);
        if (!c) return fail(400, 'Informe o nome da empresa.');
        DB.settings.company = c;
      }
      if (has(b, 'tag_prefix')) {
        const pfx = String(b.tag_prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        if (!pfx) return fail(400, 'O prefixo do patrimônio deve ter ao menos uma letra ou número.');
        DB.settings.tag_prefix = pfx;
      }
      audit(actor, 'config', 'sistema', null, 'Configurações', `Empresa: ${DB.settings.company} · Prefixo: ${DB.settings.tag_prefix}`);
      persist();
      return ok({ company: DB.settings.company, tagPrefix: DB.settings.tag_prefix });
    }
    if (r1 === 'next-tag' && method === 'GET') {
      const prefix = (query.prefix || DB.settings.tag_prefix).toString().toUpperCase().replace(/[^A-Z0-9]/g, '') || DB.settings.tag_prefix;
      return ok({ tag: nextTag(prefix) });
    }

    // --- autenticação de operadores ---
    if (r1 === 'auth') {
      const sub = seg[2];
      if (sub === 'login' && method === 'POST') {
        const login = String((body.login || '')).trim().toLowerCase();
        const u = DB.users.find((x) => String(x.login).toLowerCase() === login);
        if (!u || u.active === false || !verifyPassword(body.password, u.pass_hash)) {
          return fail(401, 'Login ou senha inválidos.');
        }
        audit(u.name || u.login, 'login', 'user', u.id, u.name, 'Entrou no sistema');
        persist();
        return ok({ user: userPublic(u) });
      }
      if (sub === 'logout' && method === 'POST') {
        const who = (body && body.name) || actor;
        audit(who, 'logout', 'user', null, who, 'Saiu do sistema');
        persist();
        return ok({ ok: true });
      }
      if (sub === 'session' && method === 'GET') {
        const u = DB.users.find((x) => String(x.id) === String(query.id));
        if (!u || u.active === false) return fail(404, 'Sessão inválida');
        return ok({ user: userPublic(u) });
      }
      return fail(404, 'Rota não encontrada');
    }

    // --- operadores (gestão) ---
    if (r1 === 'users') {
      const id = seg[2];
      if (!id) {
        if (method === 'GET') {
          const rows = DB.users.slice()
            .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', { sensitivity: 'base' }))
            .map(userPublic);
          return ok(rows);
        }
        if (method === 'POST') {
          const b = body;
          const login = String(b.login || '').trim().toLowerCase();
          const name = String(b.name || '').trim();
          if (!login) return fail(400, 'Informe o login.');
          if (!/^[a-z0-9._-]{2,40}$/.test(login)) return fail(400, 'O login deve ter de 2 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).');
          if (!name) return fail(400, 'Informe o nome do operador.');
          if (!b.password || String(b.password).length < 4) return fail(400, 'A senha deve ter ao menos 4 caracteres.');
          if (DB.users.some((u) => String(u.login).toLowerCase() === login)) return fail(409, 'Já existe um operador com esse login.');
          const role = b.role === 'admin' ? 'admin' : 'operador';
          const nid = nextId('users');
          const row = { id: nid, login, name, pass_hash: hashPassword(String(b.password)), role, active: b.active !== false, created_at: nowLocal() };
          DB.users.push(row);
          audit(actor, 'criar', 'user', nid, name, `Operador (${role})`);
          persist();
          return ok(userPublic(row), 201);
        }
        return fail(404, 'Rota não encontrada');
      }
      const cur = DB.users.find((u) => String(u.id) === String(id));
      if (!cur) return fail(404, 'Operador não encontrado');
      const activeAdmins = () => DB.users.filter((u) => u.role === 'admin' && u.active !== false);
      if (method === 'PUT') {
        const b = body;
        if (has(b, 'login')) {
          const login = String(b.login || '').trim().toLowerCase();
          if (!/^[a-z0-9._-]{2,40}$/.test(login)) return fail(400, 'Login inválido.');
          if (DB.users.some((u) => String(u.login).toLowerCase() === login && u.id !== cur.id)) return fail(409, 'Já existe um operador com esse login.');
          cur.login = login;
        }
        if (has(b, 'name') && String(b.name).trim()) cur.name = String(b.name).trim();
        if (has(b, 'role')) {
          const role = b.role === 'admin' ? 'admin' : 'operador';
          if (cur.role === 'admin' && role !== 'admin' && activeAdmins().length <= 1) return fail(400, 'É necessário ao menos um administrador ativo.');
          cur.role = role;
        }
        if (has(b, 'active')) {
          const act = !!b.active;
          if (cur.role === 'admin' && !act && activeAdmins().length <= 1) return fail(400, 'É necessário ao menos um administrador ativo.');
          cur.active = act;
        }
        if (b.password) {
          if (String(b.password).length < 4) return fail(400, 'A senha deve ter ao menos 4 caracteres.');
          cur.pass_hash = hashPassword(String(b.password));
        }
        audit(actor, 'editar', 'user', cur.id, cur.name, 'Operador atualizado');
        persist();
        return ok(userPublic(cur));
      }
      if (method === 'DELETE') {
        if (cur.role === 'admin' && activeAdmins().length <= 1) return fail(400, 'Não é possível excluir o último administrador ativo.');
        DB.users = DB.users.filter((u) => u.id !== cur.id);
        audit(actor, 'excluir', 'user', cur.id, cur.name, 'Operador removido');
        persist();
        return ok({ ok: true });
      }
      return fail(404, 'Rota não encontrada');
    }

    // --- estatísticas ---
    if (r1 === 'stats' && method === 'GET') {
      const totalItems = DB.assets.length;
      const peripheralCount = DB.peripherals.length;
      const peopleCount = DB.people.length;
      const valAssets = DB.assets.reduce((s, a) => s + (a.value_cents || 0), 0);
      const valPeriph = DB.peripherals.reduce((s, p) => s + (p.value_cents || 0), 0);
      const inMaintenance = DB.assets.filter((a) => a.status === 'manutencao').length;
      const unassigned = DB.assets.filter((a) => a.category === 'equipamento'
        && !DB.assignments.some((g) => g.asset_id === a.id && g.returned_date == null)).length;

      const catMap = {};
      for (const a of DB.assets) {
        const c = catMap[a.category] || (catMap[a.category] = { category: a.category, c: 0, v: 0 });
        c.c += 1; c.v += (a.value_cents || 0);
      }
      const byCategory = Object.values(catMap);

      const typeMap = {};
      for (const a of DB.assets) typeMap[a.type] = (typeMap[a.type] || 0) + 1;
      const byType = Object.keys(typeMap)
        .map((type) => ({ type, c: typeMap[type], label: TYPE_LABEL[type] || type }))
        .sort((x, y) => y.c - x.c);

      const statMap = {};
      for (const a of DB.assets) statMap[a.status] = (statMap[a.status] || 0) + 1;
      const byStatus = Object.keys(statMap).map((status) => ({ status, c: statMap[status] }));

      return ok({ totalItems, peripheralCount, peopleCount, totalValueCents: valAssets + valPeriph, inMaintenance, unassigned, byCategory, byType, byStatus });
    }

    // --- salas ---
    if (r1 === 'rooms') {
      const id = seg[2];
      if (!id) {
        if (method === 'GET') {
          const rows = DB.rooms.slice()
            .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', { sensitivity: 'base', numeric: true }))
            .map((r) => Object.assign({}, r, {
              item_count: DB.assets.filter((a) => (a.location || '') === r.name).length,
            }));
          return ok(rows);
        }
        if (method === 'POST') {
          const name = String(body.name || '').trim().slice(0, 80);
          if (!name) return fail(400, 'Informe o nome do local.');
          if (DB.rooms.some((r) => String(r.name).toLowerCase() === name.toLowerCase())) return fail(409, 'Já existe um local com esse nome.');
          const nid = nextId('rooms');
          const row = { id: nid, name, notes: body.notes || null, created_at: nowLocal() };
          DB.rooms.push(row);
          audit(actor, 'criar', 'room', nid, name, null);
          persist();
          return ok(Object.assign({}, row), 201);
        }
        return fail(404, 'Rota não encontrada');
      }
      const cur = DB.rooms.find((r) => String(r.id) === String(id));
      if (!cur) return fail(404, 'Local não encontrado');
      if (method === 'PUT') {
        const b = body;
        let renameInfo = null;
        if (has(b, 'name')) {
          const name = String(b.name || '').trim().slice(0, 80);
          if (!name) return fail(400, 'Informe o nome do local.');
          if (DB.rooms.some((r) => r.id !== cur.id && String(r.name).toLowerCase() === name.toLowerCase())) return fail(409, 'Já existe um local com esse nome.');
          if (name !== cur.name) {
            // Renomear a sala move junto os itens que apontam para ela.
            let moved = 0;
            for (const a of DB.assets) if ((a.location || '') === cur.name) { a.location = name; a.updated_at = nowLocal(); moved++; }
            renameInfo = `Renomeada de "${cur.name}" (${moved} itens atualizados)`;
            cur.name = name;
          }
        }
        if (has(b, 'notes')) cur.notes = b.notes;
        audit(actor, 'editar', 'room', cur.id, cur.name, renameInfo);
        persist();
        return ok(Object.assign({}, cur));
      }
      if (method === 'DELETE') {
        DB.rooms = DB.rooms.filter((r) => r.id !== cur.id);
        audit(actor, 'excluir', 'room', cur.id, cur.name, null);
        persist();
        return ok({ ok: true });
      }
      return fail(404, 'Rota não encontrada');
    }

    // --- pessoas ---
    if (r1 === 'people') {
      const id = seg[2];
      if (!id) {
        if (method === 'GET') {
          const rows = DB.people.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', { sensitivity: 'base' }))
            .map((p) => Object.assign({}, p, {
              equip_count: DB.assignments.filter((g) => g.person_id === p.id && g.returned_date == null).length,
              periph_count: DB.peripherals.filter((pe) => pe.owner_id === p.id).length,
            }));
          return ok(rows);
        }
        if (method === 'POST') {
          const b = body;
          if (!b.name) return fail(400, 'Informe o nome da pessoa.');
          const nid = nextId('people');
          const row = { id: nid, name: b.name, registration: b.registration || null, department: b.department || null, email: b.email || null, phone: b.phone || null, notes: b.notes || null, created_at: nowLocal() };
          DB.people.push(row);
          audit(actor, 'criar', 'person', nid, b.name, null);
          persist();
          return ok(Object.assign({}, row), 201);
        }
        return fail(404, 'Rota não encontrada');
      }
      const cur = personById(id);
      if (method === 'GET') {
        if (!cur) return fail(404, 'Pessoa não encontrada');
        const p = Object.assign({}, cur);
        p.assignments = DB.assignments
          .filter((g) => g.person_id === cur.id && g.returned_date == null)
          .map((g) => { const a = assetById(g.asset_id); return a ? { id: g.id, shift: g.shift, assigned_date: g.assigned_date, asset_id: a.id, asset_tag: a.asset_tag, name: a.name, type: a.type, category: a.category, type_label: TYPE_LABEL[a.type] || a.type } : null; })
          .filter(Boolean)
          .sort((x, y) => String(x.asset_tag).localeCompare(String(y.asset_tag)));
        p.peripherals = DB.peripherals
          .filter((pe) => pe.owner_id === cur.id)
          .sort((x, y) => x.id - y.id)
          .map((pe) => { const a = assetById(pe.parent_asset_id); return Object.assign({}, pe, { parent_tag: a ? a.asset_tag : null, parent_name: a ? a.name : null, type_label: TYPE_LABEL[pe.type] || pe.type }); });
        return ok(p);
      }
      if (method === 'PUT') {
        if (!cur) return fail(404, 'Pessoa não encontrada');
        const b = body;
        cur.name = has(b, 'name') ? b.name : cur.name;
        cur.registration = has(b, 'registration') ? b.registration : cur.registration;
        cur.department = has(b, 'department') ? b.department : cur.department;
        cur.email = has(b, 'email') ? b.email : cur.email;
        cur.phone = has(b, 'phone') ? b.phone : cur.phone;
        cur.notes = has(b, 'notes') ? b.notes : cur.notes;
        audit(actor, 'editar', 'person', cur.id, cur.name, null);
        persist();
        return ok(Object.assign({}, cur));
      }
      if (method === 'DELETE') {
        if (!cur) return fail(404, 'Pessoa não encontrada');
        // ON DELETE: assignments CASCADE (some), peripherals.owner_id SET NULL
        DB.assignments = DB.assignments.filter((g) => g.person_id !== cur.id);
        for (const pe of DB.peripherals) if (pe.owner_id === cur.id) pe.owner_id = null;
        DB.people = DB.people.filter((p) => p.id !== cur.id);
        audit(actor, 'excluir', 'person', cur.id, cur.name, null);
        persist();
        return ok({ ok: true });
      }
      return fail(404, 'Rota não encontrada');
    }

    // --- itens (assets) e sub-rotas ---
    if (r1 === 'assets') {
      const id = seg[2];
      const sub = seg[3];

      if (!id) {
        if (method === 'GET') {
          let rows = DB.assets.slice();
          if (query.category) rows = rows.filter((a) => a.category === query.category);
          if (query.type) rows = rows.filter((a) => a.type === query.type);
          if (query.status) rows = rows.filter((a) => a.status === query.status);
          if (query.owner) rows = rows.filter((a) => DB.assignments.some((g) => g.asset_id === a.id && String(g.person_id) === String(query.owner) && g.returned_date == null));
          if (query.q) {
            const t = String(query.q).toLowerCase();
            const hit = (v) => v != null && String(v).toLowerCase().indexOf(t) >= 0;
            rows = rows.filter((a) => hit(a.asset_tag) || hit(a.name) || hit(a.brand) || hit(a.model) || hit(a.serial_number) || hit(a.location) || hit(a.phone_number) || hit(a.imei1) || hit(a.imei2));
          }
          rows.sort((a, b) => String(a.asset_tag).localeCompare(String(b.asset_tag)));
          return ok(enrichAssetList(rows));
        }
        if (method === 'POST') {
          const b = body;
          if (!b.type) return fail(400, 'Selecione o tipo do item.');
          const category = b.category || TYPE_CATEGORY[b.type] || 'patrimonio';
          let tag = (b.asset_tag || '').trim();
          if (!tag) tag = nextTag(DB.settings.tag_prefix);
          if (tagExistsAsset(tag)) return fail(409, 'Já existe um registro com esse número de patrimônio.');
          const ts = nowLocal();
          const nid = nextId('assets');
          DB.assets.push({
            id: nid, asset_tag: tag, name: b.name || null, type: b.type, category,
            brand: b.brand || null, model: b.model || null, serial_number: b.serial_number || null,
            phone_number: b.phone_number || null,
            imei1: b.imei1 || null, imei2: b.imei2 || null,
            status: b.status || 'ativo', condition: b.condition || null, location: b.location || null,
            value_cents: b.value_cents == null ? null : b.value_cents, purchase_date: b.purchase_date || null,
            invoice_number: b.invoice_number || null, notes: b.notes || null, created_at: ts, updated_at: ts,
          });
          const a = fullAsset(nid);
          audit(actor, 'criar', 'asset', a.id, assetLabel(a), { tipo: a.type_label, valor_centavos: a.value_cents });
          persist();
          return ok(a, 201);
        }
        return fail(404, 'Rota não encontrada');
      }

      // /api/assets/:id/owners[...]
      if (sub === 'owners') {
        const a = assetById(id);
        if (method === 'POST') {
          const b = body;
          if (!a) return fail(404, 'Item não encontrado');
          if (!b.person_id) return fail(400, 'Selecione a pessoa.');
          const person = personById(b.person_id);
          if (!person) return fail(404, 'Pessoa não encontrada');
          const shift = ['manha', 'noite', 'integral'].indexOf(b.shift) >= 0 ? b.shift : 'integral';
          const dup = DB.assignments.some((g) => g.asset_id === a.id && g.person_id === person.id && g.shift === shift);
          if (dup) return fail(409, 'Essa pessoa já é dona deste item neste turno.');
          DB.assignments.push({ id: nextId('assignments'), asset_id: a.id, person_id: person.id, shift, assigned_date: nowLocal(), returned_date: null });
          audit(actor, 'atribuir', 'asset', a.id, assetLabel(a), `Dono: ${person.name} (${shift})`);
          persist();
          return ok(fullAsset(a.id), 201);
        }
        if (method === 'DELETE') {
          const assignId = seg[4];
          const g = assignmentById(assignId);
          if (!a || !g) return fail(404, 'Vínculo não encontrado');
          const person = personById(g.person_id);
          DB.assignments = DB.assignments.filter((x) => x.id !== g.id);
          audit(actor, 'remover_dono', 'asset', a.id, assetLabel(a), `Removido: ${person ? person.name : '?'} (${g.shift})`);
          persist();
          return ok(fullAsset(a.id));
        }
        return fail(404, 'Rota não encontrada');
      }

      // /api/assets/:id/peripherals (POST)
      if (sub === 'peripherals' && method === 'POST') {
        const a = assetById(id);
        const b = body;
        if (!a) return fail(404, 'Item pai não encontrado');
        if (!b.type) return fail(400, 'Selecione o tipo do sub-item.');
        let tag = (b.asset_tag || '').trim();
        if (!tag) tag = nextTag('PER');
        if (tagExistsPeripheral(tag) || tagExistsAsset(tag)) return fail(409, 'Já existe um registro com esse número de patrimônio.');
        const nid = nextId('peripherals');
        DB.peripherals.push({
          id: nid, asset_tag: tag, parent_asset_id: a.id, owner_id: b.owner_id || null, type: b.type,
          brand: b.brand || null, model: b.model || null, serial_number: b.serial_number || null,
          value_cents: b.value_cents == null ? null : b.value_cents, purchase_date: b.purchase_date || null,
          invoice_number: b.invoice_number || null, notes: b.notes || null, created_at: nowLocal(),
        });
        audit(actor, 'criar', 'peripheral', nid, `${tag} · ${TYPE_LABEL[b.type] || b.type}`, `Vinculado a ${a.asset_tag}`);
        persist();
        return ok(fullAsset(a.id), 201);
      }

      // /api/assets/:id  (GET, PUT, DELETE)
      if (!sub) {
        if (method === 'GET') {
          const a = fullAsset(id);
          if (!a) return fail(404, 'Item não encontrado');
          return ok(a);
        }
        if (method === 'PUT') {
          const cur = assetById(id);
          if (!cur) return fail(404, 'Item não encontrado');
          const b = body;
          const newTag = has(b, 'asset_tag') && b.asset_tag != null ? b.asset_tag : cur.asset_tag;
          if (newTag !== cur.asset_tag && tagExistsAsset(newTag, cur.id)) return fail(409, 'Já existe um registro com esse número de patrimônio.');
          const prevStatus = cur.status;
          cur.asset_tag = newTag;
          cur.name = has(b, 'name') ? b.name : cur.name;
          cur.type = has(b, 'type') && b.type != null ? b.type : cur.type;
          cur.category = b.category || cur.category;
          cur.brand = has(b, 'brand') ? b.brand : cur.brand;
          cur.model = has(b, 'model') ? b.model : cur.model;
          cur.serial_number = has(b, 'serial_number') ? b.serial_number : cur.serial_number;
          cur.phone_number = has(b, 'phone_number') ? b.phone_number : cur.phone_number;
          cur.imei1 = has(b, 'imei1') ? b.imei1 : cur.imei1;
          cur.imei2 = has(b, 'imei2') ? b.imei2 : cur.imei2;
          cur.status = has(b, 'status') && b.status != null ? b.status : cur.status;
          cur.condition = has(b, 'condition') ? b.condition : cur.condition;
          cur.location = has(b, 'location') ? b.location : cur.location;
          cur.value_cents = has(b, 'value_cents') ? b.value_cents : cur.value_cents;
          cur.purchase_date = has(b, 'purchase_date') ? b.purchase_date : cur.purchase_date;
          cur.invoice_number = has(b, 'invoice_number') ? b.invoice_number : cur.invoice_number;
          cur.notes = has(b, 'notes') ? b.notes : cur.notes;
          cur.updated_at = nowLocal();
          const a = fullAsset(cur.id);
          const statusChanged = b.status && b.status !== prevStatus;
          audit(actor, statusChanged ? 'status' : 'editar', 'asset', a.id, assetLabel(a), statusChanged ? `Status: ${prevStatus} → ${b.status}` : null);
          persist();
          return ok(a);
        }
        if (method === 'DELETE') {
          const cur = assetById(id);
          if (!cur) return fail(404, 'Item não encontrado');
          // ON DELETE CASCADE: peripherals (parent), assignments (asset)
          DB.peripherals = DB.peripherals.filter((pe) => pe.parent_asset_id !== cur.id);
          DB.assignments = DB.assignments.filter((g) => g.asset_id !== cur.id);
          DB.assets = DB.assets.filter((a) => a.id !== cur.id);
          if (DB.inventory && DB.inventory.checks) delete DB.inventory.checks[cur.id];
          audit(actor, 'excluir', 'asset', cur.id, assetLabel(cur), null);
          persist();
          return ok({ ok: true });
        }
      }
      return fail(404, 'Rota não encontrada');
    }

    // --- periféricos (sub-itens) ---
    if (r1 === 'peripherals') {
      const id = seg[2];
      if (!id && method === 'GET') {
        const rows = DB.peripherals.slice()
          .sort((a, b) => String(a.asset_tag).localeCompare(String(b.asset_tag)))
          .map((pe) => {
            const a = assetById(pe.parent_asset_id); const o = personById(pe.owner_id);
            return Object.assign({}, pe, { parent_tag: a ? a.asset_tag : null, parent_name: a ? a.name : null, owner_name: o ? o.name : null, type_label: TYPE_LABEL[pe.type] || pe.type });
          });
        return ok(rows);
      }
      if (id) {
        const cur = peripheralById(id);
        if (method === 'PUT') {
          if (!cur) return fail(404, 'Sub-item não encontrado');
          const b = body;
          const newTag = has(b, 'asset_tag') && b.asset_tag != null ? b.asset_tag : cur.asset_tag;
          if (newTag !== cur.asset_tag && (tagExistsPeripheral(newTag, cur.id) || tagExistsAsset(newTag))) return fail(409, 'Já existe um registro com esse número de patrimônio.');
          cur.asset_tag = newTag;
          cur.owner_id = has(b, 'owner_id') ? b.owner_id : cur.owner_id;
          cur.type = has(b, 'type') ? b.type : cur.type;
          cur.brand = has(b, 'brand') ? b.brand : cur.brand;
          cur.model = has(b, 'model') ? b.model : cur.model;
          cur.serial_number = has(b, 'serial_number') ? b.serial_number : cur.serial_number;
          cur.value_cents = has(b, 'value_cents') ? b.value_cents : cur.value_cents;
          cur.purchase_date = has(b, 'purchase_date') ? b.purchase_date : cur.purchase_date;
          cur.invoice_number = has(b, 'invoice_number') ? b.invoice_number : cur.invoice_number;
          cur.notes = has(b, 'notes') ? b.notes : cur.notes;
          audit(actor, 'editar', 'peripheral', cur.id, `${cur.asset_tag} · ${TYPE_LABEL[cur.type] || cur.type}`, null);
          persist();
          return ok(fullAsset(cur.parent_asset_id));
        }
        if (method === 'DELETE') {
          if (!cur) return fail(404, 'Sub-item não encontrado');
          DB.peripherals = DB.peripherals.filter((pe) => pe.id !== cur.id);
          audit(actor, 'excluir', 'peripheral', cur.id, `${cur.asset_tag} · ${TYPE_LABEL[cur.type] || cur.type}`, null);
          persist();
          return ok(fullAsset(cur.parent_asset_id));
        }
      }
      return fail(404, 'Rota não encontrada');
    }

    // --- leitura por QR / código ---
    if (r1 === 'lookup' && method === 'GET') {
      const tag = decodeURIComponent(seg.slice(2).join('/') || '');
      const result = lookupByTag(tag);
      if (!result) return fail(404, 'Nenhum item encontrado com este patrimônio.');
      audit(actor, 'leitura', result.kind === 'asset' ? 'asset' : 'peripheral', result.data.id,
        result.kind === 'asset' ? assetLabel(result.data) : `${result.data.asset_tag} · ${result.data.type_label}`,
        'Leitura por QR/código');
      persist();
      return ok(result);
    }

    // --- auditoria ---
    if (r1 === 'audit' && method === 'GET') {
      const limit = Math.min(500, Math.max(1, parseInt(query.limit, 10) || 100));
      const offset = Math.max(0, parseInt(query.offset, 10) || 0);
      let rows = DB.audit_log.slice();
      if (query.action) rows = rows.filter((r) => r.action === query.action);
      if (query.entity) rows = rows.filter((r) => r.entity_type === query.entity);
      if (query.q) {
        const t = String(query.q).toLowerCase();
        const hit = (v) => v != null && String(v).toLowerCase().indexOf(t) >= 0;
        rows = rows.filter((r) => hit(r.entity_label) || hit(r.details) || hit(r.actor));
      }
      rows.sort((a, b) => b.id - a.id);
      const total = rows.length;
      const page = rows.slice(offset, offset + limit).map((r) => Object.assign({}, r));
      return ok({ total, rows: page });
    }

    // --- inventário (conferência física) ---
    if (r1 === 'inventory') {
      const sub = seg[2];

      // GET /api/inventory  (filtros: state=pendente|conferido, q)
      if (!sub && method === 'GET') {
        const stateF = query.state || '';
        const qF = (query.q || '').toString().toLowerCase();
        let items = DB.assets.map(invItem);
        if (qF) {
          const hit = (v) => v != null && String(v).toLowerCase().indexOf(qF) >= 0;
          items = items.filter((it) => hit(it.asset_tag) || hit(it.name) || hit(it.type_label) || hit(it.location));
        }
        const counts = {
          all: items.length,
          conferred: items.filter((it) => it.conferido).length,
          pending: items.filter((it) => !it.conferido).length,
        };
        let list = items.slice();
        if (stateF === 'pendente') list = list.filter((it) => !it.conferido);
        else if (stateF === 'conferido') list = list.filter((it) => it.conferido);
        list.sort((a, b) => String(a.asset_tag).localeCompare(String(b.asset_tag)));
        return ok({ summary: invSummary(), counts, items: list });
      }

      // POST /api/inventory/reset
      if (sub === 'reset' && method === 'POST') {
        DB.inventory.checks = {};
        DB.inventory.started_at = nowLocal();
        DB.inventory.started_by = actor;
        audit(actor, 'inventario', 'sistema', null, 'Inventário', 'Inventário reiniciado');
        persist();
        return ok({ summary: invSummary() });
      }

      // POST /api/inventory/check   body: { tag } ou { asset_id, location? }
      if (sub === 'check' && method === 'POST') {
        const b = body;
        let asset = null;
        let matched = 'asset';
        let viaTag = null;
        if (b.asset_id != null) {
          asset = assetById(b.asset_id);
          if (!asset) return fail(404, 'Item não encontrado');
        } else if (b.tag != null && String(b.tag).trim()) {
          const result = lookupByTag(b.tag);
          if (!result) return fail(404, 'Nenhum item encontrado com este patrimônio.');
          if (result.kind === 'asset') { asset = assetById(result.data.id); }
          else { asset = assetById(result.data.parent.id); matched = 'peripheral'; viaTag = result.data.asset_tag; }
        } else {
          return fail(400, 'Informe o patrimônio a conferir.');
        }
        if (!DB.inventory.started_at) { DB.inventory.started_at = nowLocal(); DB.inventory.started_by = actor; }
        const already = !!invCheck(asset.id);
        DB.inventory.checks[asset.id] = { at: nowLocal(), by: actor, location: (b.location || null) };
        const summary = invSummary();
        let completed = false;
        if (!already && summary.pending === 0 && summary.total > 0) {
          completed = true;
          audit(actor, 'inventario', 'sistema', null, 'Inventário', `Inventário concluído (${summary.total} itens conferidos)`);
        }
        persist();
        return ok({ matched, via_tag: viaTag, already, completed, item: invItem(asset), summary });
      }

      // DELETE /api/inventory/check/:assetId  (desfazer conferência)
      if (sub === 'check' && method === 'DELETE') {
        const aid = seg[3];
        const asset = assetById(aid);
        if (DB.inventory.checks) delete DB.inventory.checks[aid];
        persist();
        return ok({ item: asset ? invItem(asset) : null, summary: invSummary() });
      }

      return fail(404, 'Rota não encontrada');
    }

    return fail(404, 'Rota não encontrada');
  }

  function request(method, rawPath, body, operator) {
    method = (method || 'GET').toUpperCase();
    body = body || {};
    const actor = (operator == null ? '' : String(operator)).slice(0, 80) || 'sistema';
    const qIdx = rawPath.indexOf('?');
    const pathname = qIdx >= 0 ? rawPath.slice(0, qIdx) : rawPath;
    const query = {};
    if (qIdx >= 0) {
      const sp = new URLSearchParams(rawPath.slice(qIdx + 1));
      sp.forEach((v, k) => { query[k] = v; });
    }
    const seg = pathname.replace(/^\/+|\/+$/g, '').split('/');
    try {
      return route(method, seg, query, body, actor);
    } catch (e) {
      console.error('[patrimonio] erro na rota', method, rawPath, e);
      return fail(500, (e && e.message) || 'Erro interno');
    }
  }

  // ===========================================================================
  // QR Code no navegador (qrcode-generator → data URL GIF)
  // ===========================================================================
  function qrDataUrl(text, targetPx) {
    try {
      if (typeof global.qrcode === 'undefined') return '';
      const qr = global.qrcode(0, 'M');
      qr.addData(String(text == null ? '' : text));
      qr.make();
      const count = qr.getModuleCount();
      const margin = 1;
      const cell = Math.max(2, Math.round((targetPx || 220) / (count + margin * 2)));
      return qr.createDataURL(cell, margin);
    } catch (e) {
      console.warn('[patrimonio] falha ao gerar QR:', e && e.message);
      return '';
    }
  }

  // ===========================================================================
  // Backup (exportar / importar / reiniciar)
  // ===========================================================================
  function dump() { return JSON.stringify(DB, null, 2); }

  function restore(json) {
    let data;
    try { data = typeof json === 'string' ? JSON.parse(json) : json; }
    catch (e) { throw new Error('Arquivo inválido: não é um JSON válido.'); }
    if (!data || typeof data !== 'object' || !Array.isArray(data.assets) || !Array.isArray(data.people)) {
      throw new Error('Arquivo inválido: não parece um backup do Controle Patrimonial.');
    }
    DB = data;
    ensureShape();
    persist();
    return true;
  }

  function reset() {
    DB = emptyDB();
    seed();
    ensureShape();
    persist();
    return true;
  }

  // ===========================================================================
  // Inicializa imediatamente (scripts são "defer", então roda antes do app.js)
  // ===========================================================================
  load();

  global.Patrimonio = {
    request,
    qrDataUrl,
    dump,
    restore,
    reset,
    get firstRun() { return firstRun; },
    get persistent() { return hasLS; },
    CATALOG,
    TYPE_LABEL,
    TYPE_CATEGORY,
    STORAGE_KEY,
  };
  // atalho global usado pelos templates de QR no app.js
  global.qrDataUrl = qrDataUrl;
})(typeof window !== 'undefined' ? window : this);
