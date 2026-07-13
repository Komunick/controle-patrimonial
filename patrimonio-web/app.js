'use strict';
/*
 * Controle Patrimonial — aplicação de página única (SPA) em JavaScript puro.
 * Sem framework e sem dependências de rede: tudo é servido localmente.
 */
(function () {
  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------
  const state = {
    config: null,        // { company, tagPrefix, catalog }
    catalog: null,       // atalho para config.catalog
    people: null,        // cache de pessoas para os <select>
    rooms: null,         // cache de salas (aba Salas e sugestões de Local)
    user: null,          // operador autenticado { id, login, name, role }
    operator: '',        // nome do operador (registrado na auditoria)
    route: { seg: 'painel', rest: [] },
  };
  const SESSION_KEY = 'patrimonio.session';
  const CLIENT_ID = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  let evtSource = null;        // conexão de tempo real (SSE)
  let pendingRefresh = false;  // atualização adiada enquanto o operador está ocupado
  const isAdmin = () => !!(state.user && state.user.role === 'admin');

  let invRefresh = null;       // recarrega a lista do inventário sem perder o foco do leitor
  let invFilter = 'todos';     // filtro atual do inventário: todos | pendente | conferido
  let invLastScan = { text: '', at: 0 };

  // ---------------------------------------------------------------------------
  // Atalhos de DOM
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const view = () => $('view');

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------
  function escapeHtml(v) {
    if (v == null) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, type) {
    const wrap = $('toast-wrap');
    const t = document.createElement('div');
    t.className = 'toast ' + (type === 'err' ? 'err' : 'ok');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(6px)'; }, 3200);
    setTimeout(() => t.remove(), 3600);
  }

  // Base compartilhada: as chamadas "/api/..." vão por HTTP para o servidor
  // (server/server.js), que roda a mesma lógica do store.js e devolve os
  // mesmos formatos de resposta. O operador logado segue no cabeçalho
  // X-Operator para ser registrado na auditoria.
  async function api(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const headers = { 'X-Operator': encodeURIComponent(state.operator || ''), 'X-Client-Id': CLIENT_ID };
    let body;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(path, { method, headers, body });
    } catch (e) {
      throw new Error('Sem conexão com o servidor. Verifique a rede (ZeroTier) e se o servidor está ligado.');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* resposta sem corpo */ }
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : ('Erro ' + res.status);
      const err = new Error(msg);
      err.status = res.status; // deixa o chamador distinguir 404/409 de queda de rede
      throw err;
    }
    return data;
  }

  // dinheiro: aceita "1.234,56", "1234,56", "1234.56" e "1234"
  function parseMoneyToCents(str) {
    if (str == null) return null;
    let s = String(str).trim().replace(/[R$\s]/gi, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    return Math.round(n * 100);
  }
  function centsToInput(c) {
    if (c == null) return '';
    return (c / 100).toFixed(2).replace('.', ',');
  }
  function fmtCurrency(c) {
    if (c == null) return '—';
    return 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  }
  function fmtDateTime(s) {
    if (!s) return '—';
    const [d, t] = String(s).split(' ');
    const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
    const dd = dm ? `${dm[3]}/${dm[2]}/${dm[1]}` : (d || '');
    const hh = t ? t.slice(0, 5) : '';
    return hh ? `${dd} ${hh}` : dd;
  }

  // ---------------------------------------------------------------------------
  // Catálogo: localizar grupo/categoria/rótulo de um tipo
  // ---------------------------------------------------------------------------
  function categoryOfType(type) {
    for (const g of state.catalog.groups) {
      if (g.types.some((t) => t.key === type)) return g.category;
    }
    return 'patrimonio';
  }
  function firstTypeOfCategory(cat) {
    for (const g of state.catalog.groups) {
      if (g.category === cat && g.types.length) return g.types[0].key;
    }
    return state.catalog.groups[0].types[0].key;
  }
  function labelOfType(type) {
    for (const g of state.catalog.groups) {
      const t = g.types.find((x) => x.key === type);
      if (t) return t.label;
    }
    const p = state.catalog.peripheralTypes.find((x) => x.key === type);
    return p ? p.label : type;
  }
  function statusMeta(key) {
    return state.catalog.statuses.find((s) => s.key === key) || { key, label: key, color: '#6B7280' };
  }
  function shiftLabel(key) {
    const s = state.catalog.shifts.find((x) => x.key === key);
    return s ? s.label : key;
  }

  // ---------------------------------------------------------------------------
  // Construtores de <select> e marcadores visuais
  // ---------------------------------------------------------------------------
  function typeSelectOptions(selected, onlyCategory) {
    let html = '';
    for (const g of state.catalog.groups) {
      if (onlyCategory && g.category !== onlyCategory) continue;
      html += `<optgroup label="${escapeHtml(g.label)}">`;
      for (const t of g.types) {
        html += `<option value="${t.key}"${t.key === selected ? ' selected' : ''}>${escapeHtml(t.label)}</option>`;
      }
      html += '</optgroup>';
    }
    return html;
  }
  function statusOptions(selected) {
    return state.catalog.statuses
      .map((s) => `<option value="${s.key}"${s.key === selected ? ' selected' : ''}>${escapeHtml(s.label)}</option>`)
      .join('');
  }
  function conditionOptions(selected) {
    return '<option value="">—</option>' + state.catalog.conditions
      .map((c) => `<option value="${c.key}"${c.key === selected ? ' selected' : ''}>${escapeHtml(c.label)}</option>`)
      .join('');
  }
  function shiftOptions(selected) {
    return state.catalog.shifts
      .map((s) => `<option value="${s.key}"${s.key === selected ? ' selected' : ''}>${escapeHtml(s.label)}</option>`)
      .join('');
  }
  function peripheralTypeOptions(selected) {
    return state.catalog.peripheralTypes
      .map((p) => `<option value="${p.key}"${p.key === selected ? ' selected' : ''}>${escapeHtml(p.label)}</option>`)
      .join('');
  }
  function peopleOptions(selectedId, placeholder) {
    const ph = `<option value="">${escapeHtml(placeholder || '—')}</option>`;
    const list = (state.people || [])
      .map((p) => `<option value="${p.id}"${String(p.id) === String(selectedId) ? ' selected' : ''}>${escapeHtml(p.name)}${p.department ? ' · ' + escapeHtml(p.department) : ''}</option>`)
      .join('');
    return ph + list;
  }
  function roomOptions(selectedName, placeholder) {
    const ph = `<option value="">${escapeHtml(placeholder || 'Escolha um local cadastrado…')}</option>`;
    const list = (state.rooms || [])
      .map((r) => `<option value="${escapeHtml(r.name)}"${String(r.name) === String(selectedName || '') ? ' selected' : ''}>${escapeHtml(r.name)}</option>`)
      .join('');
    return ph + list;
  }

  function tagChip(tag, isPer) {
    return `<span class="tag${isPer ? ' tag-per' : ''}">${escapeHtml(tag)}</span>`;
  }
  function statusPill(key) {
    const m = statusMeta(key);
    return `<span class="pill" style="--pc:${m.color}">${escapeHtml(m.label)}</span>`;
  }
  function shiftPill(shift) {
    const cls = shift === 'manha' ? 'shift-manha' : shift === 'noite' ? 'shift-noite' : 'shift-integral';
    return `<span class="pill ${cls}">${escapeHtml(shiftLabel(shift))}</span>`;
  }
  function categoryPill(cat) {
    const cls = cat === 'equipamento' ? 'cat-equipamento' : 'cat-patrimonio';
    return `<span class="pill ${cls}">${cat === 'equipamento' ? 'Equipamento' : 'Patrimônio'}</span>`;
  }

  async function ensurePeople(force) {
    if (force || !state.people) state.people = await api('/api/people');
    return state.people;
  }

  // ---------------------------------------------------------------------------
  // Drawer lateral
  // ---------------------------------------------------------------------------
  function openDrawer(title) {
    $('drawer-title').textContent = title || '';
    const bd = $('drawer-backdrop');
    bd.hidden = false;
    requestAnimationFrame(() => bd.classList.add('show'));
    $('drawer').classList.add('open');
    $('drawer').setAttribute('aria-hidden', 'false');
    return $('drawer-body');
  }
  function closeDrawer() {
    $('drawer-backdrop').classList.remove('show');
    $('drawer').classList.remove('open');
    $('drawer').setAttribute('aria-hidden', 'true');
    setTimeout(() => { $('drawer-backdrop').hidden = true; $('drawer-body').innerHTML = ''; }, 200);
    if (pendingRefresh) { pendingRefresh = false; setTimeout(rerender, 60); }
  }

  // ---------------------------------------------------------------------------
  // Modal de confirmação e definição de operador
  // ---------------------------------------------------------------------------
  function confirmDialog(title, msg, confirmLabel, danger) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-backdrop';
      back.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(msg)}</p>
          <div class="form-actions">
            <button class="btn btn-ghost" data-act="cancel">Cancelar</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${escapeHtml(confirmLabel || 'Confirmar')}</button>
          </div>
        </div>`;
      document.body.appendChild(back);
      const done = (val) => { back.remove(); resolve(val); };
      back.querySelector('[data-act="cancel"]').onclick = () => done(false);
      back.querySelector('[data-act="ok"]').onclick = () => done(true);
      back.addEventListener('click', (e) => { if (e.target === back) done(false); });
    });
  }

  // ---------------------------------------------------------------------------
  // Topbar / navegação
  // ---------------------------------------------------------------------------
  const NAV = [
    { seg: 'painel', label: 'Painel', ico: '▦' },
    { seg: 'equipamentos', label: 'Itens', ico: '▣' },
    { seg: 'pesquisa', label: 'Pesquisa', ico: '⌕' },
    { seg: 'pessoas', label: 'Pessoas', ico: '☻' },
    { seg: 'salas', label: 'Locais', ico: '⌂' },
    { seg: 'homeoffice', label: 'Home Office', ico: '⇄' },
    { seg: 'epis', label: 'EPIs', ico: '⛑' },
    { seg: 'materiais', label: 'Materiais', ico: '▤' },
    { sep: true },
    { seg: 'inventario', label: 'Inventário', ico: '☑' },
    { seg: 'inspecao', label: 'Inspeção 5S', ico: '✦' },
    { seg: 'etiquetas', label: 'Etiquetas', ico: '❒' },
    { seg: 'auditoria', label: 'Auditoria', ico: '≣' },
    { sep: true },
    { seg: 'operadores', label: 'Operadores', ico: '◉', adminOnly: true },
    { seg: 'config', label: 'Configurações', ico: '⚙' },
  ];
  function buildNav() {
    $('nav').innerHTML = NAV
      .filter((n) => !n.adminOnly || isAdmin())
      .map((n) => n.sep
        ? '<div class="nav-sep"></div>'
        : `<a href="#/${n.seg}" data-seg="${n.seg}"><span class="ico">${n.ico}</span>${escapeHtml(n.label)}</a>`)
      .join('');
  }
  function setActive(seg) {
    document.querySelectorAll('#nav a').forEach((a) => {
      a.classList.toggle('active', a.dataset.seg === seg);
    });
  }
  function setTitle(t) { $('page-title').textContent = t; }
  function setTopbar(html) { $('topbar-actions').innerHTML = html || ''; }

  // ---------------------------------------------------------------------------
  // Roteamento
  // ---------------------------------------------------------------------------
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean);
    return { seg: parts[0] || 'painel', rest: parts.slice(1) };
  }

  async function handleRoute() {
    pendingRefresh = false; // navegar já busca dados frescos
    const { seg, rest } = parseHash();
    state.route = { seg, rest };

    if (seg === 'a') { // rota especial: abrir item por patrimônio
      await openAssetByTag(decodeURIComponent(rest.join('/')));
      return;
    }
    setActive(seg);
    closeSidebar();
    try {
      switch (seg) {
        case 'painel': setTitle('Painel'); setTopbar(''); await renderPainel(); break;
        case 'equipamentos': setTitle('Itens'); await renderItems(); break;
        case 'pesquisa': setTitle('Pesquisa'); setTopbar(''); await renderSearch(); break;
        case 'pessoas': setTitle('Pessoas'); await renderPeople(); break;
        case 'salas': setTitle('Locais'); await renderRooms(); break;
        case 'homeoffice': setTitle('Home Office'); await renderHomeOffice(); break;
        case 'epis': setTitle('Entrega de EPIs'); await renderEpis(); break;
        case 'materiais': setTitle('Relação de materiais'); await renderMateriais(); break;
        case 'inventario': setTitle('Inventário'); setTopbar(''); await renderInventory(); break;
        case 'inspecao':
          setTitle('Inspeção 5S');
          if (rest[0] === 'preencher' && rest[1]) { setTopbar(''); await renderPreencherInspecao(rest[1]); }
          else await renderInspecao5S();
          break;
        case 'etiquetas': setTitle('Etiquetas'); setTopbar(''); await renderLabels(); break;
        case 'auditoria': setTitle('Auditoria'); setTopbar(''); await renderAudit(); break;
        case 'operadores':
          if (!isAdmin()) { location.hash = '#/painel'; return; }
          setTitle('Operadores'); setTopbar(''); await renderOperators(); break;
        case 'config': setTitle('Configurações'); setTopbar(''); await renderConfig(); break;
        default: location.hash = '#/painel';
      }
    } catch (e) {
      view().innerHTML = `<div class="empty">Erro ao carregar: ${escapeHtml(e.message)}</div>`;
    }
  }

  function rerender() { handleRoute(); }

  // ---------------------------------------------------------------------------
  // Painel
  // ---------------------------------------------------------------------------
  async function renderPainel() {
    const s = await api('/api/stats');
    const recent = await api('/api/audit?limit=6');
    const catMap = {}; (s.byCategory || []).forEach((c) => { catMap[c.category] = c; });
    const equip = catMap.equipamento || { c: 0, v: 0 };
    const patr = catMap.patrimonio || { c: 0, v: 0 };
    const topTypes = (s.byType || []).slice(0, 8);
    const maxType = topTypes.reduce((m, t) => Math.max(m, t.c), 0) || 1;

    view().innerHTML = `
      <div class="cards">
        ${statCard('Itens cadastrados', s.totalItems, 'is-accent')}
        ${statCard('Valor total', fmtCurrency(s.totalValueCents), 'is-gold', true)}
        ${statCard('Pessoas', s.peopleCount)}
        ${statCard('Sub-itens (periféricos)', s.peripheralCount)}
        ${statCard('Em manutenção', s.inMaintenance, s.inMaintenance ? 'is-warn' : '')}
        ${statCard('Equipamentos sem dono', s.unassigned, s.unassigned ? 'is-warn' : '')}
      </div>

      <div class="panel">
        <div class="panel-pad">
          <div class="section-title">Por categoria</div>
          <div class="line-item">
            <div class="li-main"><div class="li-title">${categoryPill('equipamento')} Equipamentos</div>
              <div class="li-sub">${equip.c} ${equip.c === 1 ? 'item' : 'itens'}</div></div>
            <div class="li-val val-cur">${fmtCurrency(equip.v)}</div>
          </div>
          <div class="line-item">
            <div class="li-main"><div class="li-title">${categoryPill('patrimonio')} Patrimônio</div>
              <div class="li-sub">${patr.c} ${patr.c === 1 ? 'item' : 'itens'}</div></div>
            <div class="li-val val-cur">${fmtCurrency(patr.v)}</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-pad">
          <div class="section-title">Tipos mais cadastrados</div>
          ${topTypes.length ? topTypes.map((t) => `
            <div class="line-item">
              <div class="li-main" style="flex:1">
                <div class="li-title">${escapeHtml(t.label)}</div>
                <div style="height:6px;border-radius:4px;background:var(--line);margin-top:6px;overflow:hidden">
                  <div style="height:100%;width:${Math.round((t.c / maxType) * 100)}%;background:var(--accent)"></div>
                </div>
              </div>
              <div class="li-val mono">${t.c}</div>
            </div>`).join('') : '<div class="empty">Nenhum item ainda.</div>'}
        </div>
      </div>

      <div class="panel">
        <div class="panel-pad">
          <div class="section-title">Atividade recente</div>
          ${(recent.rows || []).length ? recent.rows.map((r) => `
            <div class="line-item">
              <div class="li-main">
                <div class="li-title">${auditActionLabel(r.action)} <span class="muted">· ${escapeHtml(r.entity_label || '')}</span></div>
                <div class="li-sub">${escapeHtml(r.actor)} · ${fmtDateTime(r.ts)}</div>
              </div>
            </div>`).join('') : '<div class="empty">Sem registros.</div>'}
        </div>
      </div>`;
  }

  function statCard(label, value, cls, isCur) {
    return `<div class="stat ${cls || ''}">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value ${isCur ? 'cur' : ''}">${isCur ? escapeHtml(value) : `<span class="mono">${escapeHtml(String(value))}</span>`}</div>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Lista de itens (equipamentos / patrimônio)
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Itens (lista única — equipamentos e patrimônio juntos)
  // ---------------------------------------------------------------------------
  async function renderItems() {
    await ensurePeople();
    setTopbar('<button class="btn btn-primary" id="btn-new">+ Novo item</button>');

    const typeFilterOpts = '<option value="">Todos os tipos</option>' +
      state.catalog.groups.flatMap((g) => g.types.map((t) => `<option value="${t.key}">${escapeHtml(t.label)}</option>`)).join('');

    view().innerHTML = `
      <div class="toolbar">
        <div class="search"><input id="flt-q" placeholder="Buscar por patrimônio, nome, marca, série ou local…"></div>
        <select class="filter" id="flt-cat">
          <option value="">Todas as categorias</option>
          <option value="equipamento">Equipamento</option>
          <option value="patrimonio">Patrimônio</option>
        </select>
        <select class="filter" id="flt-type">${typeFilterOpts}</select>
        <select class="filter" id="flt-status"><option value="">Todos os status</option>${statusOptions('')}</select>
        <select class="filter" id="flt-owner">${peopleOptions('', 'Todos os donos')}</select>
      </div>
      <div class="panel"><div id="asset-rows"></div></div>`;

    $('btn-new').onclick = () => assetForm(null, null);

    const loadList = async () => {
      const p = new URLSearchParams();
      const q = $('flt-q').value.trim(); if (q) p.set('q', q);
      const cat = $('flt-cat').value; if (cat) p.set('category', cat);
      const ty = $('flt-type').value; if (ty) p.set('type', ty);
      const st = $('flt-status').value; if (st) p.set('status', st);
      const ow = $('flt-owner').value; if (ow) p.set('owner', ow);
      const rows = await api('/api/assets?' + p.toString());
      $('asset-rows').innerHTML = itemsTable(rows);
      wireAssetRows();
    };

    const wireAssetRows = () => {
      $('asset-rows').querySelectorAll('tr.clickable').forEach((tr) => {
        tr.addEventListener('click', (e) => { if (e.target.closest('.row-actions')) return; openAssetDetail(tr.dataset.id); });
      });
      $('asset-rows').querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => assetForm({ id: b.dataset.edit }, null, true); });
      $('asset-rows').querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          const ok = await confirmDialog('Excluir item', `Excluir o item ${b.dataset.tag}? Esta ação não pode ser desfeita.`, 'Excluir', true);
          if (!ok) return;
          try { await api('/api/assets/' + b.dataset.del, { method: 'DELETE' }); toast('Item excluído.'); loadList(); }
          catch (err) { toast(err.message, 'err'); }
        };
      });
    };

    let deb;
    $('flt-q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(loadList, 250); });
    $('flt-cat').addEventListener('change', loadList);
    $('flt-type').addEventListener('change', loadList);
    $('flt-status').addEventListener('change', loadList);
    $('flt-owner').addEventListener('change', loadList);
    await loadList();
  }

  function itemsTable(rows) {
    if (!rows.length) return '<div class="empty">Nenhum item ainda. Clique em “+ Novo item”.</div>';
    return `<div class="table-wrap"><table>
      <thead><tr><th>Patrimônio</th><th>Item</th><th>Donos</th><th>Local</th><th class="num">Sub-itens</th><th class="num">Valor</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((a) => `
        <tr class="clickable" data-id="${a.id}">
          <td>${tagChip(a.asset_tag)}</td>
          <td><div class="cell-title">${escapeHtml(a.name || a.type_label)}</div><div class="cell-sub">${escapeHtml(a.type_label)}${a.brand ? ' · ' + escapeHtml(a.brand) : ''}</div></td>
          <td>${a.owners.length ? a.owners.map((o) => escapeHtml(o.name) + (o.shift && a.category === 'equipamento' ? ' ' + shiftPill(o.shift) : '')).join('<br>') : '<span class="muted">—</span>'}</td>
          <td>${a.location ? escapeHtml(a.location) : '<span class="muted">—</span>'}</td>
          <td class="num mono">${a.peripheral_count || 0}</td>
          <td class="num val-cur">${fmtCurrency(a.value_cents)}</td>
          <td>${statusPill(a.status)}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-edit="${a.id}" title="Editar">✎</button>
            <button class="icon-btn" data-del="${a.id}" data-tag="${escapeHtml(a.asset_tag)}" title="Excluir">🗑</button>
          </div></td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  // ---------------------------------------------------------------------------
  // Pesquisa (busca global + contagem por categoria e tipo)
  // ---------------------------------------------------------------------------
  async function renderSearch() {
    await ensurePeople();
    const s = await api('/api/stats');
    const catMap = {}; (s.byCategory || []).forEach((c) => { catMap[c.category] = c; });
    const equip = catMap.equipamento || { c: 0 };
    const patr = catMap.patrimonio || { c: 0 };
    let selCat = '';
    let selType = '';
    let allPeripherals = null;

    view().innerHTML = `
      <div class="scan-card">
        <input class="wedge-input" id="sr-q" placeholder="Pesquisar por patrimônio, nome, marca, modelo, nº de série, IMEI, telefone ou local…" autocomplete="off">
        <div class="hint">A pesquisa vale para todos os campos, inclusive IMEI e telefone. Combine com os filtros abaixo.</div>
      </div>

      <div class="panel panel-pad">
        <div class="section-title">Categorias</div>
        <div class="chip-row" id="sr-cats">
          <button class="fchip active" data-cat="">Todos <span class="mono">${s.totalItems}</span></button>
          <button class="fchip" data-cat="equipamento">Equipamentos <span class="mono">${equip.c}</span></button>
          <button class="fchip" data-cat="patrimonio">Patrimônio <span class="mono">${patr.c}</span></button>
        </div>
        <div class="section-title" style="margin-top:14px">Tipos</div>
        <div class="chip-row" id="sr-types">
          ${(s.byType || []).map((t) => `<button class="fchip" data-type="${escapeHtml(t.type)}">${escapeHtml(t.label)} <span class="mono">${t.c}</span></button>`).join('')}
        </div>
      </div>

      <div class="panel">
        <div class="panel-pad" style="padding-bottom:0"><div class="section-title" id="sr-count">—</div></div>
        <div id="sr-rows"></div>
      </div>
      <div id="sr-per"></div>`;

    const loadResults = async () => {
      const p = new URLSearchParams();
      const q = $('sr-q').value.trim();
      if (q) p.set('q', q);
      if (selCat) p.set('category', selCat);
      if (selType) p.set('type', selType);
      const rows = await api('/api/assets?' + p.toString());
      const parts = [];
      if (selType) { const t = (s.byType || []).find((x) => x.type === selType); parts.push(t ? t.label : selType); }
      else if (selCat) parts.push(selCat === 'equipamento' ? 'Equipamentos' : 'Patrimônio');
      if (q) parts.push(`“${q}”`);
      $('sr-count').textContent = `${rows.length} ${rows.length === 1 ? 'item' : 'itens'}${parts.length ? ' · ' + parts.join(' · ') : ''}`;
      $('sr-rows').innerHTML = itemsTable(rows);
      $('sr-rows').querySelectorAll('tr.clickable').forEach((tr) => {
        tr.addEventListener('click', (e) => { if (e.target.closest('.row-actions')) return; openAssetDetail(tr.dataset.id); });
      });
      $('sr-rows').querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => assetForm({ id: b.dataset.edit }, null, true); });
      $('sr-rows').querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          const ok = await confirmDialog('Excluir item', `Excluir o item ${b.dataset.tag}? Esta ação não pode ser desfeita.`, 'Excluir', true);
          if (!ok) return;
          try { await api('/api/assets/' + b.dataset.del, { method: 'DELETE' }); toast('Item excluído.'); loadResults(); }
          catch (err) { toast(err.message, 'err'); }
        };
      });

      // Sub-itens: aparecem quando há texto de pesquisa
      if (q) {
        if (!allPeripherals) allPeripherals = await api('/api/peripherals');
        const t = q.toLowerCase();
        const hit = (v) => v != null && String(v).toLowerCase().indexOf(t) >= 0;
        const pers = allPeripherals.filter((pe) => hit(pe.asset_tag) || hit(pe.type_label) || hit(pe.brand) || hit(pe.model) || hit(pe.serial_number) || hit(pe.parent_tag) || hit(pe.owner_name));
        $('sr-per').innerHTML = pers.length ? `
          <div class="panel" style="margin-top:14px">
            <div class="panel-pad" style="padding-bottom:0"><div class="section-title">${pers.length} sub-${pers.length === 1 ? 'item' : 'itens'}</div></div>
            ${pers.map((pe) => `
              <div class="line-item clickable" data-parent="${pe.parent_asset_id}" style="padding:10px 18px">
                <div class="li-main">
                  <div class="li-title">${escapeHtml(pe.type_label)} ${tagChip(pe.asset_tag, true)}</div>
                  <div class="li-sub">${[pe.brand, pe.model].filter(Boolean).map(escapeHtml).join(' ') || '—'} · vinculado a ${escapeHtml(pe.parent_tag || '—')}${pe.owner_name ? ' · ' + escapeHtml(pe.owner_name) : ''}</div>
                </div>
              </div>`).join('')}
          </div>` : '';
        $('sr-per').querySelectorAll('[data-parent]').forEach((row) => {
          row.addEventListener('click', () => openAssetDetail(row.dataset.parent));
        });
      } else {
        $('sr-per').innerHTML = '';
      }
    };

    const syncChips = () => {
      $('sr-cats').querySelectorAll('.fchip').forEach((b) => b.classList.toggle('active', (b.dataset.cat || '') === selCat));
      $('sr-types').querySelectorAll('.fchip').forEach((b) => b.classList.toggle('active', b.dataset.type === selType));
    };
    $('sr-cats').querySelectorAll('.fchip').forEach((b) => {
      b.onclick = () => { selCat = b.dataset.cat || ''; selType = ''; syncChips(); loadResults(); };
    });
    $('sr-types').querySelectorAll('.fchip').forEach((b) => {
      b.onclick = () => { selType = selType === b.dataset.type ? '' : b.dataset.type; syncChips(); loadResults(); };
    });

    let deb;
    $('sr-q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(loadResults, 250); });
    $('sr-q').focus();
    await loadResults();
  }

  // ---------------------------------------------------------------------------
  // Formulário de item
  // ---------------------------------------------------------------------------
  async function assetForm(asset, presetCategory, isEdit) {
    let data = null;
    if (asset && asset.id) data = await api('/api/assets/' + asset.id);
    await ensureRooms().catch(() => { /* sugestões de sala são opcionais */ });
    const editing = !!data;
    // Tipos do grupo "Periféricos / Acessórios" (podem ser vinculados a um item).
    const accGroup = state.catalog.groups.find((g) => g.key === 'perifericos');
    const accKeys = new Set(accGroup ? accGroup.types.map((t) => t.key) : []);
    let linkAssets = [];
    if (!editing) { try { linkAssets = await api('/api/assets'); } catch { /* ignore */ } }
    const isCatalogType = (t) => state.catalog.groups.some((g) => g.types.some((x) => x.key === t));
    const isCustom = editing && !isCatalogType(data.type);
    const defType = editing && !isCustom ? data.type : firstTypeOfCategory(presetCategory || 'equipamento');
    let tagValue = editing ? data.asset_tag : '';
    if (!editing) {
      try { const r = await api('/api/next-tag'); tagValue = r.tag; } catch { /* ignore */ }
    }

    const body = openDrawer(editing ? 'Editar item' : 'Novo item');
    body.innerHTML = `
      <div class="field">
        <label for="f-type">Tipo</label>
        <select id="f-type">${typeSelectOptions(isCustom ? '' : defType)}<optgroup label="Personalizado"><option value="__custom__"${isCustom ? ' selected' : ''}>✚ Outro tipo (especificar)…</option></optgroup></select>
        <div class="hint" id="cat-hint" style="margin-top:8px"${isCustom ? ' hidden' : ''}>Categoria: <span id="cat-pill">${categoryPill(categoryOfType(defType))}</span></div>
      </div>
      <div class="field" id="custom-type-field"${isCustom ? '' : ' hidden'}>
        <label for="f-type-custom">Nome do tipo (personalizado)</label>
        <input id="f-type-custom" maxlength="60" placeholder="Ex.: Empilhadeira, Drone, Balança industrial…" value="${escapeHtml(isCustom ? data.type : '')}">
        <div class="hint">Para itens que não estão na lista de tipos.</div>
      </div>
      <div class="field" id="custom-cat-field"${isCustom ? '' : ' hidden'}>
        <label for="f-custom-cat">Categoria</label>
        <select id="f-custom-cat">
          <option value="patrimonio"${(isCustom ? data.category : (presetCategory || 'patrimonio')) === 'patrimonio' ? ' selected' : ''}>Patrimônio</option>
          <option value="equipamento"${(isCustom ? data.category : presetCategory) === 'equipamento' ? ' selected' : ''}>Equipamento (atribuível por turno)</option>
        </select>
      </div>
      ${!editing ? `
      <div class="field" id="link-field" hidden>
        <label for="f-link">Vincular a um item (opcional)</label>
        <select id="f-link"><option value="">— Não vincular (item avulso) —</option>${linkAssets.slice().sort((a, b) => String(a.asset_tag).localeCompare(String(b.asset_tag))).map((a) => `<option value="${a.id}">${escapeHtml(a.asset_tag)} · ${escapeHtml(a.name || a.type_label)}</option>`).join('')}</select>
        <div class="hint">Para periféricos/acessórios: escolha um item para cadastrar como <strong>sub-item</strong> dele (aparece na ficha dele). Em branco = item avulso. Ao vincular, Nome/Local/Status/Condição não se aplicam.</div>
      </div>` : ''}
      ${!editing ? `
      <div class="field">
        <label for="f-qty">Quantidade</label>
        <input id="f-qty" type="number" min="1" max="500" step="1" value="1">
        <div class="hint">Crie vários itens idênticos de uma vez — cada um recebe um patrimônio sequencial. O nº de série, se informado, vai só no primeiro.</div>
      </div>` : ''}
      <div class="field-row">
        <div class="field"><label for="f-tag">Patrimônio</label><input id="f-tag" value="${escapeHtml(tagValue)}" placeholder="auto"></div>
        <div class="field"><label for="f-name">Nome / descrição</label><input id="f-name" value="${escapeHtml(editing ? data.name : '')}" placeholder="Ex.: Notebook Dell Latitude"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="f-brand">Marca</label><input id="f-brand" value="${escapeHtml(editing ? data.brand : '')}"></div>
        <div class="field"><label for="f-model">Modelo</label><input id="f-model" value="${escapeHtml(editing ? data.model : '')}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="f-serial">Nº de série</label><input id="f-serial" value="${escapeHtml(editing ? data.serial_number : '')}"></div>
        <div class="field"><label for="f-location">Local</label><input id="f-location" list="rooms-dl" value="${escapeHtml(editing ? data.location : '')}" placeholder="Escolha um local ou digite…"><datalist id="rooms-dl">${(state.rooms || []).map((r) => `<option value="${escapeHtml(r.name)}"></option>`).join('')}</datalist></div>
      </div>
      <div class="field" id="phone-field"${(isCustom ? '' : defType) === 'celular' ? '' : ' hidden'}>
        <label for="f-phone">Número de telefone (linha do celular)</label>
        <input id="f-phone" inputmode="tel" maxlength="25" value="${escapeHtml(editing ? (data.phone_number || '') : '')}" placeholder="Ex.: (11) 91234-5678">
        <div class="hint">Número do chip/linha usado neste aparelho.</div>
      </div>
      <div class="field-row" id="imei-field"${(isCustom ? '' : defType) === 'celular' ? '' : ' hidden'}>
        <div class="field"><label for="f-imei1">IMEI 1</label><input id="f-imei1" inputmode="numeric" maxlength="25" value="${escapeHtml(editing ? (data.imei1 || '') : '')}" placeholder="15 dígitos"></div>
        <div class="field"><label for="f-imei2">IMEI 2</label><input id="f-imei2" inputmode="numeric" maxlength="25" value="${escapeHtml(editing ? (data.imei2 || '') : '')}" placeholder="15 dígitos (dual chip)"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="f-status">Status</label><select id="f-status">${statusOptions(editing ? data.status : 'ativo')}</select></div>
        <div class="field"><label for="f-condition">Condição</label><select id="f-condition">${conditionOptions(editing ? data.condition : '')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="f-value">Valor</label>
          <div class="with-prefix"><span class="pfx">R$</span><input id="f-value" inputmode="decimal" value="${centsToInput(editing ? data.value_cents : null)}" placeholder="0,00"></div>
        </div>
        <div class="field"><label for="f-purchase">Data da compra</label><input id="f-purchase" type="date" value="${editing && data.purchase_date ? escapeHtml(data.purchase_date) : ''}"></div>
      </div>
      <div class="field"><label for="f-invoice">Nota fiscal</label><input id="f-invoice" value="${escapeHtml(editing ? data.invoice_number : '')}" placeholder="Número da NF"></div>
      <div class="field"><label for="f-notes">Observações</label><textarea id="f-notes" rows="2">${escapeHtml(editing ? data.notes : '')}</textarea></div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="f-cancel">Cancelar</button>
        <button class="btn btn-primary" id="f-save">${editing ? 'Salvar alterações' : 'Cadastrar item'}</button>
      </div>`;

    function syncTypeUI() {
      const isC = $('f-type').value === '__custom__';
      $('custom-type-field').hidden = !isC;
      $('custom-cat-field').hidden = !isC;
      $('cat-hint').hidden = isC;
      const linkField = $('link-field');
      if (linkField) linkField.hidden = isC || !accKeys.has($('f-type').value);
      const phoneField = $('phone-field');
      if (phoneField) phoneField.hidden = isC || $('f-type').value !== 'celular';
      const imeiField = $('imei-field');
      if (imeiField) imeiField.hidden = isC || $('f-type').value !== 'celular';
      if (isC) { const ci = $('f-type-custom'); if (ci) ci.focus(); }
      else { $('cat-pill').innerHTML = categoryPill(categoryOfType($('f-type').value)); }
    }
    $('f-type').addEventListener('change', syncTypeUI);

    const qtyEl = $('f-qty');
    if (qtyEl) {
      qtyEl.addEventListener('input', () => {
        const n = parseInt(qtyEl.value, 10) || 1;
        const tagEl = $('f-tag');
        if (n > 1) { tagEl.value = ''; tagEl.disabled = true; tagEl.placeholder = 'gerados automaticamente'; }
        else { tagEl.disabled = false; tagEl.placeholder = 'auto'; if (!tagEl.value) tagEl.value = tagValue; }
      });
    }
    $('f-cancel').onclick = closeDrawer;
    $('f-save').onclick = async () => {
      let type = $('f-type').value;
      let category;
      if (type === '__custom__') {
        const custom = $('f-type-custom').value.trim();
        if (!custom) { toast('Informe o nome do tipo personalizado.', 'err'); $('f-type-custom').focus(); return; }
        type = custom;
        category = $('f-custom-cat').value || 'patrimonio';
      } else {
        category = categoryOfType(type);
      }
      const base = {
        type, category,
        name: $('f-name').value.trim() || null,
        brand: $('f-brand').value.trim() || null,
        model: $('f-model').value.trim() || null,
        serial_number: $('f-serial').value.trim() || null,
        phone_number: type === 'celular' ? ($('f-phone').value.trim() || null) : null,
        imei1: type === 'celular' ? ($('f-imei1').value.trim() || null) : null,
        imei2: type === 'celular' ? ($('f-imei2').value.trim() || null) : null,
        location: $('f-location').value.trim() || null,
        status: $('f-status').value,
        condition: $('f-condition').value || null,
        value_cents: parseMoneyToCents($('f-value').value),
        purchase_date: $('f-purchase').value || null,
        invoice_number: $('f-invoice').value.trim() || null,
        notes: $('f-notes').value.trim() || null,
      };
      try {
        if (editing) {
          const payload = Object.assign({ asset_tag: $('f-tag').value.trim() || undefined }, base);
          await api('/api/assets/' + data.id, { method: 'PUT', body: payload });
          toast('Item atualizado.');
          closeDrawer();
          rerender();
          return;
        }
        const qty = Math.max(1, Math.min(500, parseInt(($('f-qty') || {}).value, 10) || 1));

        // Acessório vinculado a um item existente → cria como sub-item(s) (periférico).
        const linkVisible = !!($('link-field') && !$('link-field').hidden);
        const parentId = linkVisible ? $('f-link').value : '';
        if (parentId) {
          const customTag = $('f-tag').value.trim();
          const perBase = {
            type,
            brand: base.brand, model: base.model, serial_number: base.serial_number,
            value_cents: base.value_cents, purchase_date: base.purchase_date,
            invoice_number: base.invoice_number, notes: base.notes,
          };
          for (let i = 0; i < qty; i++) {
            const b = Object.assign({}, perBase); // sem asset_tag → PER sequencial automático
            b.serial_number = i === 0 ? perBase.serial_number : null;
            if (qty === 1 && customTag && customTag !== tagValue) b.asset_tag = customTag;
            await api('/api/assets/' + parentId + '/peripherals', { method: 'POST', body: b });
          }
          toast(qty === 1 ? 'Periférico cadastrado e vinculado.' : `${qty} periféricos cadastrados e vinculados.`);
          closeDrawer();
          rerender();
          openAssetDetail(parentId);
          return;
        }

        if (qty === 1) {
          const payload = Object.assign({ asset_tag: $('f-tag').value.trim() || undefined }, base);
          const created = await api('/api/assets', { method: 'POST', body: payload });
          toast('Item cadastrado.');
          rerender();
          openAssetDetail(created.id); // permite já adicionar donos / sub-itens
        } else {
          const tags = [];
          for (let i = 0; i < qty; i++) {
            const b = Object.assign({}, base); // sem asset_tag → patrimônio sequencial automático
            b.serial_number = i === 0 ? base.serial_number : null;
            const c = await api('/api/assets', { method: 'POST', body: b });
            tags.push(c.asset_tag);
          }
          toast(`${qty} itens cadastrados (${tags[0]} a ${tags[tags.length - 1]}).`);
          closeDrawer();
          rerender();
        }
      } catch (err) { toast(err.message, 'err'); }
    };
  }

  // ---------------------------------------------------------------------------
  // Ficha do item (drawer)
  // ---------------------------------------------------------------------------
  async function openAssetDetail(id) {
    const a = await api('/api/assets/' + id);
    await ensurePeople();
    await ensureRooms();
    openDrawer(a.asset_tag);
    renderAssetDetail(a);
  }

  function renderAssetDetail(a) {
    const isEquip = a.category === 'equipamento';
    const body = $('drawer-body');
    $('drawer-title').textContent = a.asset_tag;

    const kv = [
      ['Marca', a.brand], ['Modelo', a.model], ['Nº de série', a.serial_number],
      ['Telefone', a.phone_number],
      ['IMEI 1', a.imei1], ['IMEI 2', a.imei2],
      ['Local', a.location], ['Condição', a.condition ? labelCondition(a.condition) : null],
    ].filter(([, v]) => v);

    body.innerHTML = `
      <div class="detail-head">
        <img class="qr" src="${qrDataUrl(a.asset_tag, 180)}" alt="QR ${escapeHtml(a.asset_tag)}">
        <div class="dh-info">
          <div class="li-title" style="font-size:16px">${escapeHtml(a.name || a.type_label)}</div>
          <div class="dh-meta">${tagChip(a.asset_tag)} ${categoryPill(a.category)} ${statusPill(a.status)}</div>
          <div class="li-sub" style="margin-top:6px">${escapeHtml(a.type_label)}</div>
        </div>
      </div>

      <dl class="kv">
        ${kv.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}
        <dt>Valor</dt><dd class="val-cur">${fmtCurrency(a.value_cents)}</dd>
        <dt>Data da compra</dt><dd>${fmtDate(a.purchase_date)}</dd>
        ${a.invoice_number ? `<dt>Nota fiscal</dt><dd>${escapeHtml(a.invoice_number)}</dd>` : ''}
        <dt>Cadastrado</dt><dd>${fmtDateTime(a.created_at)}</dd>
        ${a.notes ? `<dt>Observações</dt><dd>${escapeHtml(a.notes)}</dd>` : ''}
      </dl>

      <div class="form-actions" style="justify-content:flex-start">
        <button class="btn btn-ghost btn-sm" id="d-edit">✎ Editar</button>
        <button class="btn btn-danger btn-sm" id="d-del">🗑 Excluir</button>
      </div>

      <div class="sub">
        <div class="sub-title">${isEquip ? 'Donos / Turnos' : 'Responsável'} <span class="count">${a.owners.length}</span></div>
        <div class="owners" id="d-owners">${ownersList(a, isEquip)}</div>
        <div class="inline-form" id="d-owner-form">
          <select id="o-person">${peopleOptions('', 'Selecione a pessoa…')}</select>
          ${isEquip ? `<select id="o-shift">${shiftOptions('integral')}</select>` : ''}
          <button class="btn btn-primary btn-sm" id="o-add">Adicionar ${isEquip ? 'dono' : 'responsável'}</button>
        </div>
      </div>

      <div class="sub">
        <div class="sub-title">Local <span class="count">${a.location ? 1 : 0}</span></div>
        <div class="owners" id="d-local">${a.location
          ? `<div class="line-item"><div class="li-main"><div class="li-title">${escapeHtml(a.location)}</div></div>
             <div class="row-actions"><button class="icon-btn" id="l-rm" title="Remover local">✕</button></div></div>`
          : '<div class="empty">Nenhum local definido.</div>'}</div>
        <div class="inline-form" id="d-local-form">
          <select id="l-room">${roomOptions(a.location)}</select>
          <input id="l-new" maxlength="80" placeholder="…ou digite um novo local">
          <button class="btn btn-primary btn-sm" id="l-add">Adicionar local</button>
        </div>
      </div>

      <div class="sub">
        <div class="sub-title">Sub-itens (periféricos) <span class="count">${a.peripherals.length}</span></div>
        <div id="d-peripherals">${peripheralsList(a)}</div>
        <div class="inline-form" id="d-per-form">
          <select id="p-type">${peripheralTypeOptions('')}</select>
          <select id="p-owner">${peopleOptions('', 'Dono (opcional)…')}</select>
          <input id="p-brand" placeholder="Marca">
          <input id="p-model" placeholder="Modelo">
          <div class="with-prefix"><span class="pfx">R$</span><input id="p-value" inputmode="decimal" placeholder="0,00"></div>
          <input id="p-date" type="date">
          <button class="btn btn-primary btn-sm" id="p-add">Adicionar sub-item</button>
        </div>
      </div>
    `;

    $('d-edit').onclick = () => assetForm({ id: a.id }, a.category, true);
    $('d-del').onclick = async () => {
      const ok = await confirmDialog('Excluir item', `Excluir o item ${a.asset_tag}? Esta ação não pode ser desfeita.`, 'Excluir', true);
      if (!ok) return;
      try { await api('/api/assets/' + a.id, { method: 'DELETE' }); toast('Item excluído.'); closeDrawer(); rerender(); }
      catch (err) { toast(err.message, 'err'); }
    };

    // adicionar dono / responsável
    $('o-add').onclick = async () => {
      const person_id = $('o-person').value;
      if (!person_id) { toast('Selecione a pessoa.', 'err'); return; }
      const shift = isEquip ? $('o-shift').value : 'integral';
      try {
        const updated = await api('/api/assets/' + a.id + '/owners', { method: 'POST', body: { person_id, shift } });
        toast('Dono adicionado.');
        renderAssetDetail(updated);
      } catch (err) { toast(err.message, 'err'); }
    };
    wireOwnerRemoval(a, isEquip);

    // definir / trocar / remover o local do item
    $('l-add').onclick = async () => {
      const novoNome = $('l-new').value.trim();
      const location = novoNome || $('l-room').value;
      if (!location) { toast('Escolha um local cadastrado ou digite um novo.', 'err'); return; }
      try {
        if (novoNome) {
          // Cadastra o local novo na lista de Locais; se já existir, só usa.
          try { await api('/api/rooms', { method: 'POST', body: { name: novoNome } }); await ensureRooms(true); }
          catch (e) { if (!/já existe/i.test(e.message || '')) throw e; }
        }
        const updated = await api('/api/assets/' + a.id, { method: 'PUT', body: { location } });
        toast('Local definido.');
        renderAssetDetail(updated);
      } catch (err) { toast(err.message, 'err'); }
    };
    const lrm = document.getElementById('l-rm');
    if (lrm) lrm.onclick = async () => {
      try {
        const updated = await api('/api/assets/' + a.id, { method: 'PUT', body: { location: null } });
        toast('Local removido.');
        renderAssetDetail(updated);
      } catch (err) { toast(err.message, 'err'); }
    };

    // adicionar periférico / sub-item
    $('p-add').onclick = async () => {
      const type = $('p-type').value;
      const payload = {
        type,
        owner_id: $('p-owner').value || null,
        brand: $('p-brand').value.trim() || null,
        model: $('p-model').value.trim() || null,
        value_cents: parseMoneyToCents($('p-value').value),
        purchase_date: $('p-date').value || null,
      };
      try {
        const updated = await api('/api/assets/' + a.id + '/peripherals', { method: 'POST', body: payload });
        toast('Sub-item adicionado.');
        renderAssetDetail(updated);
      } catch (err) { toast(err.message, 'err'); }
    };
    wirePeripheralRemoval(a);
  }

  function ownersList(a, isEquip) {
    if (!a.owners.length) return '<div class="empty">Nenhum ' + (isEquip ? 'dono' : 'responsável') + ' definido.</div>';
    return a.owners.map((o) => `
      <div class="line-item">
        <div class="li-main">
          <div class="li-title">${escapeHtml(o.name)} ${isEquip ? shiftPill(o.shift) : ''}</div>
          ${o.department ? `<div class="li-sub">${escapeHtml(o.department)}</div>` : ''}
        </div>
        <div class="row-actions"><button class="icon-btn" data-rm-owner="${o.id}" title="Remover">✕</button></div>
      </div>`).join('');
  }
  function wireOwnerRemoval(a, isEquip) {
    $('d-owners').querySelectorAll('[data-rm-owner]').forEach((b) => {
      b.onclick = async () => {
        try {
          const updated = await api('/api/assets/' + a.id + '/owners/' + b.dataset.rmOwner, { method: 'DELETE' });
          toast('Removido.');
          renderAssetDetail(updated);
        } catch (err) { toast(err.message, 'err'); }
      };
    });
  }

  function peripheralsList(a) {
    if (!a.peripherals.length) return '<div class="empty">Nenhum sub-item vinculado.</div>';
    return a.peripherals.map((p) => `
      <div class="line-item">
        <div class="li-main">
          <div class="li-title">${escapeHtml(p.type_label)} ${tagChip(p.asset_tag, true)}</div>
          <div class="li-sub">${[p.brand, p.model].filter(Boolean).map(escapeHtml).join(' ') || '—'}${p.owner_name ? ' · ' + escapeHtml(p.owner_name) : ''}</div>
        </div>
        <div class="li-val val-cur">${fmtCurrency(p.value_cents)}</div>
        <div class="row-actions"><button class="icon-btn" data-rm-per="${p.id}" title="Remover">✕</button></div>
      </div>`).join('');
  }
  function wirePeripheralRemoval(a) {
    $('d-peripherals').querySelectorAll('[data-rm-per]').forEach((b) => {
      b.onclick = async () => {
        const ok = await confirmDialog('Remover sub-item', 'Remover este periférico?', 'Remover', true);
        if (!ok) return;
        try {
          const updated = await api('/api/peripherals/' + b.dataset.rmPer, { method: 'DELETE' });
          toast('Sub-item removido.');
          renderAssetDetail(updated);
        } catch (err) { toast(err.message, 'err'); }
      };
    });
  }
  function labelCondition(key) {
    const c = state.catalog.conditions.find((x) => x.key === key);
    return c ? c.label : key;
  }

  // ---------------------------------------------------------------------------
  // Pessoas
  // ---------------------------------------------------------------------------
  async function renderPeople() {
    setTopbar(`<button class="btn btn-primary" id="btn-new-person">+ Nova pessoa</button>`);
    view().innerHTML = `
      <div class="toolbar"><div class="search"><input id="flt-pq" placeholder="Buscar pessoa por nome, matrícula ou departamento…"></div></div>
      <div class="panel"><div id="people-rows"></div></div>`;
    $('btn-new-person').onclick = () => personForm(null);

    const all = await ensurePeople(true);
    const draw = (q) => {
      const term = (q || '').toLowerCase();
      const rows = all.filter((p) => !term
        || (p.name || '').toLowerCase().includes(term)
        || (p.registration || '').toLowerCase().includes(term)
        || (p.department || '').toLowerCase().includes(term));
      $('people-rows').innerHTML = peopleTable(rows);
      $('people-rows').querySelectorAll('tr.clickable').forEach((tr) => {
        tr.addEventListener('click', (e) => { if (e.target.closest('.row-actions')) return; openPersonDetail(tr.dataset.id); });
      });
      $('people-rows').querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => personForm(all.find((p) => String(p.id) === b.dataset.edit)); });
      $('people-rows').querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          const ok = await confirmDialog('Excluir pessoa', `Excluir ${b.dataset.name}? Os vínculos com itens serão removidos.`, 'Excluir', true);
          if (!ok) return;
          try { await api('/api/people/' + b.dataset.del, { method: 'DELETE' }); toast('Pessoa excluída.'); await ensurePeople(true); rerender(); }
          catch (err) { toast(err.message, 'err'); }
        };
      });
    };
    let deb;
    $('flt-pq').addEventListener('input', (e) => { clearTimeout(deb); deb = setTimeout(() => draw(e.target.value), 200); });
    draw('');
  }

  function peopleTable(rows) {
    if (!rows.length) return '<div class="empty">Nenhuma pessoa cadastrada.</div>';
    return `<div class="table-wrap"><table>
      <thead><tr><th>Nome</th><th>Departamento</th><th>Matrícula</th><th>Contato</th><th class="num">Equip.</th><th class="num">Perif.</th><th></th></tr></thead>
      <tbody>${rows.map((p) => `
        <tr class="clickable" data-id="${p.id}">
          <td><div class="cell-title">${escapeHtml(p.name)}</div></td>
          <td>${p.department ? escapeHtml(p.department) : '<span class="muted">—</span>'}</td>
          <td>${p.registration ? escapeHtml(p.registration) : '<span class="muted">—</span>'}</td>
          <td>${escapeHtml(p.email || p.phone || '') || '<span class="muted">—</span>'}</td>
          <td class="num mono">${p.equip_count || 0}</td>
          <td class="num mono">${p.periph_count || 0}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-edit="${p.id}" title="Editar">✎</button>
            <button class="icon-btn" data-del="${p.id}" data-name="${escapeHtml(p.name)}" title="Excluir">🗑</button>
          </div></td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  async function personForm(person) {
    const editing = !!person;
    const body = openDrawer(editing ? 'Editar pessoa' : 'Nova pessoa');
    body.innerHTML = `
      <div class="field"><label for="pf-name">Nome *</label><input id="pf-name" value="${escapeHtml(editing ? person.name : '')}"></div>
      <div class="field-row">
        <div class="field"><label for="pf-reg">Matrícula</label><input id="pf-reg" value="${escapeHtml(editing ? person.registration : '')}"></div>
        <div class="field"><label for="pf-dept">Departamento</label><input id="pf-dept" value="${escapeHtml(editing ? person.department : '')}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="pf-email">E-mail</label><input id="pf-email" type="email" value="${escapeHtml(editing ? person.email : '')}"></div>
        <div class="field"><label for="pf-phone">Telefone</label><input id="pf-phone" value="${escapeHtml(editing ? person.phone : '')}"></div>
      </div>
      <div class="field"><label for="pf-notes">Observações</label><textarea id="pf-notes" rows="2">${escapeHtml(editing ? person.notes : '')}</textarea></div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="pf-cancel">Cancelar</button>
        <button class="btn btn-primary" id="pf-save">${editing ? 'Salvar' : 'Cadastrar'}</button>
      </div>`;
    $('pf-cancel').onclick = closeDrawer;
    $('pf-save').onclick = async () => {
      const payload = {
        name: $('pf-name').value.trim(),
        registration: $('pf-reg').value.trim() || null,
        department: $('pf-dept').value.trim() || null,
        email: $('pf-email').value.trim() || null,
        phone: $('pf-phone').value.trim() || null,
        notes: $('pf-notes').value.trim() || null,
      };
      if (!payload.name) { toast('Informe o nome.', 'err'); return; }
      try {
        if (editing) await api('/api/people/' + person.id, { method: 'PUT', body: payload });
        else await api('/api/people', { method: 'POST', body: payload });
        toast(editing ? 'Pessoa atualizada.' : 'Pessoa cadastrada.');
        await ensurePeople(true);
        closeDrawer();
        rerender();
      } catch (err) { toast(err.message, 'err'); }
    };
  }

  async function openPersonDetail(id) {
    const p = await api('/api/people/' + id);
    const body = openDrawer(p.name);
    body.innerHTML = `
      <dl class="kv">
        ${p.department ? `<dt>Departamento</dt><dd>${escapeHtml(p.department)}</dd>` : ''}
        ${p.registration ? `<dt>Matrícula</dt><dd>${escapeHtml(p.registration)}</dd>` : ''}
        ${p.email ? `<dt>E-mail</dt><dd>${escapeHtml(p.email)}</dd>` : ''}
        ${p.phone ? `<dt>Telefone</dt><dd>${escapeHtml(p.phone)}</dd>` : ''}
        ${p.notes ? `<dt>Observações</dt><dd>${escapeHtml(p.notes)}</dd>` : ''}
      </dl>
      <div class="form-actions" style="justify-content:flex-start"><button class="btn btn-ghost btn-sm" id="pd-edit">✎ Editar</button></div>

      <div class="sub">
        <div class="sub-title">Equipamentos atribuídos <span class="count">${p.assignments.length}</span></div>
        ${p.assignments.length ? p.assignments.map((g) => `
          <div class="line-item clickable" data-asset="${g.asset_id}">
            <div class="li-main"><div class="li-title">${escapeHtml(g.name || g.type_label)} ${tagChip(g.asset_tag)}</div>
              <div class="li-sub">${escapeHtml(g.type_label)} · ${shiftLabel(g.shift)}</div></div>
          </div>`).join('') : '<div class="empty">Nenhum equipamento.</div>'}
      </div>

      <div class="sub">
        <div class="sub-title">Periféricos sob responsabilidade <span class="count">${p.peripherals.length}</span></div>
        ${p.peripherals.length ? p.peripherals.map((pe) => `
          <div class="line-item">
            <div class="li-main"><div class="li-title">${escapeHtml(pe.type_label)} ${tagChip(pe.asset_tag, true)}</div>
              <div class="li-sub">Vinculado a ${escapeHtml(pe.parent_tag)} · ${escapeHtml(pe.parent_name || '')}</div></div>
            <div class="li-val val-cur">${fmtCurrency(pe.value_cents)}</div>
          </div>`).join('') : '<div class="empty">Nenhum periférico.</div>'}
      </div>`;
    $('pd-edit').onclick = () => personForm(p);
    body.querySelectorAll('[data-asset]').forEach((row) => {
      row.addEventListener('click', () => openAssetDetail(row.dataset.asset));
    });
  }


  // ---------------------------------------------------------------------------
  // Salas (locais cadastrados)
  // ---------------------------------------------------------------------------
  async function ensureRooms(force) {
    if (force || !state.rooms) state.rooms = await api('/api/rooms');
    return state.rooms;
  }

  function roomsTable(rows) {
    if (!rows.length) return '<div class="empty">Nenhum local cadastrado. Clique em “+ Novo local”.</div>';
    return `<div class="table-wrap"><table>
      <thead><tr><th>Local</th><th class="num">Itens no local</th><th>Observações</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td><div class="cell-title">${escapeHtml(r.name)}</div></td>
          <td class="num mono">${r.item_count || 0}</td>
          <td>${r.notes ? escapeHtml(r.notes) : '<span class="muted">—</span>'}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-edit="${r.id}" title="Editar">✎</button>
            <button class="icon-btn" data-del="${r.id}" data-name="${escapeHtml(r.name)}" title="Excluir">🗑</button>
          </div></td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  async function renderRooms() {
    setTopbar('<button class="btn btn-primary" id="btn-new-room">+ Novo local</button>');
    view().innerHTML = `
      <div class="toolbar"><div class="search"><input id="rm-q" placeholder="Buscar local…"></div></div>
      <div class="panel"><div id="room-rows"></div></div>`;
    $('btn-new-room').onclick = () => roomForm(null);

    const all = await ensureRooms(true);
    const draw = (q) => {
      const term = (q || '').toLowerCase();
      const rows = all.filter((r) => !term || (r.name || '').toLowerCase().includes(term) || (r.notes || '').toLowerCase().includes(term));
      $('room-rows').innerHTML = roomsTable(rows);
      $('room-rows').querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => roomForm(all.find((r) => String(r.id) === b.dataset.edit)); });
      $('room-rows').querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          const r = all.find((x) => String(x.id) === b.dataset.del);
          const extra = r && r.item_count ? ` Há ${r.item_count} item(ns) neste local — o Local deles não será apagado, só sai da lista de locais.` : '';
          const ok2 = await confirmDialog('Excluir local', `Excluir o local “${b.dataset.name}”?${extra}`, 'Excluir', true);
          if (!ok2) return;
          try { await api('/api/rooms/' + b.dataset.del, { method: 'DELETE' }); toast('Local excluído.'); await ensureRooms(true); rerender(); }
          catch (e) { toast(e.message, 'err'); }
        };
      });
    };
    let deb;
    $('rm-q').addEventListener('input', (e) => { clearTimeout(deb); deb = setTimeout(() => draw(e.target.value), 200); });
    draw('');
  }

  function roomForm(room) {
    const editing = !!room;
    const body = openDrawer(editing ? 'Editar local' : 'Novo local');
    body.innerHTML = `
      <div class="field"><label for="rf-name">Nome *</label><input id="rf-name" maxlength="80" value="${escapeHtml(editing ? room.name : '')}" placeholder="Ex.: Sala 5 - Financeiro"></div>
      <div class="field"><label for="rf-notes">Observações</label><textarea id="rf-notes" rows="2">${escapeHtml(editing ? room.notes : '')}</textarea></div>
      ${editing ? '<div class="hint">Renomear o local atualiza automaticamente o Local de todos os itens que estão nele.</div>' : ''}
      <div class="form-actions">
        <button class="btn btn-ghost" id="rf-cancel">Cancelar</button>
        <button class="btn btn-primary" id="rf-save">${editing ? 'Salvar' : 'Cadastrar'}</button>
      </div>`;
    $('rf-cancel').onclick = closeDrawer;
    $('rf-save').onclick = async () => {
      const name = $('rf-name').value.trim();
      if (!name) { toast('Informe o nome do local.', 'err'); return; }
      const payload = { name, notes: $('rf-notes').value.trim() || null };
      try {
        if (editing) await api('/api/rooms/' + room.id, { method: 'PUT', body: payload });
        else await api('/api/rooms', { method: 'POST', body: payload });
        toast(editing ? 'Local atualizado.' : 'Local cadastrado.');
        await ensureRooms(true);
        closeDrawer();
        rerender();
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ---------------------------------------------------------------------------
  // Inspeção 5S — fluxo no modelo SafetyCulture
  // ---------------------------------------------------------------------------
  // A tela inicial mostra apenas o histórico de inspeções. Toda inspeção nova
  // nasce no botão "Iniciar inspeção": escolhe-se um modelo e o preenchimento é
  // feito página por página (SIM / NÃO / N/A, anotações e fotos de evidência).
  // Os modelos vêm do servidor (GET /api/inspection-templates).
  let inspModelos = null; // cache dos modelos de inspeção
  async function ensureInspModelos(force) {
    if (force || !inspModelos) inspModelos = await api('/api/inspection-templates');
    return inspModelos;
  }

  // Iniciais do modelo para o avatar da lista (ex.: "5S - Auditoria…" → "5A").
  function inspIniciais(nome) {
    const todas = String(nome || '').split(/[^A-Za-zÀ-ÿ0-9]+/).filter(Boolean);
    // ignora conectivos curtos ("de", "e") para iniciais mais legíveis
    const palavras = todas.filter((w) => w.length > 2 || /\d/.test(w));
    return ((palavras.length ? palavras : todas).slice(0, 2).map((w) => w[0]).join('') || '5S').toUpperCase();
  }

  // Agrupa o histórico por dia, como no SafetyCulture (HOJE / ONTEM / data).
  function inspGrupoDia(createdAt) {
    const dia = String(createdAt || '').slice(0, 10);
    const p = (n) => String(n).padStart(2, '0');
    const iso = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const hoje = new Date();
    if (dia === iso(hoje)) return 'Hoje';
    if (dia === iso(new Date(hoje.getTime() - 86400000))) return 'Ontem';
    return fmtDate(dia);
  }

  // Reduz a foto no navegador antes de enviar (celulares mandam fotos enormes).
  function comprimirImagem(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Escolha um arquivo de imagem (foto).'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const MAX = 1600;
          const f = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * f));
          const h = Math.max(1, Math.round(img.height * f));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL('image/jpeg', 0.85));
        } catch (e) { reject(new Error('Não foi possível processar a imagem.')); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem.')); };
      img.src = url;
    });
  }

  const RESP_5S = {
    sim: { rotulo: 'Sim', cls: 'ok' },
    nao: { rotulo: 'Não', cls: 'bad' },
    na: { rotulo: 'N/A', cls: 'na' },
    // valores de inspeções antigas (antes do formato Sim/Não)
    conforme: { rotulo: 'Conforme', cls: 'ok' },
    parcial: { rotulo: 'Parcial', cls: 'warn' },
    nao_conforme: { rotulo: 'Não conforme', cls: 'bad' },
  };
  const CLASSIF_5S = {
    excelente: { rotulo: 'Excelente', cls: 'ok' },
    organizado: { rotulo: 'Organizado', cls: 'ok2' },
    desorganizado: { rotulo: 'Desorganizado', cls: 'warn' },
    critico: { rotulo: 'Crítico (sujo/desorganizado)', cls: 'bad' },
  };
  const chip5s = (classificacao, score) => {
    const c = CLASSIF_5S[classificacao] || { rotulo: classificacao, cls: 'na' };
    return `<span class="s5-chip ${c.cls}">${score != null ? score + '% · ' : ''}${escapeHtml(c.rotulo)}</span>`;
  };

  // Tela inicial: só o histórico de inspeções (novas nascem em "Iniciar inspeção").
  async function renderInspecao5S() {
    setTopbar(`
      <button class="btn btn-ghost" id="insp-relatorio">Relatório semanal</button>
      <button class="btn btn-primary" id="insp-nova">+ Iniciar inspeção</button>`);
    $('insp-nova').onclick = iniciarInspecao;
    view().innerHTML = '<div class="empty">Carregando…</div>';
    const inspecoes = await api('/api/inspections'); // já vem mais recente primeiro
    $('insp-relatorio').onclick = () => relatorioSemanal(inspecoes);

    view().innerHTML = `
      <div class="toolbar">
        <div class="search"><input id="insp-q" placeholder="Pesquisar inspeção, local ou operador…"></div>
        <div class="chip-row" id="insp-filtros">
          <button class="fchip active" data-f="">Todas</button>
          <button class="fchip" data-f="em_andamento">Em andamento</button>
          <button class="fchip" data-f="concluida">Concluídas</button>
        </div>
        <div class="insp-count" id="insp-count"></div>
      </div>
      <div class="panel"><div id="insp-rows"></div></div>`;

    let filtro = '';
    const draw = () => {
      const term = ($('insp-q').value || '').toLowerCase();
      const rows = inspecoes.filter((i) => {
        if (filtro && (i.status || 'concluida') !== filtro) return false;
        if (!term) return true;
        return [i.template_nome || '', i.room_name || '', i.inspector || '']
          .join(' ').toLowerCase().includes(term);
      });
      $('insp-count').textContent = rows.length
        ? `1 - ${rows.length} de ${rows.length} resultado${rows.length === 1 ? '' : 's'}`
        : '0 resultados';
      if (!rows.length) {
        $('insp-rows').innerHTML = inspecoes.length
          ? '<div class="empty">Nenhuma inspeção para este filtro.</div>'
          : '<div class="empty">Nenhuma inspeção ainda. Clique em “+ Iniciar inspeção” para fazer a primeira.</div>';
        return;
      }
      let html = `<div class="table-wrap"><table>
        <thead><tr><th>Inspeção</th><th>Local</th><th>Pontuação</th><th>Realizada</th><th>Concluída</th><th></th></tr></thead><tbody>`;
      let grupo = null;
      for (const i of rows) {
        const g = inspGrupoDia(i.created_at);
        if (g !== grupo) { grupo = g; html += `<tr class="insp-grupo"><td colspan="6">${escapeHtml(g)}</td></tr>`; }
        const emAndamento = (i.status || 'concluida') === 'em_andamento';
        // rascunho é de quem o iniciou: só o dono (ou admin) continua/descarta
        const podeContinuar = emAndamento && (isAdmin() || i.inspector === state.operator);
        const podeExcluir = isAdmin() || (emAndamento && i.inspector === state.operator);
        html += `<tr class="insp-linha" data-id="${i.id}">
          <td><div class="insp-nome">
            <span class="insp-avatar">${escapeHtml(inspIniciais(i.template_nome))}</span>
            <div><div class="cell-title">${escapeHtml(i.template_nome || 'Inspeção 5S')}</div>
              <div class="muted">por ${escapeHtml(i.inspector || '—')}</div></div>
          </div></td>
          <td>${i.room_name ? escapeHtml(i.room_name) : '<span class="muted">—</span>'}</td>
          <td>${emAndamento ? '<span class="s5-chip warn">Em andamento</span>' : chip5s(i.classificacao, i.score)}</td>
          <td>${fmtDateTime(i.created_at)}</td>
          <td>${i.concluida_em ? fmtDateTime(i.concluida_em) : '<span class="muted">—</span>'}</td>
          <td><div class="row-actions">
            ${emAndamento
              ? (podeContinuar ? `<button class="btn btn-mini btn-primary" data-continuar="${i.id}">Continuar</button>` : '')
              : `<button class="btn btn-mini btn-ghost" data-ver="${i.id}">Ver</button>`}
            ${podeExcluir ? `<button class="btn btn-mini btn-ghost" data-excluir="${i.id}" title="${emAndamento ? 'Descartar rascunho' : 'Excluir inspeção'}">🗑</button>` : ''}
          </div></td>
        </tr>`;
      }
      html += '</tbody></table></div>';
      $('insp-rows').innerHTML = html;

      const porId = (idStr) => inspecoes.find((i) => String(i.id) === idStr);
      $('insp-rows').querySelectorAll('[data-continuar]').forEach((b) => {
        b.onclick = (e) => { e.stopPropagation(); location.hash = '#/inspecao/preencher/' + b.dataset.continuar; };
      });
      $('insp-rows').querySelectorAll('[data-ver]').forEach((b) => {
        b.onclick = (e) => { e.stopPropagation(); const i = porId(b.dataset.ver); if (i) detalheInspecao(i); };
      });
      $('insp-rows').querySelectorAll('[data-excluir]').forEach((b) => {
        b.onclick = async (e) => {
          e.stopPropagation();
          const i = porId(b.dataset.excluir);
          if (!i) return;
          const emAndamento = (i.status || 'concluida') === 'em_andamento';
          const ok2 = await confirmDialog(
            emAndamento ? 'Descartar rascunho' : 'Excluir inspeção',
            emAndamento
              ? `Descartar a inspeção em andamento de ${fmtDateTime(i.created_at)}? As respostas e fotos serão perdidas.`
              : `Excluir a inspeção de ${fmtDateTime(i.created_at)}${i.room_name ? ' do local “' + i.room_name + '”' : ''}? Esta ação não pode ser desfeita.`,
            emAndamento ? 'Descartar' : 'Excluir', true);
          if (!ok2) return;
          try { await api('/api/inspections/' + i.id, { method: 'DELETE' }); toast(emAndamento ? 'Rascunho descartado.' : 'Inspeção excluída.'); rerender(); }
          catch (err) { toast(err.message, 'err'); }
        };
      });
      // clicar na linha faz o mesmo que o botão principal dela
      $('insp-rows').querySelectorAll('.insp-linha').forEach((tr) => {
        tr.onclick = () => {
          const i = inspecoes.find((x) => String(x.id) === tr.dataset.id);
          if (!i) return;
          if ((i.status || 'concluida') === 'em_andamento') {
            if (isAdmin() || i.inspector === state.operator) location.hash = '#/inspecao/preencher/' + i.id;
            else toast(`Somente ${i.inspector || 'quem iniciou'} (ou um administrador) pode continuar esta inspeção.`, 'err');
          } else detalheInspecao(i);
        };
      });
    };
    $('insp-filtros').querySelectorAll('.fchip').forEach((c) => {
      c.onclick = () => {
        $('insp-filtros').querySelectorAll('.fchip').forEach((x) => x.classList.remove('active'));
        c.classList.add('active');
        filtro = c.dataset.f;
        draw();
      };
    });
    let deb;
    $('insp-q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(draw, 200); });
    draw();
  }

  // "Iniciar inspeção": com um único modelo cadastrado, abre o formulário
  // direto; a escolha de modelo só aparece se um dia houver mais de um.
  async function iniciarInspecao() {
    const btn = $('insp-nova');
    if (btn) btn.disabled = true;
    try {
      const modelos = await ensureInspModelos();
      if (!modelos.length) { toast('Nenhum modelo de inspeção disponível.', 'err'); return; }
      if (modelos.length > 1) { modalIniciarInspecao(modelos); return; }
      const r = await api('/api/inspections', { method: 'POST', body: { template_key: modelos[0].key } });
      location.hash = '#/inspecao/preencher/' + r.id;
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Modal "Qual inspeção você deseja iniciar?" — escolha do modelo.
  function modalIniciarInspecao(modelos) {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal insp-modal" role="dialog" aria-modal="true">
        <h3>Qual inspeção você deseja iniciar?</h3>
        <div class="tpl-lista">
          ${modelos.map((t) => `
            <button type="button" class="tpl-opt" data-key="${escapeHtml(t.key)}">
              <span class="insp-avatar">${escapeHtml(inspIniciais(t.nome))}</span>
              <span class="tpl-txt"><strong>${escapeHtml(t.nome)}</strong>
                <span class="muted">${escapeHtml(t.descricao || '')}</span></span>
            </button>`).join('')}
        </div>
        <div class="form-actions">
          <button class="btn btn-ghost" data-act="cancelar">Cancelar</button>
          <button class="btn btn-primary" data-act="iniciar" disabled>Iniciar inspeção</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    let key = null;
    const btnIniciar = back.querySelector('[data-act="iniciar"]');
    const fechar = () => back.remove();
    const iniciar = async () => {
      if (!key) return;
      btnIniciar.disabled = true;
      try {
        const r = await api('/api/inspections', { method: 'POST', body: { template_key: key } });
        fechar();
        location.hash = '#/inspecao/preencher/' + r.id;
      } catch (e) { btnIniciar.disabled = false; toast(e.message, 'err'); }
    };
    back.querySelectorAll('.tpl-opt').forEach((b) => {
      b.onclick = () => {
        back.querySelectorAll('.tpl-opt').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        key = b.dataset.key;
        btnIniciar.disabled = false;
      };
      b.ondblclick = () => { key = b.dataset.key; iniciar(); };
    });
    back.querySelector('[data-act="cancelar"]').onclick = fechar;
    btnIniciar.onclick = iniciar;
    back.addEventListener('click', (e) => { if (e.target === back) fechar(); });
  }

  // Formulário paginado em tela cheia (como o preenchimento do SafetyCulture):
  // "Página N de M" + seção + pontuação, cartões de pergunta, autosave e fotos.
  async function renderPreencherInspecao(id) {
    view().innerHTML = '<div class="empty">Carregando…</div>';
    let modelos;
    let insp;
    try {
      [modelos, insp] = await Promise.all([ensureInspModelos(), api('/api/inspections/' + id)]);
      await ensureRooms(true);
    } catch (e) {
      view().innerHTML = `<div class="empty">Erro ao abrir a inspeção: ${escapeHtml(e.message)}</div>`;
      return;
    }
    if ((insp.status || 'concluida') !== 'em_andamento') {
      toast('Esta inspeção já foi concluída.');
      location.hash = '#/inspecao';
      return;
    }
    if (!isAdmin() && insp.inspector !== state.operator) {
      toast(`Somente ${insp.inspector || 'quem iniciou'} (ou um administrador) pode continuar esta inspeção.`, 'err');
      location.hash = '#/inspecao';
      return;
    }
    const tpl = modelos.find((t) => t.key === insp.template_key);
    if (!tpl) {
      view().innerHTML = '<div class="empty">O modelo desta inspeção não está mais disponível.</div>';
      return;
    }

    const respostas = insp.respostas && typeof insp.respostas === 'object' ? insp.respostas : {};
    let fotos = insp.fotos && typeof insp.fotos === 'object' ? insp.fotos : {};
    let pagina = 0;
    const totalPag = tpl.paginas.length;
    const p2 = (n) => String(n).padStart(2, '0');

    // Primeira abertura: pré-preenche a data (hoje) e quem inspeciona (operador).
    const hoje = new Date();
    const hojeIso = `${hoje.getFullYear()}-${p2(hoje.getMonth() + 1)}-${p2(hoje.getDate())}`;
    for (const p of tpl.paginas) {
      for (const c of (p.campos || [])) {
        if (c.tipo === 'data' && !((respostas[c.id] || {}).v)) respostas[c.id] = { v: hojeIso };
        if (c.id === 'c_inspetor' && !((respostas[c.id] || {}).v) && state.operator) respostas[c.id] = { v: state.operator };
      }
    }

    const respOf = (qid) => (respostas[qid] = respostas[qid] || {});
    const haNao = () => Object.keys(respostas).some((k) => respostas[k] && respostas[k].resp === 'nao');
    const notasAbertas = new Set(); // anotações abertas (ainda vazias) sobrevivem ao redraw
    // Este formulário ainda está na tela? (evita redraw depois que o usuário saiu)
    const rotaAtiva = () => {
      const rt = state.route || {};
      return rt.seg === 'inspecao' && (rt.rest || [])[0] === 'preencher' && String((rt.rest || [])[1]) === String(insp.id);
    };

    // --- autosave (as respostas ficam no servidor; dá para continuar depois) ---
    // Todas as gravações passam por uma fila única, e o servidor confere a
    // versão (base_updated_at) para duas sessões não se apagarem mutuamente.
    let saveTimer = null;
    let baseRev = insp.updated_at || null;
    let fila = Promise.resolve();
    const enfileirar = (fn) => {
      const p = fila.then(fn);
      fila = p.then(() => {}, () => {});
      return p;
    };
    const setSaveTxt = (t) => { const el2 = $('insp-save'); if (el2) el2.textContent = t; };
    function salvarAgora() {
      return enfileirar(async () => {
        setSaveTxt('Salvando…');
        try {
          const r = await api('/api/inspections/' + insp.id, { method: 'PUT', body: { respostas, base_updated_at: baseRev } });
          baseRev = (r && r.updated_at) || baseRev;
          const ag = new Date();
          setSaveTxt(`Salvo automaticamente às ${p2(ag.getHours())}:${p2(ag.getMinutes())}`);
          return true;
        } catch (e) {
          if (e.status === 409) {
            // outra sessão salvou por cima: recarrega o rascunho do servidor
            toast(e.message, 'err');
            if (rotaAtiva()) renderPreencherInspecao(insp.id);
            return false;
          }
          if (e.status === 404 || e.status === 400 || e.status === 403) {
            // rascunho excluído/concluído/sem permissão: não adianta insistir
            toast((e.message || 'Inspeção indisponível') + ' — voltando ao histórico.', 'err');
            if (rotaAtiva()) location.hash = '#/inspecao';
            return false;
          }
          setSaveTxt('⚠ Falha ao salvar — verifique a conexão');
          return false;
        }
      });
    }
    function agendarSave() { clearTimeout(saveTimer); saveTimer = setTimeout(salvarAgora, 800); }

    // pontuação da página no formato do SafetyCulture: X / Y (Z%), N/A fora da conta
    function scorePagina(p) {
      let sims = 0;
      let na = 0;
      let total = 0;
      for (const q of (p.perguntas || [])) {
        if ((q.tipo || 'sim_nao') !== 'sim_nao') continue;
        total += 1;
        const r = respostas[q.id] || {};
        if (r.resp === 'sim') sims += 1;
        else if (r.resp === 'na') na += 1;
      }
      const den = total - na;
      return { sims, den, pct: den ? Math.round((sims / den) * 100) : 0, pontuavel: total > 0 };
    }

    function fotosHtml(qid, editavel) {
      const arr = Array.isArray(fotos[qid]) ? fotos[qid] : [];
      if (!arr.length) return '';
      return `<div class="insp-fotos">${arr.map((f) => `
        <span class="insp-foto">
          <a href="/api/inspections/${insp.id}/foto/${encodeURIComponent(f.arquivo)}" target="_blank" rel="noopener" title="${escapeHtml(f.nome || 'Abrir foto')}">
            <img src="/api/inspections/${insp.id}/foto/${encodeURIComponent(f.arquivo)}" alt="Foto de evidência"></a>
          ${editavel ? `<button type="button" class="insp-foto-x" data-foto-del="${escapeHtml(qid)}|${escapeHtml(f.arquivo)}" title="Remover foto">✕</button>` : ''}
        </span>`).join('')}</div>`;
    }

    function cardCampo(c) {
      const r = respostas[c.id] || {};
      const pende = c.obrigatorio && !String(r.v || '').trim();
      let input = '';
      if (c.tipo === 'local') {
        const ops = (state.rooms || []).map((rm) =>
          `<option value="${rm.id}"${String(rm.id) === String(r.v || '') ? ' selected' : ''}>${escapeHtml(rm.name)}</option>`).join('');
        input = `<select class="insp-in" data-campo="${c.id}"><option value="">Escolha um local cadastrado…</option>${ops}</select>
          ${(state.rooms || []).length ? '' : '<div class="hint">Nenhum local cadastrado ainda — cadastre na aba “Locais”.</div>'}`;
      } else if (c.tipo === 'turno') {
        const ops = (state.catalog.shifts || []).map((s) =>
          `<option value="${s.key}"${s.key === (r.v || '') ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('');
        input = `<select class="insp-in" data-campo="${c.id}"><option value="">Escolha o turno…</option>${ops}</select>`;
      } else if (c.tipo === 'data') {
        input = `<input type="date" class="insp-in" data-campo="${c.id}" value="${escapeHtml(r.v || '')}">`;
      } else {
        input = `<input type="text" class="insp-in" data-campo="${c.id}" maxlength="200" value="${escapeHtml(r.v || '')}">`;
      }
      return `<div class="s5-q${pende ? ' pende' : ''}" data-qcard="${c.id}" data-obrig="${c.obrigatorio ? '1' : ''}">
        <div class="s5-q-txt">${c.obrigatorio ? '<span class="req">*</span>' : ''}${escapeHtml(c.rotulo)}</div>
        ${input}
      </div>`;
    }

    function cardPergunta(q) {
      const tipo = q.tipo || 'sim_nao';
      const r = respostas[q.id] || {};
      let pende = false;
      let corpo = '';
      if (tipo === 'sim_nao') {
        pende = q.obrigatorio && !r.resp;
        corpo = `<div class="s5-q-resps">
          <button type="button" class="s5-btn ok${r.resp === 'sim' ? ' sel' : ''}" data-resp="sim">SIM</button>
          <button type="button" class="s5-btn bad${r.resp === 'nao' ? ' sel' : ''}" data-resp="nao">NÃO</button>
          <button type="button" class="s5-btn na${r.resp === 'na' ? ' sel' : ''}" data-resp="na">N/A</button>
        </div>`;
      } else if (tipo === 'texto') {
        const obrig = q.obrigatorio || (q.condicional === 'se_nao' && haNao());
        pende = obrig && !String(r.v || '').trim();
        corpo = `<textarea class="insp-in insp-texto" data-campo="${q.id}" rows="2" maxlength="500"
          placeholder="${escapeHtml(q.dica || 'Escreva aqui…')}">${escapeHtml(r.v || '')}</textarea>`;
      } else if (tipo === 'foto') {
        corpo = `${fotosHtml(q.id, true)}
          <button type="button" class="insp-foto-add" data-foto-add="${q.id}">🖼 Adicionar mídia</button>`;
      }
      // Perguntas SIM/NÃO têm o campo de observação sempre visível; nas de
      // texto ele fica atrás do link "Adicionar anotação" (o campo principal
      // já é um texto livre).
      const notaAberta = tipo === 'sim_nao' || !!r.obs || notasAbertas.has(q.id);
      const rodape = tipo === 'foto' ? '' : `
        <div class="insp-q-links">
          <button type="button" class="s5-nota-link" data-nota="${q.id}"${notaAberta ? ' hidden' : ''}>✎ Adicionar anotação</button>
          <button type="button" class="s5-nota-link" data-foto-add="${q.id}">📷 Anexar mídia</button>
        </div>
        <input class="s5-obs${notaAberta ? '' : ' oculta5s'}" data-obs="${q.id}" maxlength="300"
          placeholder="${r.resp === 'nao' && !r.obs ? 'O que está errado? (recomendado)' : 'Observação (opcional)…'}" value="${escapeHtml(r.obs || '')}">
        ${fotosHtml(q.id, true)}`;
      const marca = (tipo === 'sim_nao' && q.obrigatorio) || (tipo === 'texto' && (q.obrigatorio || (q.condicional === 'se_nao' && haNao())));
      return `<div class="s5-q${pende ? ' pende' : ''}" data-qcard="${q.id}" data-tipo="${tipo}">
        <div class="s5-q-txt">${marca ? '<span class="req">*</span>' : ''}${escapeHtml(q.texto)}</div>
        ${corpo}${rodape}
      </div>`;
    }

    // pendências de toda a inspeção (para validar antes de concluir)
    function pendencias() {
      const lista = [];
      const temNao = haNao();
      tpl.paginas.forEach((p, pi) => {
        for (const c of (p.campos || [])) {
          if (c.obrigatorio && !String(((respostas[c.id] || {}).v) || '').trim()) lista.push({ pi, id: c.id, texto: c.rotulo });
        }
        for (const q of (p.perguntas || [])) {
          const tipo = q.tipo || 'sim_nao';
          if (tipo === 'sim_nao') {
            if (q.obrigatorio && !((respostas[q.id] || {}).resp)) lista.push({ pi, id: q.id, texto: q.texto });
          } else if (tipo === 'texto') {
            const obrig = q.obrigatorio || (q.condicional === 'se_nao' && temNao);
            if (obrig && !String(((respostas[q.id] || {}).v) || '').trim()) lista.push({ pi, id: q.id, texto: q.texto });
          }
        }
      });
      return lista;
    }

    async function uploadFoto(qid, file) {
      if (!file) return;
      try {
        const dataUrl = await comprimirImagem(file);
        // na mesma fila do autosave, para as revisões (updated_at) não se cruzarem
        const r = await enfileirar(() => api(`/api/inspections/${insp.id}/foto`, {
          method: 'POST',
          body: { question_id: qid, foto_base64: dataUrl, nome: file.name || null },
        }));
        fotos = r.fotos || {};
        baseRev = (r && r.updated_at) || baseRev;
        drawPagina();
        toast('Foto anexada.');
      } catch (e) { toast(e.message, 'err'); }
    }

    async function removerFoto(qid, arquivo) {
      try {
        const r = await enfileirar(() => api(`/api/inspections/${insp.id}/foto`, { method: 'DELETE', body: { question_id: qid, arquivo } }));
        fotos = r.fotos || {};
        baseRev = (r && r.updated_at) || baseRev;
        drawPagina();
      } catch (e) { toast(e.message, 'err'); }
    }

    function atualizarScore() {
      const el2 = $('insp-score');
      if (!el2) return;
      const sc = scorePagina(tpl.paginas[pagina]);
      el2.textContent = `${sc.sims} / ${sc.den} (${sc.pct}%)`;
    }

    function drawPagina(irAoTopo) {
      if (!rotaAtiva()) return; // callback tardio (ex.: upload) depois que o usuário saiu
      const scrollAntes = { v: view().scrollTop, w: window.scrollY };
      const p = tpl.paginas[pagina];
      const sc = scorePagina(p);
      const cards = (p.campos || []).map(cardCampo).join('') + (p.perguntas || []).map(cardPergunta).join('');
      view().innerHTML = `
        <div class="insp-topo">
          <button class="icon-btn" id="insp-voltar" title="Voltar ao histórico">←</button>
          <div class="insp-topo-txt">
            <div class="insp-tpl-nome">${escapeHtml(tpl.nome)}</div>
            <div class="muted" id="insp-save">As respostas são salvas automaticamente</div>
          </div>
        </div>
        <div class="insp-pag-head">
          <div>
            <div class="insp-pag-num muted">Página ${pagina + 1} de ${totalPag}</div>
            <div class="insp-pag-titulo">${escapeHtml(p.titulo)}</div>
          </div>
          ${sc.pontuavel ? `<div class="insp-pag-score"><span class="muted">Pontuação</span><br><strong id="insp-score">${sc.sims} / ${sc.den} (${sc.pct}%)</strong></div>` : ''}
        </div>
        <div id="insp-cards">${cards}</div>
        <div class="insp-nav">
          ${pagina > 0 ? '<button class="btn btn-ghost" id="insp-prev">‹ Página anterior</button>' : '<span></span>'}
          ${pagina < totalPag - 1
            ? '<button class="btn btn-primary" id="insp-next">Próxima página ›</button>'
            : '<button class="btn btn-primary" id="insp-fim">Inspeção concluída ✓</button>'}
        </div>
        <input type="file" accept="image/*" id="insp-file" hidden>`;
      wire();
      if (irAoTopo) {
        view().scrollTop = 0;
        window.scrollTo(0, 0);
      } else {
        view().scrollTop = scrollAntes.v;
        window.scrollTo(0, scrollAntes.w);
      }
    }

    function wire() {
      const raiz = $('insp-cards');

      $('insp-voltar').onclick = () => { clearTimeout(saveTimer); salvarAgora(); location.hash = '#/inspecao'; };

      // SIM / NÃO / N/A
      raiz.querySelectorAll('.s5-btn').forEach((b) => {
        b.onclick = () => {
          const card = b.closest('.s5-q');
          const qid = card.dataset.qcard;
          respOf(qid).resp = b.dataset.resp;
          agendarSave();
          // NÃO pede anotação do que está errado (como no SafetyCulture)
          const pedirNota = b.dataset.resp === 'nao' && !respOf(qid).obs;
          if (pedirNota) notasAbertas.add(qid);
          drawPagina();
          if (pedirNota) {
            const obs = view().querySelector(`.s5-obs[data-obs="${qid}"]`);
            if (obs) obs.focus();
          }
        };
      });

      // campos de texto / data / selects e anotações
      raiz.querySelectorAll('.insp-in').forEach((inp) => {
        const qid = inp.dataset.campo;
        const aplicar = () => {
          respOf(qid).v = inp.value;
          const card = inp.closest('.s5-q');
          if (card && card.dataset.obrig) card.classList.toggle('pende', !String(inp.value || '').trim());
          agendarSave();
        };
        inp.addEventListener('input', aplicar);
        inp.addEventListener('change', aplicar);
      });
      raiz.querySelectorAll('.s5-obs').forEach((inp) => {
        inp.addEventListener('input', () => {
          respOf(inp.dataset.obs).obs = inp.value;
          agendarSave();
        });
      });
      raiz.querySelectorAll('[data-nota]').forEach((b) => {
        b.onclick = () => {
          b.hidden = true;
          notasAbertas.add(b.dataset.nota); // sobrevive ao redraw da página
          const obs = raiz.querySelector(`.s5-obs[data-obs="${b.dataset.nota}"]`);
          if (obs) { obs.classList.remove('oculta5s'); obs.focus(); }
        };
      });

      // fotos
      const file = $('insp-file');
      let fotoQid = null;
      raiz.querySelectorAll('[data-foto-add]').forEach((b) => {
        b.onclick = () => { fotoQid = b.dataset.fotoAdd; file.value = ''; file.click(); };
      });
      file.onchange = () => { if (file.files && file.files[0] && fotoQid) uploadFoto(fotoQid, file.files[0]); };
      raiz.querySelectorAll('[data-foto-del]').forEach((b) => {
        b.onclick = () => {
          const [qid, arquivo] = b.dataset.fotoDel.split('|');
          removerFoto(qid, arquivo);
        };
      });

      // navegação entre páginas (salva antes de trocar)
      const prev = $('insp-prev');
      const next = $('insp-next');
      const fim = $('insp-fim');
      if (prev) prev.onclick = () => { clearTimeout(saveTimer); salvarAgora(); pagina -= 1; drawPagina(true); };
      if (next) next.onclick = () => { clearTimeout(saveTimer); salvarAgora(); pagina += 1; drawPagina(true); };
      if (fim) {
        fim.onclick = async () => {
          const falta = pendencias();
          if (falta.length) {
            toast(`Responda a(s) ${falta.length} pergunta(s) obrigatória(s) destacada(s) antes de concluir.`, 'err');
            if (falta[0].pi !== pagina) { pagina = falta[0].pi; drawPagina(); }
            const card = view().querySelector(`[data-qcard="${falta[0].id}"]`);
            if (card) { card.classList.add('pende'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            return;
          }
          fim.disabled = true;
          try {
            clearTimeout(saveTimer);
            // garante que o servidor tem as respostas finais ANTES de congelar
            const salvou = await salvarAgora();
            if (!salvou) {
              fim.disabled = false;
              if (rotaAtiva()) toast('Não foi possível salvar as respostas — verifique a conexão e tente de novo.', 'err');
              return;
            }
            const r = await api(`/api/inspections/${insp.id}/concluir`, { method: 'POST' });
            toast(`Inspeção concluída: ${r.score}% — ${(CLASSIF_5S[r.classificacao] || {}).rotulo || r.classificacao}.`);
            if (location.hash === '#/inspecao') rerender(); else location.hash = '#/inspecao';
          } catch (e) {
            fim.disabled = false;
            toast(e.message, 'err');
          }
        };
      }
    }

    // Retomando um rascunho? reabre na primeira página com pergunta pendente
    // (rascunho novo continua abrindo na página 1, que tem o cabeçalho vazio).
    const falta0 = pendencias();
    pagina = falta0.length ? falta0[0].pi : totalPag - 1;
    drawPagina(true);
  }

  // Baixa a planilha Excel (com gráficos) gerada pelo servidor. Download por
  // blob, como no PDF de EPI: evita o alerta de download do Chrome em HTTP.
  async function baixarPlanilhaInspecoes(btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await fetch('/api/inspections/relatorio-xlsx', {
        headers: { 'X-Operator': encodeURIComponent(state.operator || '') },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error((j && j.error) || 'Não foi possível gerar a planilha.');
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const hoje = new Date();
      const p = (n) => String(n).padStart(2, '0');
      a.href = url;
      a.download = `relatorio-inspecoes-${hoje.getFullYear()}-${p(hoje.getMonth() + 1)}-${p(hoje.getDate())}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Planilha gerada — confira os downloads.');
    } catch (e) { toast(e.message, 'err'); }
    finally { if (btn) btn.disabled = false; }
  }

  // Relatório semanal: resumo das inspeções concluídas na semana (segunda a
  // domingo) — data, quem inspecionou, pontuação de cada uma e a média da semana.
  function relatorioSemanal(inspecoes) {
    const body = openDrawer('Relatório semanal — Inspeção 5S');
    const p2 = (n) => String(n).padStart(2, '0');
    const isoDia = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    const classifDe = (score) => (score >= 90 ? 'excelente' : score >= 70 ? 'organizado' : score >= 50 ? 'desorganizado' : 'critico');
    const ref = new Date(); // semana exibida (navega de 7 em 7 dias)

    const draw = () => {
      const seg = new Date(ref);
      seg.setDate(seg.getDate() - ((seg.getDay() + 6) % 7)); // recua até a segunda-feira
      const dom = new Date(seg);
      dom.setDate(dom.getDate() + 6);
      const ini = isoDia(seg);
      const fim = isoDia(dom);
      const hoje = isoDia(new Date());

      const daSemana = inspecoes
        .filter((i) => {
          if ((i.status || 'concluida') !== 'concluida') return false;
          const dia = String(i.concluida_em || i.created_at || '').slice(0, 10);
          return dia >= ini && dia <= fim;
        })
        .sort((a, b) => String(a.concluida_em || a.created_at).localeCompare(String(b.concluida_em || b.created_at)));
      const comNota = daSemana.filter((i) => typeof i.score === 'number');
      const media = comNota.length
        ? Math.round(comNota.reduce((s, i) => s + i.score, 0) / comNota.length)
        : null;

      body.innerHTML = `
        <div class="rel-nav">
          <button class="btn btn-ghost btn-mini" id="rel-ant">‹ Anterior</button>
          <strong>${fmtDate(ini)} – ${fmtDate(fim)}</strong>
          <button class="btn btn-ghost btn-mini" id="rel-prox"${fim >= hoje ? ' disabled' : ''}>Próxima ›</button>
        </div>
        <div class="s5-placar">
          <div class="s5-placar-linha">
            <span>${daSemana.length} inspeç${daSemana.length === 1 ? 'ão' : 'ões'} concluída${daSemana.length === 1 ? '' : 's'} na semana</span>
            <strong>Média semanal: ${media == null ? '—' : chip5s(classifDe(media), media)}</strong>
          </div>
        </div>
        <button class="btn btn-ghost rel-baixar" id="rel-baixar">⬇ Baixar planilha (Excel) com gráficos — todas as semanas</button>
        ${daSemana.length ? daSemana.map((i) => `
          <div class="s5-hist" data-id="${i.id}">
            <div class="s5-hist-topo">
              <strong>${fmtDateTime(i.concluida_em || i.created_at)}</strong>
              ${chip5s(i.classificacao, i.score)}
            </div>
            <div class="muted">${escapeHtml(i.room_name || i.template_nome || 'Inspeção 5S')} · inspecionado por ${escapeHtml(i.inspector || '—')}</div>
          </div>`).join('')
        : '<div class="empty">Nenhuma inspeção concluída nesta semana.</div>'}`;

      $('rel-ant').onclick = () => { ref.setDate(ref.getDate() - 7); draw(); };
      const prox = $('rel-prox');
      if (prox && !prox.disabled) prox.onclick = () => { ref.setDate(ref.getDate() + 7); draw(); };
      $('rel-baixar').onclick = () => baixarPlanilhaInspecoes($('rel-baixar'));
      // clicar numa linha abre o detalhe completo daquela inspeção
      body.querySelectorAll('.s5-hist').forEach((d) => {
        d.onclick = () => {
          const i = inspecoes.find((x) => String(x.id) === d.dataset.id);
          if (i) detalheInspecao(i);
        };
      });
    };
    draw();
  }

  // Detalhe de uma inspeção concluída (funciona para as antigas e as novas).
  function detalheInspecao(insp) {
    const titulo = insp.template_nome || 'Inspeção 5S';
    const body = openDrawer(`${titulo}${insp.room_name ? ' — ' + insp.room_name : ''}`);
    const grupos = {};
    for (const it of (insp.items || [])) {
      if (!grupos[it.cat]) grupos[it.cat] = [];
      grupos[it.cat].push(it);
    }
    const fotosDe = (qid) => {
      const arr = (insp.fotos && insp.fotos[qid]) || [];
      if (!arr.length) return '';
      return `<div class="insp-fotos">${arr.map((f) => `
        <span class="insp-foto">
          <a href="/api/inspections/${insp.id}/foto/${encodeURIComponent(f.arquivo)}" target="_blank" rel="noopener" title="${escapeHtml(f.nome || 'Abrir foto')}">
            <img src="/api/inspections/${insp.id}/foto/${encodeURIComponent(f.arquivo)}" alt="Foto de evidência"></a>
        </span>`).join('')}</div>`;
    };
    body.innerHTML = `
      <div class="s5-placar">${chip5s(insp.classificacao, insp.score)}
        <div class="muted" style="margin-top:6px">por ${escapeHtml(insp.inspector || '—')} · iniciada em ${fmtDateTime(insp.created_at)}${insp.concluida_em ? ' · concluída em ' + fmtDateTime(insp.concluida_em) : ''}</div>
        <div class="muted">${insp.conformes || 0} Sim · ${insp.nao_conformes || 0} Não${insp.parciais ? ' · ' + insp.parciais + ' parciais' : ''}${insp.nao_aplicaveis ? ' · ' + insp.nao_aplicaveis + ' N/A' : ''}</div>
      </div>
      ${Array.isArray(insp.header) && insp.header.length ? `<div class="insp-header-grid">${insp.header.map((h) => `
        <div class="insp-hitem"><span class="muted">${escapeHtml(h.rotulo)}</span>
          <strong>${h.valor ? escapeHtml(h.rotulo === 'Data' ? fmtDate(h.valor) : h.valor) : '—'}</strong></div>`).join('')}</div>` : ''}
      ${Array.isArray(insp.paginas_score) && insp.paginas_score.length ? `
        <div class="s5-secao">Pontuação por seção</div>
        ${insp.paginas_score.filter((ps) => ps.total || ps.pontos).map((ps) => `
          <div class="insp-ps"><span>${escapeHtml(ps.titulo)}</span>
            <strong>${ps.pontos} / ${ps.total}${ps.pct == null ? '' : ' (' + ps.pct + '%)'}</strong></div>`).join('')}` : ''}
      ${insp.obs_geral ? `<div class="field"><label>Observações gerais</label><div class="hint">${escapeHtml(insp.obs_geral)}</div></div>` : ''}
      ${insp.plano_acao ? `<div class="field"><label>Plano de ação</label><div class="hint">${escapeHtml(insp.plano_acao)}</div></div>` : ''}
      ${Object.entries(grupos).map(([cat, itens]) => `
        <div class="s5-secao">${escapeHtml(cat)}</div>
        ${itens.map((it) => {
          if (it.tipo === 'foto') {
            const fhtml = fotosDe(it.qid);
            return `<div class="s5-item lida"><div class="s5-item-txt muted">${escapeHtml(it.item)}</div>${fhtml || '<div class="muted" style="font-size:12px">Sem fotos anexadas.</div>'}</div>`;
          }
          if (it.tipo === 'texto') {
            return `<div class="s5-item lida"><div class="s5-item-txt">${escapeHtml(it.item)}</div>
              <div>${it.v ? escapeHtml(it.v) : '<span class="muted">—</span>'}</div>${it.qid ? fotosDe(it.qid) : ''}</div>`;
          }
          return `<div class="s5-item lida ${it.resp === 'nao' || it.resp === 'nao_conforme' ? 'pende' : ''}">
            <div class="s5-item-txt">${escapeHtml(it.item)}</div>
            <div><span class="s5-chip ${(RESP_5S[it.resp] || {}).cls || 'na'}">${escapeHtml((RESP_5S[it.resp] || {}).rotulo || it.resp)}</span>
            ${it.obs ? `<span class="muted"> — ${escapeHtml(it.obs)}</span>` : ''}</div>${it.qid ? fotosDe(it.qid) : ''}</div>`;
        }).join('')}`).join('')}
      <div class="form-actions">
        ${isAdmin() ? '<button class="btn btn-ghost" id="insp-del">Excluir inspeção</button>' : ''}
      </div>`;
    const ex = $('insp-del');
    if (ex) {
      ex.onclick = async () => {
        const ok2 = await confirmDialog('Excluir inspeção',
          `Excluir a inspeção de ${fmtDateTime(insp.created_at)}${insp.room_name ? ' do local “' + insp.room_name + '”' : ''}? Esta ação não pode ser desfeita.`,
          'Excluir', true);
        if (!ok2) return;
        try { await api('/api/inspections/' + insp.id, { method: 'DELETE' }); toast('Inspeção excluída.'); closeDrawer(); rerender(); }
        catch (e) { toast(e.message, 'err'); }
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Relação de materiais — estoque de EPIs e itens de uso (nome + quantidade).
  // A entrega de EPI dá baixa automática quando o nome bate com um material.
  // ---------------------------------------------------------------------------
  async function renderMateriais() {
    setTopbar('<button class="btn btn-primary" id="mat-new">+ Novo material</button>');
    $('mat-new').onclick = () => materialForm();
    view().innerHTML = '<div class="empty">Carregando…</div>';
    const materiais = await api('/api/materiais');
    const unidades = materiais.reduce((s, m) => s + (m.quantidade || 0), 0);
    const baixos = materiais.filter((m) => m.minimo != null && m.quantidade <= m.minimo);

    view().innerHTML = `
      <div class="cards">
        ${statCard('Materiais cadastrados', materiais.length)}
        ${statCard('Unidades em estoque', unidades, 'is-accent')}
        ${statCard('Abaixo do mínimo', baixos.length, baixos.length ? 'is-warn' : '')}
      </div>
      <div class="toolbar"><div class="search"><input id="mat-q" placeholder="Buscar material…"></div></div>
      <div class="panel"><div id="mat-rows"></div></div>`;

    const draw = () => {
      const term = ($('mat-q').value || '').toLowerCase();
      const rows = materiais.filter((m) => !term || String(m.nome).toLowerCase().includes(term));
      $('mat-rows').innerHTML = !rows.length
        ? `<div class="empty">${materiais.length ? 'Nenhum material para esta busca.' : 'Nenhum material ainda. Clique em “+ Novo material” para montar o estoque.'}</div>`
        : `<div class="table-wrap"><table>
            <thead><tr><th>Material</th><th class="num">Em estoque</th><th class="num">Mínimo</th><th>Atualizado</th><th></th></tr></thead>
            <tbody>${rows.map((m) => {
              const baixo = m.minimo != null && m.quantidade <= m.minimo;
              return `<tr>
                <td><div class="cell-title">${escapeHtml(m.nome)}</div>
                    ${baixo ? '<span class="s5-chip warn">Abaixo do mínimo</span>' : ''}</td>
                <td class="num mono mat-qtd">${m.quantidade}</td>
                <td class="num mono">${m.minimo == null ? '—' : m.minimo}</td>
                <td>${fmtDateTime(m.updated_at || m.created_at)}</td>
                <td><div class="row-actions">
                  <button class="btn btn-mini btn-primary" data-entrada="${m.id}">+ Entrada</button>
                  <button class="btn btn-mini btn-ghost" data-saida="${m.id}">− Saída</button>
                  <button class="btn btn-mini btn-ghost" data-editar="${m.id}">Editar</button>
                  ${isAdmin() ? `<button class="btn btn-mini btn-ghost" data-excluir="${m.id}" title="Excluir material">🗑</button>` : ''}
                </div></td>
              </tr>`;
            }).join('')}</tbody></table></div>`;
      const porId = (idStr) => materiais.find((m) => String(m.id) === idStr);
      $('mat-rows').querySelectorAll('[data-entrada]').forEach((b) => {
        b.onclick = () => { const m = porId(b.dataset.entrada); if (m) ajusteMaterial(m, +1); };
      });
      $('mat-rows').querySelectorAll('[data-saida]').forEach((b) => {
        b.onclick = () => { const m = porId(b.dataset.saida); if (m) ajusteMaterial(m, -1); };
      });
      $('mat-rows').querySelectorAll('[data-editar]').forEach((b) => {
        b.onclick = () => { const m = porId(b.dataset.editar); if (m) materialForm(m); };
      });
      $('mat-rows').querySelectorAll('[data-excluir]').forEach((b) => {
        b.onclick = async () => {
          const m = porId(b.dataset.excluir);
          if (!m) return;
          const ok2 = await confirmDialog('Excluir material',
            `Excluir “${m.nome}” da relação de materiais? O estoque atual (${m.quantidade} un.) será perdido do registro.`,
            'Excluir', true);
          if (!ok2) return;
          try { await api('/api/materiais/' + m.id, { method: 'DELETE' }); toast('Material excluído.'); rerender(); }
          catch (e) { toast(e.message, 'err'); }
        };
      });
    };
    let deb;
    $('mat-q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(draw, 200); });
    draw();
  }

  function materialForm(m) {
    const body = openDrawer(m ? 'Editar material — ' + m.nome : 'Novo material');
    const sugestoes = state.catalog.epiItems || [];
    body.innerHTML = `
      <div class="field"><label for="mat-nome">Nome do material *</label>
        <input id="mat-nome" maxlength="120" list="mat-sugestoes" value="${escapeHtml(m ? m.nome : '')}"
          placeholder="Ex.: Botina de segurança (bico de aço)">
        <datalist id="mat-sugestoes">${sugestoes.map((n) => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
        <div class="hint">Use o mesmo nome da lista de EPIs para a entrega dar baixa automática no estoque.</div></div>
      ${m ? '' : `<div class="field"><label for="mat-qtd">Quantidade inicial em estoque</label>
        <input id="mat-qtd" type="number" min="0" value="0"></div>`}
      <div class="field"><label for="mat-min">Estoque mínimo <span class="muted">(avisa quando chegar nesse número — opcional)</span></label>
        <input id="mat-min" type="number" min="0" value="${m && m.minimo != null ? m.minimo : ''}"></div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="mat-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="mat-salvar">${m ? 'Salvar' : 'Cadastrar'}</button>
      </div>`;
    setTimeout(() => { const c = $('mat-nome'); if (c) c.focus(); }, 50);
    $('mat-cancelar').onclick = closeDrawer;
    $('mat-salvar').onclick = async () => {
      const nome = $('mat-nome').value.trim();
      if (!nome) { toast('Informe o nome do material.', 'err'); return; }
      const minimo = $('mat-min').value === '' ? null : parseInt($('mat-min').value, 10) || 0;
      try {
        if (m) {
          await api('/api/materiais/' + m.id, { method: 'PUT', body: { nome, minimo } });
          toast('Material atualizado.');
        } else {
          await api('/api/materiais', { method: 'POST', body: { nome, minimo, quantidade: parseInt($('mat-qtd').value, 10) || 0 } });
          toast('Material cadastrado.');
        }
        closeDrawer();
        rerender();
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  function ajusteMaterial(m, sinal) {
    const body = openDrawer(`${sinal > 0 ? 'Entrada de estoque' : 'Saída de estoque'} — ${m.nome}`);
    body.innerHTML = `
      <div class="s5-placar">Em estoque agora: <strong>${m.quantidade}</strong> unidade(s)</div>
      <div class="field"><label for="aj-qtd">Quantidade que ${sinal > 0 ? 'entra' : 'sai'} *</label>
        <input id="aj-qtd" type="number" min="1" value="1"></div>
      <div class="field"><label for="aj-motivo">Motivo</label>
        <input id="aj-motivo" maxlength="200" placeholder="${sinal > 0 ? 'Ex.: compra — NF 1234' : 'Ex.: perda; descarte; uso interno'}"></div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="aj-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="aj-salvar">${sinal > 0 ? 'Registrar entrada' : 'Registrar saída'}</button>
      </div>`;
    setTimeout(() => { const c = $('aj-qtd'); if (c) { c.focus(); c.select(); } }, 50);
    $('aj-cancelar').onclick = closeDrawer;
    $('aj-salvar').onclick = async () => {
      const qtd = parseInt($('aj-qtd').value, 10) || 0;
      if (qtd < 1) { toast('Informe uma quantidade maior que zero.', 'err'); return; }
      try {
        const r = await api(`/api/materiais/${m.id}/ajuste`, {
          method: 'POST',
          body: { delta: sinal * qtd, motivo: $('aj-motivo').value.trim() || null },
        });
        toast(`${sinal > 0 ? 'Entrada' : 'Saída'} registrada — estoque de “${r.nome}”: ${r.quantidade} un.`);
        closeDrawer();
        rerender();
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ---------------------------------------------------------------------------
  // Entrega de EPIs com assinatura digital por link (sem papel)
  // ---------------------------------------------------------------------------
  const EPI_STATUS = {
    pendente: { rotulo: 'Aguardando assinatura', cls: 'warn' },
    assinado: { rotulo: 'Assinado', cls: 'ok' },
    cancelado: { rotulo: 'Cancelado', cls: 'na' },
  };
  const epiPdfUrl = (token) => '/api/epi/pdf?token=' + encodeURIComponent(token);
  // Baixa o PDF via blob gerado pela própria página: evita o alerta de
  // "arquivo perigoso" que o Chrome mostra para downloads diretos em HTTP.
  async function epiBaixarPdf(entrega) {
    try {
      const r = await fetch(epiPdfUrl(entrega.token));
      if (!r.ok) { const j = await r.json().catch(() => null); throw new Error((j && j.error) || 'Não foi possível gerar o PDF.'); }
      const blob = await r.blob();
      const slug = String(entrega.person_name || 'entrega')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'termo-epi-' + (slug || entrega.id) + '.pdf';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      toast('PDF do termo gerado — confira nos downloads.');
    } catch (e) { toast(e.message, 'err'); }
  }
  // O financeiro anexa o PDF assinado devolvido pelo colaborador — isso confirma a entrega.
  function epiAnexarPdf(entrega, aoConcluir) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) { toast('PDF grande demais (máx. 15 MB).', 'err'); return; }
      const leitor = new FileReader();
      leitor.onload = async () => {
        try {
          await api('/api/epi/' + entrega.id + '/anexar-pdf', {
            method: 'POST',
            body: { pdf_base64: leitor.result, nome_arquivo: f.name },
          });
          toast('PDF assinado anexado — entrega confirmada.');
          if (aoConcluir) aoConcluir();
        } catch (err) { toast(err.message, 'err'); }
      };
      leitor.readAsDataURL(f);
    };
    input.click();
  }

  async function renderEpis() {
    setTopbar('<button class="btn btn-primary" id="epi-new">+ Nova entrega</button>');
    view().innerHTML = '<div class="empty">Carregando…</div>';
    const rows = await api('/api/epi');
    const pend = rows.filter((e) => e.status === 'pendente').length;
    const ass = rows.filter((e) => e.status === 'assinado').length;
    view().innerHTML = `
      <div class="cards">
        ${statCard('Entregas registradas', rows.length)}
        ${statCard('Aguardando assinatura', pend, pend ? 'is-warn' : '')}
        ${statCard('Assinadas', ass, ass ? 'is-accent' : '')}
      </div>
      <div class="toolbar"><div class="search"><input id="epi-q" placeholder="Buscar por colaborador ou EPI…"></div></div>
      <div class="panel"><div id="epi-rows"></div></div>`;
    $('epi-new').onclick = () => epiForm();

    const draw = () => {
      const term = ($('epi-q').value || '').toLowerCase();
      const lista = rows.filter((e) => !term ||
        (e.person_name || '').toLowerCase().includes(term) ||
        e.itens.some((it) => (it.nome || '').toLowerCase().includes(term)));
      $('epi-rows').innerHTML = !lista.length
        ? '<div class="empty">Nenhuma entrega registrada. Clique em “+ Nova entrega” para gerar o primeiro termo em PDF.</div>'
        : `<div class="table-wrap"><table>
            <thead><tr><th>Colaborador</th><th>EPIs</th><th>Entrega</th><th>Situação</th><th></th></tr></thead>
            <tbody>${lista.map((e) => `
              <tr>
                <td><div class="cell-title">${escapeHtml(e.person_name)}</div></td>
                <td>${e.itens.map((it) => escapeHtml(it.quantidade + '× ' + it.nome + (it.ca ? ' (CA ' + it.ca + ')' : ''))).join('<br>')}</td>
                <td>${escapeHtml(e.created_at)}<div class="muted">por ${escapeHtml(e.entregue_por)}</div></td>
                <td><span class="s5-chip ${(EPI_STATUS[e.status] || {}).cls || 'na'}">${escapeHtml((EPI_STATUS[e.status] || {}).rotulo || e.status)}</span>
                  ${e.status === 'assinado' ? `<div class="muted">${escapeHtml(e.assinado_em)}</div>` : ''}</td>
                <td><div class="row-actions">
                  ${e.status === 'pendente' ? `
                    <button class="btn btn-mini btn-ghost" data-pdf="${e.id}">Baixar PDF</button>
                    <button class="btn btn-mini btn-ghost" data-anexar="${e.id}">Anexar assinado</button>` : ''}
                  <button class="btn btn-mini btn-primary" data-termo="${e.id}">Ver termo</button>
                </div></td>
              </tr>`).join('')}</tbody></table></div>`;
      $('epi-rows').querySelectorAll('[data-pdf]').forEach((b) => {
        b.onclick = () => epiBaixarPdf(rows.find((x) => String(x.id) === b.dataset.pdf));
      });
      $('epi-rows').querySelectorAll('[data-anexar]').forEach((b) => {
        b.onclick = () => epiAnexarPdf(rows.find((x) => String(x.id) === b.dataset.anexar), () => rerender());
      });
      $('epi-rows').querySelectorAll('[data-termo]').forEach((b) => {
        b.onclick = () => epiTermo(b.dataset.termo);
      });
    };
    let deb;
    $('epi-q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(draw, 200); });
    draw();
  }

  // Linha de item da entrega: EPI escolhido numa lista suspensa (catálogo) —
  // "Outro (digitar)…" abre um campo livre. Mostra o estoque quando o item
  // existe na Relação de materiais.
  function epiItemRow(v) {
    const nome = (v && v.nome) || '';
    const itens = state.catalog.epiItems || [];
    const conhecido = !nome || itens.includes(nome);
    return `<div class="epi-item-bloco">
      <div class="epi-item-row">
        <select class="epi-nome-sel">
          <option value="">Escolha o EPI…</option>
          ${itens.map((n) => `<option value="${escapeHtml(n)}"${n === nome ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}
          <option value="__outro"${nome && !conhecido ? ' selected' : ''}>✎ Outro (digitar)…</option>
        </select>
        <input class="epi-ca" maxlength="30" placeholder="CA" value="${escapeHtml((v && v.ca) || '')}">
        <input class="epi-qt" type="number" min="1" value="${escapeHtml((v && v.quantidade) || 1)}">
        <button type="button" class="icon-btn epi-tirar" title="Remover">🗑</button>
      </div>
      <input class="epi-nome-outro${nome && !conhecido ? '' : ' oculta5s'}" maxlength="120"
        placeholder="Escreva o nome do EPI…" value="${nome && !conhecido ? escapeHtml(nome) : ''}">
      <div class="hint epi-estoque"></div>
    </div>`;
  }

  async function epiForm() {
    const body = openDrawer('Nova entrega de EPI');
    const pessoas = await ensurePeople(true).catch(() => []);
    const materiais = await api('/api/materiais').catch(() => []);
    const estoqueDe = (nome) => materiais.find((m) => String(m.nome).trim().toLowerCase() === String(nome).trim().toLowerCase());
    body.innerHTML = `
      <div class="field"><label for="epi-pessoa-sel">Colaborador(a) que recebe *</label>
        <select id="epi-pessoa-sel">
          <option value="">Escolha o colaborador…</option>
          ${pessoas.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}${p.department ? ' · ' + escapeHtml(p.department) : ''}</option>`).join('')}
          <option value="__outro">✎ Outro (digitar)…</option>
        </select>
        <input id="epi-pessoa" class="oculta5s" maxlength="80" placeholder="Escreva o nome completo…" style="margin-top:6px">
        <div class="hint">A lista vem do cadastro de Pessoas. Não achou? Escolha “Outro” e digite.</div></div>
      <div class="field"><label>EPIs entregues * <span class="muted">(item, CA e quantidade)</span></label>
        <div id="epi-itens">${epiItemRow()}</div>
        <button type="button" class="btn btn-mini btn-ghost" id="epi-mais">+ Adicionar EPI</button></div>
      <div class="field"><label for="epi-obs">Observações</label>
        <textarea id="epi-obs" rows="2" placeholder="Ex.: troca por desgaste; primeira entrega…"></textarea></div>
      <div class="hint">Ao salvar, o sistema gera o termo em PDF ("termo-epi-NOME.pdf") com a logo da empresa
        e dá baixa automática na Relação de materiais (itens com o mesmo nome).
        Envie ao colaborador, receba o PDF assinado de volta e anexe aqui — a entrega é confirmada
        e o termo fica arquivado no sistema, sem papel.</div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="epi-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="epi-salvar">Salvar e gerar PDF</button>
      </div>`;
    const ligarItens = () => {
      body.querySelectorAll('.epi-tirar').forEach((b) => {
        b.onclick = () => { if (body.querySelectorAll('.epi-item-bloco').length > 1) b.closest('.epi-item-bloco').remove(); };
      });
      body.querySelectorAll('.epi-nome-sel').forEach((sel) => {
        const bloco = sel.closest('.epi-item-bloco');
        const outro = bloco.querySelector('.epi-nome-outro');
        const dica = bloco.querySelector('.epi-estoque');
        const atualizar = () => {
          const eOutro = sel.value === '__outro';
          outro.classList.toggle('oculta5s', !eOutro);
          const nome = eOutro ? outro.value.trim() : sel.value;
          const mat = nome ? estoqueDe(nome) : null;
          dica.textContent = mat ? `Em estoque: ${mat.quantidade} unidade(s)` : '';
          if (eOutro && sel === document.activeElement) outro.focus();
        };
        sel.onchange = atualizar;
        outro.oninput = atualizar;
        atualizar();
      });
    };
    ligarItens();
    const selPessoa = $('epi-pessoa-sel');
    selPessoa.onchange = () => {
      const eOutro = selPessoa.value === '__outro';
      $('epi-pessoa').classList.toggle('oculta5s', !eOutro);
      if (eOutro) $('epi-pessoa').focus();
    };
    // Enter pula para o próximo campo visível; no último, salva e já gera o PDF.
    body.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      const alvo = ev.target;
      if (!alvo.matches || !alvo.matches('#epi-pessoa-sel, #epi-pessoa, .epi-nome-sel, .epi-nome-outro, .epi-ca, .epi-qt')) return;
      ev.preventDefault();
      const campos = [...body.querySelectorAll('#epi-pessoa-sel, #epi-pessoa, .epi-nome-sel, .epi-nome-outro, .epi-ca, .epi-qt')]
        .filter((c) => !c.classList.contains('oculta5s'));
      const prox = campos[campos.indexOf(alvo) + 1];
      if (prox) { prox.focus(); if (prox.select) prox.select(); }
      else $('epi-salvar').click();
    });
    setTimeout(() => { selPessoa.focus(); }, 50);
    $('epi-mais').onclick = () => {
      $('epi-itens').insertAdjacentHTML('beforeend', epiItemRow());
      ligarItens();
    };
    $('epi-cancelar').onclick = closeDrawer;
    $('epi-salvar').onclick = async () => {
      const itens = [...body.querySelectorAll('.epi-item-bloco')].map((r) => {
        const sel = r.querySelector('.epi-nome-sel').value;
        return {
          nome: sel === '__outro' ? r.querySelector('.epi-nome-outro').value.trim() : sel,
          ca: r.querySelector('.epi-ca').value.trim() || null,
          quantidade: parseInt(r.querySelector('.epi-qt').value, 10) || 1,
        };
      }).filter((it) => it.nome);
      const corpo = { itens, obs: $('epi-obs').value.trim() || null };
      if (selPessoa.value === '__outro') {
        corpo.person_name = $('epi-pessoa').value.trim();
        if (!corpo.person_name) { toast('Escreva o nome de quem recebe os EPIs.', 'err'); return; }
      } else if (selPessoa.value) {
        corpo.person_id = selPessoa.value;
      } else {
        toast('Escolha o colaborador que recebe os EPIs.', 'err');
        return;
      }
      if (!itens.length) { toast('Escolha ao menos um EPI da lista.', 'err'); return; }
      try {
        const e = await api('/api/epi', { method: 'POST', body: corpo });
        if (e.estoque_avisos && e.estoque_avisos.length) {
          toast('Atenção ao estoque: ' + e.estoque_avisos.join(' '), 'err');
        }
        body.innerHTML = `
          <div class="okbig">✅ Entrega registrada!</div>
          <p class="hint">Baixe o termo em PDF e envie para <b>${escapeHtml(e.person_name)}</b> assinar
            (por WhatsApp, e-mail ou impresso onde ele estiver). Quando o PDF assinado voltar,
            anexe em “Ver termo” — a entrega será confirmada e arquivada aqui.</p>
          <div class="form-actions">
            <button class="btn btn-primary" id="epi-pdf2">Baixar termo em PDF</button>
            <button class="btn btn-ghost" id="epi-anexar2">Anexar PDF assinado…</button>
            <button class="btn btn-ghost" id="epi-fechar2">Fechar</button>
          </div>`;
        $('epi-pdf2').onclick = () => epiBaixarPdf(e);
        $('epi-anexar2').onclick = () => epiAnexarPdf(e, () => { closeDrawer(); rerender(); });
        $('epi-fechar2').onclick = () => { closeDrawer(); rerender(); };
        epiBaixarPdf(e); // já baixa o PDF na hora — é o próximo passo natural
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  async function epiTermo(id) {
    const e = await api('/api/epi/' + id);
    const body = openDrawer('Termo de entrega — ' + e.person_name);
    const st = EPI_STATUS[e.status] || { rotulo: e.status, cls: 'na' };
    body.innerHTML = `
      <div class="s5-placar">
        <span class="s5-chip ${st.cls}">${escapeHtml(st.rotulo)}</span>
        <div class="muted" style="margin-top:6px">Registrada por ${escapeHtml(e.entregue_por)} em ${escapeHtml(e.created_at)}</div>
      </div>
      <div class="field"><label>Equipamentos</label>
        <div class="table-wrap"><table>
          <thead><tr><th>EPI</th><th>CA</th><th class="num">Qtde</th></tr></thead>
          <tbody>${e.itens.map((it) => `<tr><td>${escapeHtml(it.nome)}</td><td>${escapeHtml(it.ca || '—')}</td><td class="num mono">${it.quantidade}</td></tr>`).join('')}</tbody>
        </table></div></div>
      ${e.obs ? `<div class="field"><label>Observações</label><div class="hint">${escapeHtml(e.obs)}</div></div>` : ''}
      ${e.status === 'assinado' && e.assinado_via === 'pdf' ? `
        <div class="field"><label>Confirmação por PDF assinado</label>
          <div class="hint">PDF assinado anexado${e.pdf_nome_original ? ' (' + escapeHtml(e.pdf_nome_original) + ')' : ''} por
            <b>${escapeHtml(e.assinado_nome)}</b> em ${escapeHtml(e.assinado_em)}.</div>
          <a class="btn btn-primary" style="margin-top:8px;display:inline-block" href="/api/epi/${e.id}/anexo-pdf" target="_blank">Abrir PDF assinado</a>
        </div>` : ''}
      ${e.status === 'assinado' && e.assinado_via !== 'pdf' ? `
        <div class="field"><label>Assinatura do recebimento</label>
          <img class="epi-assin" src="${e.assinatura_png}" alt="Assinatura">
          <div class="muted" style="margin-top:6px">Assinado por <b>${escapeHtml(e.assinado_nome)}</b>${e.assinado_doc ? ' (doc. ' + escapeHtml(e.assinado_doc) + ')' : ''} em ${escapeHtml(e.assinado_em)}${e.assinado_ip ? ' · IP ' + escapeHtml(e.assinado_ip) : ''}</div>
        </div>` : ''}
      ${e.status === 'pendente' ? `
        <div class="field"><label>Como confirmar</label>
          <div class="hint">Baixe o termo em PDF ("termo-epi-${escapeHtml(e.person_name)}.pdf"), envie ao
            colaborador para assinar e, quando o arquivo assinado voltar, anexe aqui —
            a entrega é confirmada na hora e fica arquivada no sistema.</div></div>` : ''}
      <div class="form-actions">
        ${e.status === 'pendente' ? `
          <button class="btn btn-primary" id="epi-pdf3">Baixar termo em PDF</button>
          <button class="btn btn-ghost" id="epi-anexar3">Anexar PDF assinado…</button>
          ${isAdmin() ? '<button class="btn btn-ghost" id="epi-cancelar3">Cancelar entrega</button>' : ''}` : ''}
        <button class="btn btn-ghost" id="epi-fechar3">Fechar</button>
      </div>`;
    $('epi-fechar3').onclick = closeDrawer;
    const p3 = $('epi-pdf3');
    if (p3) p3.onclick = () => epiBaixarPdf(e);
    const a3 = $('epi-anexar3');
    if (a3) a3.onclick = () => epiAnexarPdf(e, () => { closeDrawer(); rerender(); });
    const x3 = $('epi-cancelar3');
    if (x3) {
      x3.onclick = async () => {
        const ok2 = await confirmDialog('Cancelar entrega', `Cancelar a entrega de EPIs para “${e.person_name}”? O link deixa de valer.`, 'Cancelar entrega', true);
        if (!ok2) return;
        try { await api('/api/epi/' + e.id + '/cancelar', { method: 'POST', body: {} }); toast('Entrega cancelada.'); closeDrawer(); rerender(); }
        catch (e2) { toast(e2.message, 'err'); }
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Home Office (aparelhos levados para casa)
  // ---------------------------------------------------------------------------
  function hoDays(takenAt) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(takenAt || '');
    if (!m) return '';
    const d = Math.floor((Date.now() - new Date(+m[1], +m[2] - 1, +m[3]).getTime()) / 86400000);
    if (d <= 0) return 'saiu hoje';
    return d === 1 ? 'há 1 dia' : `há ${d} dias`;
  }

  async function renderHomeOffice() {
    setTopbar('<button class="btn btn-primary" id="ho-new">+ Registrar saída</button>');
    let hoFilter = 'ativo';
    view().innerHTML = `
      <div class="toolbar">
        <div class="seg" id="ho-seg">
          <button class="seg-btn active" data-f="ativo">Em Home Office <span class="seg-c" id="ho-c-atv">0</span></button>
          <button class="seg-btn" data-f="devolvido">Devolvidos <span class="seg-c" id="ho-c-dev">0</span></button>
        </div>
        <div class="search"><input id="ho-q" placeholder="Buscar por item, pessoa ou acessório…"></div>
      </div>
      <div id="ho-list"></div>`;
    $('ho-new').onclick = () => homeOfficeForm(load);

    const hoCard = (h) => {
      const out = !h.returned_at;
      const persHtml = (h.peripherals || []).length
        ? h.peripherals.map((pe) => out
            ? `<span class="tag tag-per">${escapeHtml(pe.asset_tag)} · ${escapeHtml(pe.type_label)}</span>`
            : `<span class="tag tag-per ${pe.returned ? '' : 'ho-missing'}">${pe.returned ? '✔' : '✖'} ${escapeHtml(pe.asset_tag)} · ${escapeHtml(pe.type_label)}</span>`).join(' ')
        : '<span class="muted">nenhum</span>';
      return `
      <div class="panel ho-card ${out ? 'is-out' : 'is-back'}">
        <div class="panel-pad">
          <div class="ho-top">
            <div class="li-main">
              <div class="li-title" style="font-size:15px">${tagChip(h.asset_tag || '—')} ${escapeHtml(h.asset_name || '')}</div>
              <div class="li-sub">com <strong>${escapeHtml(h.person_name || '—')}</strong>${h.asset_type_label ? ' · ' + escapeHtml(h.asset_type_label) : ''}</div>
            </div>
            <span class="ho-badge ${out ? 'out' : 'back'}">${out ? 'EM HOME OFFICE' : 'DEVOLVIDO'}</span>
          </div>
          <div class="ho-dates">
            <div class="ho-date">
              <span class="lbl">Saída</span>
              <span class="val">${fmtDate(h.taken_at)}</span>
              ${out ? `<span class="days">${hoDays(h.taken_at)}</span>` : ''}
            </div>
            ${!out ? `
            <div class="ho-date">
              <span class="lbl">Devolução</span>
              <span class="val back">${fmtDate(h.returned_at)}</span>
              ${h.return_condition ? `<span class="days">condição: ${escapeHtml(labelCondition(h.return_condition))}</span>` : ''}
            </div>` : ''}
          </div>
          <div class="ho-info">
            <div><span class="muted">Sub-itens levados:</span> ${persHtml}</div>
            ${h.accessories ? `<div><span class="muted">Acessórios:</span> ${escapeHtml(h.accessories)}</div>` : ''}
            ${h.notes ? `<div><span class="muted">Obs. saída:</span> ${escapeHtml(h.notes)}</div>` : ''}
            ${h.return_notes ? `<div><span class="muted">Obs. devolução:</span> ${escapeHtml(h.return_notes)}</div>` : ''}
          </div>
          <div class="form-actions" style="justify-content:flex-start;margin-top:10px">
            ${out ? `<button class="btn btn-primary btn-sm" data-devolver="${h.id}">Registrar devolução</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-ver="${h.asset_id}">Ver item</button>
            <button class="btn btn-ghost btn-sm" data-del="${h.id}">Excluir registro</button>
          </div>
        </div>
      </div>`;
    };

    let lastRows = [];
    const load = async () => {
      const p = new URLSearchParams({ state: hoFilter });
      const q = $('ho-q').value.trim(); if (q) p.set('q', q);
      const data = await api('/api/homeoffice?' + p.toString());
      lastRows = data.rows;
      $('ho-c-atv').textContent = data.counts.active;
      $('ho-c-dev').textContent = data.counts.returned;
      $('ho-list').innerHTML = data.rows.length
        ? data.rows.map(hoCard).join('')
        : `<div class="panel"><div class="empty">${hoFilter === 'ativo'
            ? 'Nenhum aparelho em Home Office no momento. Clique em “+ Registrar saída”.'
            : 'Nenhuma devolução registrada ainda.'}</div></div>`;
      $('ho-list').querySelectorAll('[data-devolver]').forEach((b) => {
        b.onclick = () => { const h = lastRows.find((x) => String(x.id) === b.dataset.devolver); if (h) hoReturnForm(h, load); };
      });
      $('ho-list').querySelectorAll('[data-ver]').forEach((b) => { b.onclick = () => openAssetDetail(b.dataset.ver); });
      $('ho-list').querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          const ok = await confirmDialog('Excluir registro', 'Excluir este registro de Home Office? Se estiver ativo, o status do item volta ao anterior.', 'Excluir', true);
          if (!ok) return;
          try { await api('/api/homeoffice/' + b.dataset.del, { method: 'DELETE' }); toast('Registro excluído.'); load(); }
          catch (e) { toast(e.message, 'err'); }
        };
      });
    };

    $('ho-seg').querySelectorAll('.seg-btn').forEach((b) => {
      b.onclick = () => {
        hoFilter = b.dataset.f;
        $('ho-seg').querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
        load();
      };
    });
    let deb;
    $('ho-q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(load, 250); });
    await load();
  }

  async function homeOfficeForm(onDone) {
    await ensurePeople();
    const [assets, hoData] = await Promise.all([api('/api/assets'), api('/api/homeoffice?state=ativo')]);
    const emHO = new Set(hoData.rows.map((h) => h.asset_id));
    const disponiveis = assets.filter((a) => !emHO.has(a.id));
    const byId = {}; disponiveis.forEach((a) => { byId[a.id] = a; });
    const persCache = {};        // asset_id -> sub-itens (carregados sob demanda)
    const listadas = new Set();  // itens já exibidos na lista

    const body = openDrawer('Registrar saída para Home Office');
    if (!disponiveis.length) { body.innerHTML = '<div class="empty">Todos os itens já estão em Home Office ou não há itens cadastrados.</div>'; return; }
    body.innerHTML = `
      <div class="field">
        <label for="hf-person">Quem levou *</label>
        <select id="hf-person">${peopleOptions('', 'Selecione a pessoa…')}</select>
      </div>
      <div class="field"><label for="hf-date">Data da saída</label><input id="hf-date" type="date" value="${todayStr()}"></div>
      <div class="field" id="hf-items-field" hidden>
        <label>Itens que está levando *</label>
        <div id="hf-items"></div>
        <div class="inline-form" style="margin-top:8px">
          <select id="hf-extra"><option value="">Levou outro aparelho? Selecione…</option></select>
          <button class="btn btn-ghost btn-sm" id="hf-extra-add" type="button">+ Adicionar</button>
        </div>
        <div class="hint">Marque o que a pessoa levou. Os sub-itens do aparelho aparecem ao marcar. Itens fora da lista dela entram por “Levou outro aparelho?”.</div>
      </div>
      <div class="field"><label for="hf-acc">Acessórios extras</label><input id="hf-acc" placeholder="Ex.: mochila, carregador avulso…"></div>
      <div class="field"><label for="hf-notes">Observações</label><textarea id="hf-notes" rows="2"></textarea></div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="hf-cancel">Cancelar</button>
        <button class="btn btn-primary" id="hf-save">Registrar saída</button>
      </div>`;

    const itemRow = (a, extra) => `
      <label class="ho-chk" data-row="${a.id}">
        <input type="checkbox" value="${a.id}"${extra ? ' checked' : ''}>
        <span>${escapeHtml(a.asset_tag)} · ${escapeHtml(a.name || a.type_label)}${extra ? ' <span class="muted">(fora da lista da pessoa)</span>' : ''}</span>
      </label>
      <div id="hf-subs-${a.id}" style="margin:0 0 4px 26px"></div>`;

    async function loadSubs(assetId) {
      const box = $('hf-subs-' + assetId);
      const a = byId[assetId];
      if (!box || !a || !a.peripheral_count) return;
      if (!persCache[assetId]) {
        try { persCache[assetId] = (await api('/api/assets/' + assetId)).peripherals || []; }
        catch (e) { persCache[assetId] = []; }
      }
      box.innerHTML = persCache[assetId].map((pe) => `
        <label class="ho-chk"><input type="checkbox" value="${pe.id}" checked> ${escapeHtml(pe.asset_tag)} · ${escapeHtml(pe.type_label)}</label>`).join('');
    }

    function wireChecks() {
      $('hf-items').querySelectorAll('.ho-chk[data-row] > input').forEach((c) => {
        c.onchange = () => {
          if (c.checked) loadSubs(parseInt(c.value, 10));
          else { const b = $('hf-subs-' + c.value); if (b) b.innerHTML = ''; }
        };
      });
    }

    function extraOptions() {
      $('hf-extra').innerHTML = '<option value="">Levou outro aparelho? Selecione…</option>' +
        disponiveis.filter((a) => !listadas.has(a.id))
          .map((a) => `<option value="${a.id}">${escapeHtml(a.asset_tag)} · ${escapeHtml(a.name || a.type_label)}</option>`).join('');
    }

    async function personChanged() {
      const pid = $('hf-person').value;
      const wrap = $('hf-items-field');
      const list = $('hf-items');
      listadas.clear();
      if (!pid) { wrap.hidden = true; list.innerHTML = ''; return; }
      wrap.hidden = false;
      list.innerHTML = '<div class="muted" style="padding:6px 2px">Carregando itens da pessoa…</div>';
      let own = [];
      try { own = (await api('/api/assets?owner=' + encodeURIComponent(pid))).filter((a) => !emHO.has(a.id)); } catch (e) { own = []; }
      own.forEach((a) => { listadas.add(a.id); byId[a.id] = byId[a.id] || a; });
      list.innerHTML = own.length
        ? own.map((a) => itemRow(a, false)).join('')
        : '<div class="muted" style="padding:6px 2px">Nenhum item vinculado a esta pessoa — use “Levou outro aparelho?” abaixo.</div>';
      wireChecks();
      extraOptions();
    }

    $('hf-person').addEventListener('change', personChanged);
    $('hf-extra-add').onclick = () => {
      const id = parseInt($('hf-extra').value, 10);
      if (!id || listadas.has(id) || !byId[id]) return;
      listadas.add(id);
      const vazio = $('hf-items').querySelector('.muted'); if (vazio) vazio.remove();
      $('hf-items').insertAdjacentHTML('beforeend', itemRow(byId[id], true));
      wireChecks();
      extraOptions();
      loadSubs(id); // itens extras entram já marcados
    };

    $('hf-cancel').onclick = closeDrawer;
    $('hf-save').onclick = async () => {
      const pid = $('hf-person').value;
      if (!pid) { toast('Selecione a pessoa.', 'err'); return; }
      const marcados = Array.from($('hf-items').querySelectorAll('.ho-chk[data-row] > input:checked')).map((c) => parseInt(c.value, 10));
      if (!marcados.length) { toast('Marque ao menos um item levado.', 'err'); return; }
      const comuns = {
        person_id: parseInt(pid, 10),
        taken_at: $('hf-date').value || undefined,
        accessories: $('hf-acc').value.trim() || null,
        notes: $('hf-notes').value.trim() || null,
      };
      let okCount = 0; const erros = [];
      for (const aid of marcados) {
        const subsBox = $('hf-subs-' + aid);
        const peripheral_ids = subsBox ? Array.from(subsBox.querySelectorAll('input:checked')).map((c) => parseInt(c.value, 10)) : [];
        try { await api('/api/homeoffice', { method: 'POST', body: Object.assign({ asset_id: aid, peripheral_ids }, comuns) }); okCount++; }
        catch (e) { erros.push((byId[aid] ? byId[aid].asset_tag : aid) + ': ' + e.message); }
      }
      if (okCount) toast(okCount === 1 ? 'Saída registrada.' : `${okCount} saídas registradas.`);
      if (erros.length) toast(erros.join(' · '), 'err');
      if (okCount) { closeDrawer(); if (onDone) onDone(); else rerender(); }
    };
  }

  function hoReturnForm(h, onDone) {
    const body = openDrawer('Registrar devolução');
    body.innerHTML = `
      <div class="detail-head" style="margin-bottom:8px">
        <div class="dh-info">
          <div class="li-title">${tagChip(h.asset_tag || '—')} ${escapeHtml(h.asset_name || '')}</div>
          <div class="li-sub">com ${escapeHtml(h.person_name || '—')} · saiu em ${fmtDate(h.taken_at)} (${hoDays(h.taken_at)})</div>
        </div>
      </div>
      <div class="field"><label for="hr-date">Data da devolução</label><input id="hr-date" type="date" value="${todayStr()}"></div>
      <div class="field"><label for="hr-cond">Condição do aparelho na volta</label><select id="hr-cond">${conditionOptions('')}</select></div>
      ${(h.peripherals || []).length ? `
      <div class="field">
        <label>O que voltou junto (desmarque o que ficou faltando)</label>
        <div id="hr-pers">${h.peripherals.map((pe) => `
          <label class="ho-chk"><input type="checkbox" value="${pe.id}" checked> ${escapeHtml(pe.asset_tag)} · ${escapeHtml(pe.type_label)}</label>`).join('')}</div>
      </div>` : ''}
      <div class="field"><label for="hr-notes">Observações da devolução (estado, avarias, o que faltou…)</label><textarea id="hr-notes" rows="2"></textarea></div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="hr-cancel">Cancelar</button>
        <button class="btn btn-primary" id="hr-save">Confirmar devolução</button>
      </div>`;

    $('hr-cancel').onclick = closeDrawer;
    $('hr-save').onclick = async () => {
      const persEl = $('hr-pers');
      const returned_peripheral_ids = persEl ? Array.from(persEl.querySelectorAll('input:checked')).map((c) => parseInt(c.value, 10)) : [];
      try {
        await api('/api/homeoffice/' + h.id + '/devolver', { method: 'POST', body: {
          returned_at: $('hr-date').value || undefined,
          condition: $('hr-cond').value || null,
          returned_peripheral_ids,
          notes: $('hr-notes').value.trim() || null,
        } });
        toast('Devolução registrada.');
        closeDrawer();
        if (onDone) onDone(); else rerender();
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ---------------------------------------------------------------------------
  // Inventário (conferência física dos itens)
  // ---------------------------------------------------------------------------
  async function inventoryCheckTag(text) {
    const now = Date.now();
    if (text === invLastScan.text && now - invLastScan.at < 2000) return; // anti-repetição
    invLastScan = { text, at: now };
    try {
      const r = await api('/api/inventory/check', { method: 'POST', body: { tag: text } });
      const it = r.item;
      if (r.matched === 'peripheral') toast(`Sub-item ${r.via_tag} → item ${it.asset_tag} conferido.`);
      else if (r.already) toast(`${it.asset_tag} já estava conferido.`);
      else toast(`${it.asset_tag} conferido.`);
      if (r.completed) setTimeout(() => toast('Inventário concluído! 🎉'), 300);
      if (invRefresh) await invRefresh();
    } catch (err) {
      toast(err.message, 'err');
    }
    const w = $('inv-wedge'); if (w) w.focus();
  }

  function invProgressHtml(s) {
    const pct = s.total ? Math.round((100 * s.conferred) / s.total) : 0;
    const started = s.started_at
      ? `Iniciado em ${fmtDateTime(s.started_at)}${s.started_by ? ' por ' + escapeHtml(s.started_by) : ''}`
      : 'Inventário ainda não iniciado — bipe ou marque o primeiro item.';
    return `
      <div class="inv-prog-top">
        <span class="pct">${pct}%</span>
        <span class="lbl">${s.conferred} de ${s.total} conferidos · ${s.pending} pendente${s.pending === 1 ? '' : 's'}</span>
      </div>
      <div class="inv-bar"><span style="width:${pct}%"></span></div>
      <div class="inv-started">${started}</div>`;
  }

  function invTable(items) {
    if (!items.length) {
      if (invFilter === 'pendente') return '<div class="empty"><span class="emoji">✅</span><strong>Nada pendente</strong>Todos os itens deste filtro já foram conferidos.</div>';
      if (invFilter === 'conferido') return '<div class="empty">Nenhum item conferido ainda.</div>';
      return '<div class="empty"><strong>Nenhum item cadastrado</strong>Cadastre itens na aba Itens.</div>';
    }
    return `<div class="table-wrap"><table>
      <thead><tr><th style="width:30px"></th><th>Patrimônio</th><th>Item</th><th>Conferência</th><th></th></tr></thead>
      <tbody>${items.map((it) => `
        <tr class="inv-row${it.conferido ? ' is-conf' : ''}" data-id="${it.id}">
          <td>${it.conferido ? '<span class="inv-ck ok">✓</span>' : '<span class="inv-ck">○</span>'}</td>
          <td>${tagChip(it.asset_tag)}</td>
          <td>
            <div class="cell-title">${escapeHtml(it.name || it.type_label)}</div>
            <div class="cell-sub">${escapeHtml(it.type_label)} · ${it.category === 'equipamento' ? 'Equipamento' : 'Patrimônio'}${it.location ? ' · ' + escapeHtml(it.location) : ''}</div>
          </td>
          <td>${it.conferido
            ? `<span class="inv-meta">${escapeHtml(it.inv_by || '—')}${it.inv_at ? ' · ' + fmtDateTime(it.inv_at) : ''}</span>`
            : '<span class="muted">pendente</span>'}</td>
          <td><div class="row-actions">${it.conferido
            ? `<button class="btn btn-ghost btn-sm" data-uncheck="${it.id}">Desfazer</button>`
            : `<button class="btn btn-sm btn-conf" data-check="${it.id}">Conferir</button>`}</div></td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  async function renderInventory() {
    invFilter = 'todos';
    view().innerHTML = `
      <div class="inv-head panel panel-pad">
        <div id="inv-progress" class="inv-progress"></div>
        <button class="btn btn-ghost btn-sm" id="inv-reset">Reiniciar inventário</button>
      </div>

      <div class="scan-card inv-scan">
        <div class="inv-scan-row">
          <input class="wedge-input" id="inv-wedge" placeholder="Digite o patrimônio e tecle Enter para conferir…" autocomplete="off">
        </div>
        <div class="hint">Digite (ou cole) o número do patrimônio e tecle Enter. Conferir um sub-item marca o item ao qual ele pertence. Você também pode usar o botão “Conferir” em cada linha da lista.</div>
      </div>

      <div class="toolbar inv-toolbar">
        <div class="seg" id="inv-seg">
          <button class="seg-btn active" data-f="todos">Todos <span class="seg-c" id="inv-c-all">0</span></button>
          <button class="seg-btn" data-f="pendente">Pendentes <span class="seg-c" id="inv-c-pend">0</span></button>
          <button class="seg-btn" data-f="conferido">Conferidos <span class="seg-c" id="inv-c-conf">0</span></button>
        </div>
        <div class="search"><input id="inv-q" placeholder="Buscar por patrimônio, nome ou local…"></div>
      </div>
      <div class="panel"><div id="inv-list"></div></div>`;

    const loadInv = async () => {
      const p = new URLSearchParams();
      if (invFilter !== 'todos') p.set('state', invFilter);
      const q = $('inv-q').value.trim(); if (q) p.set('q', q);
      const data = await api('/api/inventory?' + p.toString());
      $('inv-progress').innerHTML = invProgressHtml(data.summary);
      $('inv-c-all').textContent = data.counts.all;
      $('inv-c-pend').textContent = data.counts.pending;
      $('inv-c-conf').textContent = data.counts.conferred;
      $('inv-list').innerHTML = invTable(data.items);
      wireInvRows();
    };
    invRefresh = loadInv;

    const setSeg = () => $('inv-seg').querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.f === invFilter));

    function wireInvRows() {
      $('inv-list').querySelectorAll('tr.inv-row').forEach((tr) => {
        tr.addEventListener('click', (e) => { if (e.target.closest('.row-actions')) return; openAssetDetail(tr.dataset.id); });
      });
      $('inv-list').querySelectorAll('[data-check]').forEach((b) => {
        b.onclick = async () => {
          try {
            const r = await api('/api/inventory/check', { method: 'POST', body: { asset_id: b.dataset.check } });
            if (r.completed) toast('Inventário concluído! 🎉'); else toast('Item conferido.');
            await loadInv();
          } catch (err) { toast(err.message, 'err'); }
        };
      });
      $('inv-list').querySelectorAll('[data-uncheck]').forEach((b) => {
        b.onclick = async () => {
          try { await api('/api/inventory/check/' + b.dataset.uncheck, { method: 'DELETE' }); toast('Conferência desfeita.'); await loadInv(); }
          catch (err) { toast(err.message, 'err'); }
        };
      });
    }

    $('inv-reset').onclick = async () => {
      const okReset = await confirmDialog('Reiniciar inventário', 'Isto apaga todas as conferências e começa um novo inventário. Os itens cadastrados não são afetados. Continuar?', 'Reiniciar', true);
      if (!okReset) return;
      try { await api('/api/inventory/reset', { method: 'POST' }); toast('Inventário reiniciado.'); invFilter = 'todos'; setSeg(); await loadInv(); }
      catch (err) { toast(err.message, 'err'); }
    };

    $('inv-seg').querySelectorAll('.seg-btn').forEach((b) => {
      b.onclick = () => { invFilter = b.dataset.f; setSeg(); loadInv(); };
    });

    const wedge = $('inv-wedge');
    wedge.focus();
    wedge.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = wedge.value.trim(); wedge.value = ''; if (v) inventoryCheckTag(v); }
    });

    let deb;
    $('inv-q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(loadInv, 250); });

    await loadInv();
  }

  // ---------------------------------------------------------------------------
  // Etiquetas (impressão de QR Codes)
  // ---------------------------------------------------------------------------
  async function renderLabels() {
    const catOpts = `<option value="">Todas as categorias</option>
      <option value="equipamento">Equipamentos</option>
      <option value="patrimonio">Patrimônio</option>`;
    const typeOpts = '<option value="">Todos os tipos</option>' +
      state.catalog.groups.flatMap((g) => g.types.map((t) => `<option value="${t.key}">${escapeHtml(t.label)}</option>`)).join('');

    view().innerHTML = `
      <div class="toolbar no-print">
        <div class="search"><input id="lb-q" placeholder="Buscar…"></div>
        <select class="filter" id="lb-cat">${catOpts}</select>
        <select class="filter" id="lb-type">${typeOpts}</select>
        <label class="muted" style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="lb-per"> incluir sub-itens</label>
        <button class="btn btn-ghost btn-sm" id="lb-all">Selecionar todas</button>
        <button class="btn btn-ghost btn-sm" id="lb-none">Limpar</button>
        <button class="btn btn-primary" id="lb-print">Imprimir</button>
      </div>
      <div class="hint no-print" style="margin:-4px 2px 10px">Clique nas etiquetas que quer imprimir (elas ficam destacadas). Sem nenhuma marcada, imprime todas as filtradas. Tamanho: 4×2 cm.</div>
      <div class="labels-grid" id="labels-grid"></div>`;

    const load = async () => {
      const p = new URLSearchParams();
      const q = $('lb-q').value.trim(); if (q) p.set('q', q);
      const cat = $('lb-cat').value; if (cat) p.set('category', cat);
      const ty = $('lb-type').value; if (ty) p.set('type', ty);
      const assets = await api('/api/assets?' + p.toString());
      let items = assets.map((a) => ({ tag: a.asset_tag, name: a.name || a.type_label, sub: a.type_label, per: false }));
      if ($('lb-per').checked) {
        let peris = await api('/api/peripherals');
        if (ty) peris = peris.filter((pe) => pe.type === ty);
        if (q) {
          const t = q.toLowerCase();
          peris = peris.filter((pe) => (pe.asset_tag || '').toLowerCase().includes(t) || (pe.type_label || '').toLowerCase().includes(t));
        }
        items = items.concat(peris.map((pe) => ({ tag: pe.asset_tag, name: pe.type_label, sub: 'Sub-item de ' + pe.parent_tag, per: true })));
      }
      $('labels-grid').innerHTML = items.length
        ? items.map((it) => `
          <label class="label-card" data-tag="${escapeHtml(it.tag)}">
            <input type="checkbox" class="lc-check no-print" aria-label="Selecionar ${escapeHtml(it.tag)}">
            <img class="lc-qr" src="${qrDataUrl(it.tag, 220)}" alt="QR ${escapeHtml(it.tag)}">
            <div class="lc-right">
              <img class="lc-logo" src="assets/logo.png" alt="${escapeHtml(state.config.company)}">
              <div class="lc-name">${escapeHtml(it.name)}</div>
              <div class="lc-tag">${escapeHtml(it.tag)}</div>
            </div>
          </label>`).join('')
        : '<div class="empty">Nenhum item para gerar etiquetas.</div>';
      wireSelection();
      updateSelUI();
    };

    const grid = () => $('labels-grid');
    const cards = () => Array.from(grid().querySelectorAll('.label-card'));
    const checkedCards = () => cards().filter((c) => { const cb = c.querySelector('.lc-check'); return cb && cb.checked; });

    function wireSelection() {
      cards().forEach((card) => {
        const cb = card.querySelector('.lc-check');
        if (!cb) return;
        cb.addEventListener('change', () => { card.classList.toggle('sel', cb.checked); updateSelUI(); });
      });
    }
    function updateSelUI() {
      const n = checkedCards().length;
      const total = cards().length;
      $('lb-print').textContent = n > 0 ? `Imprimir selecionadas (${n})` : (total ? `Imprimir todas (${total})` : 'Imprimir');
    }
    function setAll(v) {
      cards().forEach((c) => { const cb = c.querySelector('.lc-check'); if (cb) { cb.checked = v; c.classList.toggle('sel', v); } });
      updateSelUI();
    }

    let deb;
    $('lb-q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(load, 250); });
    $('lb-cat').addEventListener('change', load);
    $('lb-type').addEventListener('change', load);
    $('lb-per').addEventListener('change', load);
    $('lb-all').onclick = () => setAll(true);
    $('lb-none').onclick = () => setAll(false);
    $('lb-print').onclick = () => {
      const g = grid();
      if (checkedCards().length > 0) g.classList.add('print-selected'); // imprime só as marcadas
      const cleanup = () => { g.classList.remove('print-selected'); window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup);
      setTimeout(cleanup, 3000); // fallback se afterprint não disparar
      window.print();
    };
    await load();
  }

  // ---------------------------------------------------------------------------
  // Auditoria
  // ---------------------------------------------------------------------------
  const ACTION_LABELS = {
    criar: 'Criou', editar: 'Editou', excluir: 'Excluiu', atribuir: 'Atribuiu dono',
    remover_dono: 'Removeu dono', leitura: 'Leitura QR', status: 'Alterou status',
    inventario: 'Inventário', login: 'Entrou', logout: 'Saiu', config: 'Configurações',
    ho_saida: 'Saída p/ Home Office', ho_volta: 'Devolução Home Office',
    seed: 'Sistema',
  };
  const ENTITY_LABELS = { asset: 'Item', peripheral: 'Sub-item', person: 'Pessoa', room: 'Sala', homeoffice: 'Home Office', assignment: 'Vínculo', user: 'Operador', sistema: 'Sistema' };
  function auditActionLabel(a) { return ACTION_LABELS[a] || a; }

  async function renderAudit() {
    const actionOpts = '<option value="">Todas as ações</option>' +
      Object.entries(ACTION_LABELS).filter(([k]) => k !== 'seed').map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('');
    const entityOpts = '<option value="">Todos os tipos</option>' +
      Object.entries(ENTITY_LABELS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('');

    view().innerHTML = `
      <div class="toolbar">
        <div class="search"><input id="au-q" placeholder="Buscar por item, operador ou detalhe…"></div>
        <select class="filter" id="au-action">${actionOpts}</select>
        <select class="filter" id="au-entity">${entityOpts}</select>
      </div>
      <div class="panel"><div id="audit-rows"></div></div>
      <div class="form-actions" style="justify-content:center"><button class="btn btn-ghost" id="au-more" hidden>Carregar mais</button></div>`;

    let offset = 0;
    const LIMIT = 100;
    let loaded = [];

    const fetchPage = async (reset) => {
      if (reset) { offset = 0; loaded = []; }
      const p = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      const q = $('au-q').value.trim(); if (q) p.set('q', q);
      const ac = $('au-action').value; if (ac) p.set('action', ac);
      const en = $('au-entity').value; if (en) p.set('entity', en);
      const data = await api('/api/audit?' + p.toString());
      loaded = loaded.concat(data.rows);
      offset += data.rows.length;
      $('audit-rows').innerHTML = auditTable(loaded);
      $('au-more').hidden = offset >= data.total;
    };

    const auditTable = (rows) => {
      if (!rows.length) return '<div class="empty">Nenhum registro de auditoria.</div>';
      return `<div class="table-wrap"><table>
        <thead><tr><th>Quando</th><th>Operador</th><th>Ação</th><th>Tipo</th><th>Item</th><th>Detalhes</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td class="nowrap">${fmtDateTime(r.ts)}</td>
            <td>${escapeHtml(r.actor)}</td>
            <td>${escapeHtml(auditActionLabel(r.action))}</td>
            <td>${escapeHtml(ENTITY_LABELS[r.entity_type] || r.entity_type || '—')}</td>
            <td>${escapeHtml(r.entity_label || '—')}</td>
            <td class="muted">${escapeHtml(auditDetails(r.details))}</td>
          </tr>`).join('')}</tbody></table></div>`;
    };

    let deb;
    $('au-q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => fetchPage(true), 250); });
    $('au-action').addEventListener('change', () => fetchPage(true));
    $('au-entity').addEventListener('change', () => fetchPage(true));
    $('au-more').onclick = () => fetchPage(false);
    await fetchPage(true);
  }

  function auditDetails(d) {
    if (!d) return '';
    try {
      const o = JSON.parse(d);
      if (o && typeof o === 'object') {
        const parts = [];
        if (o.tipo) parts.push(o.tipo);
        if (o.valor_centavos != null) parts.push(fmtCurrency(o.valor_centavos));
        return parts.join(' · ') || JSON.stringify(o);
      }
    } catch { /* texto puro */ }
    return d;
  }

  // ---------------------------------------------------------------------------
  // Abrir item por patrimônio (leitura)
  // ---------------------------------------------------------------------------
  async function openAssetByTag(tag) {
    if (!tag) { location.hash = '#/painel'; return; }
    try {
      const r = await api('/api/lookup/' + encodeURIComponent(tag));
      const asset = r.kind === 'asset' ? r.data : r.data.parent;
      setActive('equipamentos');
      setTitle('Itens');
      await renderItems();
      openAssetDetail(asset.id);
      if (r.kind === 'peripheral') toast(`Sub-item ${r.data.asset_tag} pertence a ${asset.asset_tag}.`);
    } catch (err) {
      view().innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
  }

  // ---------------------------------------------------------------------------
  // Sidebar (mobile)
  // ---------------------------------------------------------------------------
  function closeSidebar() { document.querySelector('.sidebar').classList.remove('open'); }

  // ---------------------------------------------------------------------------
  // Cópia de segurança (exportar / importar) — os dados vivem no SERVIDOR (base
  // compartilhada). Um backup em arquivo é uma cópia extra de segurança da base.
  // ---------------------------------------------------------------------------
  function todayStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function backupFileName() { return `controle-patrimonial-${todayStr()}.xlsx`; }

  // -------- Backup em planilha Excel (amigável + restaurável) ----------------
  async function exportToExcel() {
    if (typeof XLSX === 'undefined') { toast('Biblioteca de planilha indisponível.', 'err'); return; }
    try {
      const dump = await api('/api/export');
      const money = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
      const assetsById = {}; (dump.assets || []).forEach((a) => { assetsById[a.id] = a; });
      const peopleById = {}; (dump.people || []).forEach((p) => { peopleById[p.id] = p; });
      const typeLabel = (t) => { for (const g of state.catalog.groups) { const x = g.types.find((y) => y.key === t); if (x) return x.label; } const p = (state.catalog.peripheralTypes || []).find((y) => y.key === t); return p ? p.label : (t || ''); };
      const wb = XLSX.utils.book_new();
      const add = (name, aoa) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);

      const itemRows = [['Patrimônio', 'Nome', 'Tipo', 'Categoria', 'Marca', 'Modelo', 'Nº de série', 'Telefone', 'IMEI 1', 'IMEI 2', 'Status', 'Condição', 'Local', 'Valor (R$)', 'Data da compra', 'Nota fiscal', 'Observações']];
      (dump.assets || []).forEach((a) => itemRows.push([a.asset_tag, a.name || '', typeLabel(a.type), a.category === 'equipamento' ? 'Equipamento' : 'Patrimônio', a.brand || '', a.model || '', a.serial_number || '', a.phone_number || '', a.imei1 || '', a.imei2 || '', a.status || '', a.condition || '', a.location || '', money(a.value_cents), a.purchase_date || '', a.invoice_number || '', a.notes || '']));
      add('Itens', itemRows);

      const ownerRows = [['Patrimônio', 'Item', 'Pessoa', 'Turno']];
      (dump.assignments || []).forEach((as) => { const a = assetsById[as.asset_id], p = peopleById[as.person_id]; if (a) ownerRows.push([a.asset_tag, a.name || '', p ? p.name : '', as.shift || '']); });
      add('Donos', ownerRows);

      const perRows = [['Patrimônio', 'Pertence a', 'Tipo', 'Dono', 'Marca', 'Modelo', 'Valor (R$)', 'Data da compra']];
      (dump.peripherals || []).forEach((pe) => { const parent = assetsById[pe.parent_asset_id], owner = peopleById[pe.owner_id]; perRows.push([pe.asset_tag, parent ? parent.asset_tag : '', typeLabel(pe.type), owner ? owner.name : '', pe.brand || '', pe.model || '', money(pe.value_cents), pe.purchase_date || '']); });
      add('Sub-itens', perRows);

      const personRows = [['Nome', 'Matrícula', 'Setor', 'E-mail', 'Telefone']];
      (dump.people || []).forEach((p) => personRows.push([p.name || '', p.registration || '', p.department || '', p.email || '', p.phone || '']));
      add('Pessoas', personRows);

      const hoRows = [['Patrimônio', 'Item', 'Pessoa', 'Saída', 'Devolução', 'Condição na volta', 'Sub-itens levados', 'Acessórios', 'Obs. saída', 'Obs. devolução']];
      (dump.homeoffice || []).forEach((h) => {
        const a = assetsById[h.asset_id]; const p = peopleById[h.person_id];
        const perNames = (h.peripheral_ids || []).map((pid) => { const pe = (dump.peripherals || []).find((x) => x.id === pid); return pe ? pe.asset_tag : pid; }).join(', ');
        hoRows.push([a ? a.asset_tag : '', a ? (a.name || '') : '', p ? p.name : '', h.taken_at || '', h.returned_at || '', h.return_condition || '', perNames, h.accessories || '', h.notes || '', h.return_notes || '']);
      });
      add('Home Office', hoRows);

      const roomRows = [['Sala', 'Observações']];
      (dump.rooms || []).forEach((r) => roomRows.push([r.name || '', r.notes || '']));
      add('Locais', roomRows);

      const userRows = [['Login', 'Nome', 'Papel', 'Ativo', 'Criado em']];
      (dump.users || []).forEach((u) => userRows.push([u.login, u.name, u.role === 'admin' ? 'Administrador' : 'Operador', u.active === false ? 'Não' : 'Sim', u.created_at || '']));
      add('Operadores', userRows);

      const auRows = [['Quando', 'Operador', 'Ação', 'Tipo', 'Item', 'Detalhes']];
      (dump.audit_log || []).slice().reverse().forEach((r) => auRows.push([r.ts || '', r.actor || '', auditActionLabel(r.action), ENTITY_LABELS[r.entity_type] || r.entity_type || '', r.entity_label || '', auditDetails(r.details)]));
      add('Auditoria', auRows);

      // planilha oculta com o backup completo (JSON em pedaços) — usada na restauração
      const json = JSON.stringify(dump);
      const CH = 30000, chunks = [['__CONTROLE_PATRIMONIAL_BACKUP__']];
      for (let i = 0; i < json.length; i += CH) chunks.push([json.slice(i, i + CH)]);
      add('_backup', chunks);
      wb.Workbook = { Sheets: wb.SheetNames.map((n) => ({ Hidden: n === '_backup' ? 1 : 0 })) };

      XLSX.writeFile(wb, backupFileName());
      toast('Planilha de backup baixada.');
    } catch (e) {
      toast('Falha ao exportar: ' + e.message, 'err');
    }
  }

  function importFromExcel(file) {
    if (typeof XLSX === 'undefined') { toast('Biblioteca de planilha indisponível.', 'err'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      let json;
      try {
        const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
        const sheet = wb.Sheets['_backup'];
        if (!sheet) { toast('Arquivo não reconhecido. Selecione uma planilha gerada por este sistema.', 'err'); return; }
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const flat = aoa.map((r) => (r && r[0] != null) ? String(r[0]) : '');
        if (flat[0] !== '__CONTROLE_PATRIMONIAL_BACKUP__') { toast('Arquivo não reconhecido.', 'err'); return; }
        json = flat.slice(1).join('');
      } catch (e) { toast('Não foi possível ler a planilha: ' + e.message, 'err'); return; }

      const okToReplace = await confirmDialog('Restaurar backup', 'ATENÇÃO: isto substitui TODA a base compartilhada do servidor (de toda a equipe) pelos dados da planilha — itens, pessoas, operadores e auditoria de todos serão sobrescritos. O estado atual é salvo num backup automático antes. Deseja continuar?', 'Restaurar', true);
      if (!okToReplace) return;
      try {
        await api('/api/import', { method: 'POST', body: JSON.parse(json) });
        state.people = null;
        state.rooms = null;
        state.config = await api('/api/config');
        state.catalog = state.config.catalog;
        const sess = readSession();
        if (sess) {
          const s = await api('/api/auth/session?id=' + encodeURIComponent(sess.id)).catch(() => null);
          if (!s) { clearSession(); toast('Backup restaurado. Entre novamente.'); showLogin('Sua sessão não existe mais no backup restaurado. Entre novamente.'); return; }
          setSession(s.user);
        }
        toast('Backup restaurado.');
        buildNav();
        renderUserBox();
        location.hash = '#/painel';
        rerender();
      } catch (e) {
        toast(e.message || 'Falha ao restaurar.', 'err');
      }
    };
    reader.onerror = () => toast('Não foi possível ler o arquivo.', 'err');
    reader.readAsArrayBuffer(file);
  }

  // ---------------------------------------------------------------------------
  // Configurações (empresa, prefixo do patrimônio e backup)
  // ---------------------------------------------------------------------------
  async function renderConfig() {
    const cfg = state.config;
    view().innerHTML = `
      <div class="cfg-grid">
        <div class="panel panel-pad cfg-card">
          <div class="section-title">Empresa</div>
          <div class="field"><label for="cfg-company">Nome da empresa</label><input id="cfg-company" maxlength="80" value="${escapeHtml(cfg.company)}"></div>
          <div class="hint">Aparece no topo das etiquetas e do sistema.</div>
          <div class="form-actions" style="justify-content:flex-start"><button class="btn btn-primary btn-sm" id="cfg-company-save">Salvar empresa</button></div>
        </div>

        <div class="panel panel-pad cfg-card">
          <div class="section-title">Patrimônio · numeração</div>
          <div class="field"><label for="cfg-prefix">Prefixo do patrimônio</label><input id="cfg-prefix" maxlength="8" value="${escapeHtml(cfg.tagPrefix)}" style="text-transform:uppercase"></div>
          <div class="hint">Letras e números, até 8 caracteres. Ex.: <strong>BRA</strong> gera <strong>BRA-000001</strong>, <strong>BRA-000002</strong>… Os itens já cadastrados mantêm o número atual.</div>
          <div class="form-actions" style="justify-content:flex-start"><button class="btn btn-primary btn-sm" id="cfg-prefix-save">Salvar prefixo</button></div>
        </div>

        <div class="panel panel-pad cfg-card cfg-span">
          <div class="section-title">Cópia de segurança (backup)</div>
          <p class="cfg-text">Os dados ficam no <strong>servidor</strong> e são <strong>compartilhados por toda a equipe</strong>. O servidor já guarda backups automáticos; ainda assim, baixe uma planilha de tempos em tempos como cópia de segurança externa.</p>
          <div class="cfg-backup-actions">
            <button class="btn btn-primary" id="cfg-export">⬇ Baixar planilha de backup</button>
            <button class="btn btn-ghost" id="cfg-import">⬆ Restaurar de uma planilha</button>
            <input id="cfg-import-file" type="file" accept=".xlsx" hidden>
          </div>
          <div class="hint">A planilha (Excel) abre normalmente para você consultar os itens. Para <strong>restaurar</strong>, selecione uma planilha gerada aqui. Observação: para alterar dados use o próprio sistema — mudanças feitas direto na planilha não voltam na restauração.</div>
        </div>
      </div>`;

    $('cfg-company-save').onclick = async () => {
      const company = $('cfg-company').value.trim();
      if (!company) { toast('Informe o nome da empresa.', 'err'); return; }
      try { const r = await api('/api/config', { method: 'PUT', body: { company } }); state.config.company = r.company; toast('Empresa atualizada.'); }
      catch (e) { toast(e.message, 'err'); }
    };
    $('cfg-prefix-save').onclick = async () => {
      const tag_prefix = $('cfg-prefix').value.trim();
      if (!tag_prefix) { toast('Informe o prefixo.', 'err'); return; }
      try { const r = await api('/api/config', { method: 'PUT', body: { tag_prefix } }); state.config.tagPrefix = r.tagPrefix; $('cfg-prefix').value = r.tagPrefix; toast('Prefixo atualizado para ' + r.tagPrefix + '.'); }
      catch (e) { toast(e.message, 'err'); }
    };
    $('cfg-export').onclick = exportToExcel;
    $('cfg-import').onclick = () => $('cfg-import-file').click();
    $('cfg-import-file').onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) importFromExcel(f); e.target.value = ''; };
  }

  // ---------------------------------------------------------------------------
  // Operadores (somente administradores)
  // ---------------------------------------------------------------------------
  async function renderOperators() {
    setTopbar('<button class="btn btn-primary" id="op-new">+ Novo operador</button>');
    const load = async () => {
      const users = await api('/api/users');
      view().innerHTML = `
        <div class="panel"><div class="table-wrap"><table>
          <thead><tr><th>Login</th><th>Nome</th><th>Papel</th><th>Situação</th><th>Criado em</th><th></th></tr></thead>
          <tbody>${users.map((u) => `
            <tr>
              <td class="mono">${escapeHtml(u.login)}</td>
              <td>${escapeHtml(u.name)}${state.user && u.id === state.user.id ? ' <span class="muted">(você)</span>' : ''}</td>
              <td>${u.role === 'admin' ? '<span class="pill role-admin">Administrador</span>' : '<span class="pill role-op">Operador</span>'}</td>
              <td>${u.active ? '<span class="muted">Ativo</span>' : '<span class="pill" style="--pc:#9aa0a6">Inativo</span>'}</td>
              <td class="muted nowrap">${fmtDateTime(u.created_at)}</td>
              <td><div class="row-actions">
                <button class="icon-btn" data-edit="${u.id}" title="Editar">✎</button>
                <button class="icon-btn" data-del="${u.id}" data-name="${escapeHtml(u.name)}" title="Excluir">🗑</button>
              </div></td>
            </tr>`).join('')}</tbody></table></div></div>`;
      view().querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => operatorForm(users.find((u) => String(u.id) === b.dataset.edit)); });
      view().querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          const ok = await confirmDialog('Excluir operador', `Excluir o operador “${b.dataset.name}”? Esta ação não pode ser desfeita.`, 'Excluir', true);
          if (!ok) return;
          try { await api('/api/users/' + b.dataset.del, { method: 'DELETE' }); toast('Operador excluído.'); load(); }
          catch (e) { toast(e.message, 'err'); }
        };
      });
    };
    $('op-new').onclick = () => operatorForm(null, load);
    await load();
    // disponibiliza o recarregamento para o formulário
    renderOperators._reload = load;
  }

  function operatorForm(u) {
    const editing = !!u;
    const body = openDrawer(editing ? 'Editar operador' : 'Novo operador');
    body.innerHTML = `
      <div class="field"><label for="u-login">Login</label><input id="u-login" autocapitalize="none" spellcheck="false" value="${escapeHtml(editing ? u.login : '')}" placeholder="ex.: joao.silva"></div>
      <div class="field"><label for="u-name">Nome</label><input id="u-name" value="${escapeHtml(editing ? u.name : '')}" placeholder="Nome completo"></div>
      <div class="field"><label for="u-pass">Senha</label><input id="u-pass" type="password" autocomplete="new-password" placeholder="${editing ? 'deixe em branco para manter a atual' : 'mínimo 4 caracteres'}"></div>
      <div class="field-row">
        <div class="field"><label for="u-role">Papel</label><select id="u-role"><option value="operador"${editing && u.role !== 'admin' ? ' selected' : ''}>Operador</option><option value="admin"${editing && u.role === 'admin' ? ' selected' : ''}>Administrador</option></select></div>
        <div class="field"><label for="u-active">Situação</label><select id="u-active"><option value="1"${!editing || u.active ? ' selected' : ''}>Ativo</option><option value="0"${editing && !u.active ? ' selected' : ''}>Inativo</option></select></div>
      </div>
      <div class="hint">Administradores gerenciam operadores e configurações. Operadores acessam o restante do sistema. Toda alteração fica registrada na Auditoria com o operador, data e hora.</div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="u-cancel">Cancelar</button>
        <button class="btn btn-primary" id="u-save">${editing ? 'Salvar' : 'Cadastrar operador'}</button>
      </div>`;
    $('u-cancel').onclick = closeDrawer;
    $('u-save').onclick = async () => {
      const payload = { login: $('u-login').value.trim().toLowerCase(), name: $('u-name').value.trim(), role: $('u-role').value, active: $('u-active').value === '1' };
      const pass = $('u-pass').value;
      if (pass) payload.password = pass;
      if (!payload.login) { toast('Informe o login.', 'err'); return; }
      if (!payload.name) { toast('Informe o nome.', 'err'); return; }
      if (!editing && !pass) { toast('Defina uma senha.', 'err'); return; }
      try {
        if (editing) {
          await api('/api/users/' + u.id, { method: 'PUT', body: payload });
          toast('Operador atualizado.');
          if (state.user && u.id === state.user.id) { await restoreSession(); buildNav(); renderUserBox(); }
        } else {
          await api('/api/users', { method: 'POST', body: payload });
          toast('Operador cadastrado.');
        }
        closeDrawer();
        if (renderOperators._reload) renderOperators._reload();
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ---------------------------------------------------------------------------
  // Sessão e login dos operadores
  // ---------------------------------------------------------------------------
  function readSession() {
    try { const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return (s && s.id != null) ? s : null; } catch { return null; }
  }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }
  function setSession(user) {
    state.user = { id: user.id, login: user.login, name: user.name, role: user.role };
    state.operator = user.name;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id, name: user.name })); } catch { /* ignore */ }
  }
  async function restoreSession() {
    const s = readSession();
    if (!s) return false;
    try { const r = await api('/api/auth/session?id=' + encodeURIComponent(s.id)); setSession(r.user); return true; }
    catch { clearSession(); return false; }
  }

  function showLogin(msg) {
    removeLogin();
    const ov = document.createElement('div');
    ov.className = 'login-overlay';
    ov.id = 'login-overlay';
    ov.innerHTML = `
      <div class="login-card">
        <img class="login-logo" src="assets/logo.png" alt="${escapeHtml(state.config ? state.config.company : '')}">
        <div class="login-title">Controle Patrimonial</div>
        <div class="login-sub">Entre com seu login de operador</div>
        <div class="field"><label for="lg-login">Login</label><input id="lg-login" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="seu.login"></div>
        <div class="field"><label for="lg-pass">Senha</label><input id="lg-pass" type="password" autocomplete="current-password" placeholder="••••••"></div>
        <div class="login-err" id="lg-err" hidden></div>
        <button class="btn btn-primary login-btn" id="lg-go">Entrar</button>
        <div class="login-hint">Primeiro acesso? Use <strong>admin</strong> / <strong>admin123</strong> e depois cadastre os operadores e troque a senha em <strong>Operadores</strong>.</div>
      </div>`;
    document.body.appendChild(ov);
    const loginEl = $('lg-login'), passEl = $('lg-pass'), errEl = $('lg-err');
    const showErr = (m) => { errEl.textContent = m; errEl.hidden = false; };
    if (msg) showErr(msg);
    const submit = async () => {
      const login = loginEl.value.trim(), password = passEl.value;
      if (!login || !password) { showErr('Informe login e senha.'); return; }
      try {
        const r = await api('/api/auth/login', { method: 'POST', body: { login, password } });
        setSession(r.user);
        startApp();
      } catch (err) { showErr(err.message || 'Não foi possível entrar.'); passEl.value = ''; passEl.focus(); }
    };
    $('lg-go').onclick = submit;
    [loginEl, passEl].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
    loginEl.focus();
  }
  function removeLogin() { const o = $('login-overlay'); if (o) o.remove(); }

  function renderUserBox() {
    const box = $('operator-box');
    if (!box || !state.user) return;
    box.innerHTML = `
      <div class="op-user">
        <div class="op-ident">
          <span class="op-name-txt">${escapeHtml(state.user.name)}</span>
          <span class="op-role">${state.user.role === 'admin' ? 'Administrador' : 'Operador'}</span>
        </div>
        <button class="btn btn-ghost btn-sm op-logout" id="btn-logout" title="Sair">Sair</button>
      </div>`;
    $('btn-logout').onclick = logout;
  }
  async function logout() {
    const name = state.user ? state.user.name : '';
    try { await api('/api/auth/logout', { method: 'POST', body: { name } }); } catch { /* ignore */ }
    clearSession();
    disconnectRealtime();
    state.user = null; state.operator = '';
    closeDrawer();
    view().innerHTML = '';
    $('nav').innerHTML = '';
    setTopbar('');
    setTitle('Controle Patrimonial');
    showLogin();
  }

  // ---------------------------------------------------------------------------
  // Tempo real: recebe avisos do servidor (SSE) e atualiza a tela dos operadores
  // ---------------------------------------------------------------------------
  function connectRealtime() {
    if (evtSource || typeof EventSource === 'undefined') return;
    try {
      evtSource = new EventSource('/api/events');
      let opened = false;
      evtSource.addEventListener('open', () => {
        if (opened) onRemoteChange(); // reconectou (ex.: servidor reiniciou) → ressincroniza
        opened = true;
      });
      evtSource.addEventListener('message', (e) => {
        let evt = null;
        try { evt = JSON.parse(e.data); } catch (err) { return; }
        if (!evt || evt.origin === CLIENT_ID) return; // ignora as próprias mudanças deste operador
        onRemoteChange();
      });
    } catch (e) { /* ignore */ }
  }
  function disconnectRealtime() {
    if (evtSource) { try { evtSource.close(); } catch (e) { /* ignore */ } evtSource = null; }
  }
  function onRemoteChange() {
    // Inventário: atualiza a lista preservando o foco do leitor de código.
    if (state.route && state.route.seg === 'inventario' && invRefresh) { invRefresh(); return; }
    // Preenchendo uma inspeção? não recarrega a tela no meio das respostas.
    if (state.route && state.route.seg === 'inspecao' && (state.route.rest || [])[0] === 'preencher') { pendingRefresh = true; return; }
    // Operador ocupado (gaveta/modal aberto ou digitando)? adia até liberar.
    const drawerOpen = $('drawer') && $('drawer').classList.contains('open');
    const modalOpen = !!document.querySelector('.modal-backdrop');
    const ae = document.activeElement;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT');
    if (drawerOpen || modalOpen || typing) { pendingRefresh = true; return; }
    rerender();
  }

  function startApp() {
    removeLogin();
    buildNav();
    renderUserBox();
    connectRealtime();
    if (!location.hash) location.hash = '#/painel'; // dispara hashchange → handleRoute
    else handleRoute();
  }

  // ---------------------------------------------------------------------------
  // Inicialização
  // ---------------------------------------------------------------------------
  async function boot() {
    try {
      state.config = await api('/api/config');
      state.catalog = state.config.catalog;
    } catch (e) {
      document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">Não foi possível conectar ao servidor do Controle Patrimonial. Verifique se você está na rede (ZeroTier) e se o servidor está ligado, depois recarregue a página.</div>';
      return;
    }

    // handlers globais (uma única vez)
    $('drawer-close').onclick = closeDrawer;
    $('drawer-backdrop').onclick = closeDrawer;
    $('menu-toggle').onclick = () => document.querySelector('.sidebar').classList.toggle('open');
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
    window.addEventListener('hashchange', () => { if (state.user) handleRoute(); });

    if (await restoreSession()) startApp();
    else showLogin();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
