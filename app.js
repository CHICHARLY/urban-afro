/* Mi Tienda de Mecatos — cliente que trabaja contra el servidor local (SQLite).
 * Los datos viven en datos/tienda.db: todos los dispositivos ven lo mismo. */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = n => '$' + Math.round(n || 0).toLocaleString('es-CO');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const iconHtml = v => !v ? '' : (String(v).startsWith('icon:')
  ? `<img class="picon" src="assets/icons/${encodeURIComponent(String(v).slice(5))}.svg" alt="" loading="lazy">`
  : esc(v));
const iconPrefix = v => String(v || '').startsWith('icon:') ? '' : (v ? esc(v) + ' ' : '');
/* Identificador de caja: único por pestaña (sessionStorage), para reservar stock al agregar al carrito */
const SESSION = sessionStorage.getItem('mecatos.session') || (() => {
  const s = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  sessionStorage.setItem('mecatos.session', s); return s;
})();

/* ---------- Estado ---------- */
let db = { config: { name: 'Mi Tienda de Mecatos', defMin: 5 }, categories: [], products: [], clients: {}, reservations: 0 };
let serverOk = true;
const prod = id => db.products.find(p => p.id === Number(id));

/* 'servidor' = base SQLite compartida · 'local' = datos en este navegador (GitHub Pages) */
let MODE = null;
async function detectMode() {
  try {
    const r = await fetch('api/data', { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (r.ok && (r.headers.get('content-type') || '').includes('application/json')) { MODE = 'servidor'; return; }
  } catch (e) {}
  MODE = 'local';
}

async function api(path, body, method) {
  if (MODE === 'local') return window.StaticAPI.handle(method || (body ? 'POST' : 'GET'), path, body);
  const res = await fetch(path, method === 'GET' || !body ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok || (data && data.error)) throw new Error((data && data.error) || 'El servidor no respondió (' + res.status + ')');
  if (!serverOk) { serverOk = true; net(); }
  return data;
}
async function refresh() {
  try {
    db = await api('/api/data');
    if (!serverOk) { serverOk = true; net(); }
  } catch (e) {
    if (MODE === 'local') { toast(e.message); return; }
    if (serverOk) { serverOk = false; net(); toast('Sin conexión con el servidor de la tienda'); }
    return;
  }
  applyBrand();
  renderNotifs();
  alertNotifications();
  const active = $('.view.active');
  if (active) ({ 'view-caja': renderCaja, 'view-productos': renderProductos, 'view-fiado': renderFiado, 'view-reportes': renderReportes, 'view-ajustes': renderAjustes }[active.id] || renderCaja)();
}

/* Multi-caja en tiempo real: cada cambio en la base refresca todas las cajas abiertas */
let refreshTimer = null;
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 250); }
function connectEvents() {
  if (MODE === 'local') { // en modo estático, las pestañas del mismo navegador comparten el almacenamiento
    addEventListener('storage', e => { if (e.key === window.StaticAPI.key) scheduleRefresh(); });
    return;
  }
  const es = new EventSource('/api/events');
  es.addEventListener('change', scheduleRefresh);
  es.onerror = () => { /* el navegador reconecta solo */ };
}

let cart = []; // {pid, qty}

/* ---------- Utilidades UI ---------- */
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}
let loaderT = null;
function show(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  ({ caja: renderCaja, productos: renderProductos, fiado: renderFiado, reportes: renderReportes, ajustes: renderAjustes })[view]();
  const l = $('#tabLoader');
  l.classList.add('show');
  clearTimeout(loaderT);
  loaderT = setTimeout(() => l.classList.remove('show'), 550);
}

/* ---------- Notificaciones: mini-popup que lleva a la acción concreta ---------- */
let notifActions = [];
function notifItems() {
  const items = [];
  const push = (sev, t, d, act) => items.push({ sev, t, d, act });
  const out = db.products.filter(p => p.stock <= 0).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const low = db.products.filter(p => p.stock > 0 && p.stock <= (p.min || 0)).sort((a, b) => a.stock - b.stock);
  for (const p of out.slice(0, 3)) push('bad', `${p.name} agotado`, 'Reabastecer inventario', () => goRestock(p.id));
  if (out.length > 3) push('bad', `${out.length - 3} agotado(s) más`, 'Ver lista completa en Productos', () => show('productos'));
  for (const p of low.slice(0, 3)) push('warn', `${p.name} con stock bajo (${p.stock})`, 'Reabastecer inventario', () => goRestock(p.id));
  if (low.length > 3) push('warn', `${low.length - 3} producto(s) bajos`, 'Ver lista completa en Productos', () => show('productos'));
  const deudores = Object.values(db.clients).map(c => ({ c, bal: balance(c) })).filter(x => x.bal > 0).sort((a, b) => b.bal - a.bal);
  for (const { c, bal } of deudores.slice(0, 3)) push('info', `${c.name} debe ${money(bal)}`, 'Registrar abono', () => { show('fiado'); openPay(c.name); });
  if (deudores.length > 3) push('info', `${deudores.length - 3} cliente(s) más con fiado`, 'Ver todos en Fiado', () => show('fiado'));
  const res = Number(db.reservations ?? 0);
  if (res > 0) push('muted', `${res} unidad(es) apartadas`, 'Ocupadas en otra caja abierta', () => show('caja'));
  return items;
}
function goRestock(id) { show('productos'); openRestock(id); }
function renderNotifs() {
  const items = notifItems();
  $('#notifBadge').textContent = items.length;
  $('#notifBadge').classList.toggle('hidden', items.length === 0);
  notifActions = items;
  $('#notifList').innerHTML = items.length
    ? items.map((it, i) => `<button type="button" class="nrow ${it.sev}" data-n="${i}"><i class="ndot"></i><span><b>${esc(it.t)}</b><small>${esc(it.d)}</small></span></button>`).join('')
    : '<div class="nnone">Todo al día · sin alertas</div>';
}
function placeNotifPop() {
  const r = $('#notifBtn').getBoundingClientRect();
  const p = $('#notifPop');
  p.style.top = (r.bottom + 8) + 'px';
  p.style.left = Math.max(8, Math.min(r.right - p.offsetWidth, innerWidth - p.offsetWidth - 8)) + 'px';
}
function openNotif() {
  renderNotifs();
  $('#notifPop').classList.add('open');
  $('#notifBtn').classList.add('ring');
  setTimeout(() => $('#notifBtn').classList.remove('ring'), 600);
  placeNotifPop();
}
function closeNotif() { $('#notifPop').classList.remove('open'); }

/* ---------- PWA: instalación + notificaciones del sistema ---------- */
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
const notifSupported = () => 'Notification' in window;
let deferredPrompt = null;

function permText() {
  if (!notifSupported()) return 'no soportadas por este navegador';
  return { granted: 'activadas', denied: 'bloqueadas (permiso rechazado en el navegador)' }[Notification.permission] || 'pendientes de activar';
}
function updateAppStatus() {
  const el = $('#appStatus'); if (!el) return;
  const inst = isStandalone() ? 'app instalada (pantalla completa)' : deferredPrompt ? 'lista para instalar' : 'en navegador';
  el.textContent = `Estado: ${inst} · Notificaciones ${permText()}.`;
  $('#installBtn2').classList.toggle('hidden', isStandalone());
  $('#notifBtn2').classList.toggle('hidden', notifSupported() && Notification.permission === 'granted');
  $('#notifTest').classList.toggle('hidden', !(notifSupported() && Notification.permission === 'granted'));
}
function installApp() {
  if (isStandalone()) return toast('Ya estás dentro de la app instalada');
  if (!deferredPrompt) {
    $('#iosHint').classList.toggle('hidden', !/iphone|ipad|ipod/i.test(navigator.userAgent));
    return toast('Tu navegador no ofrece instalación automática: usa Compartir → Añadir a pantalla de inicio');
  }
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(r => {
    deferredPrompt = null;
    toast(r.outcome === 'accepted' ? 'App instalada' : 'Instalación cancelada');
    updateAppStatus();
  });
}
function askNotifPerm() {
  if (!notifSupported()) return toast('Este navegador no soporta notificaciones');
  if (Notification.permission === 'granted') return toast('Las notificaciones ya están activas');
  Notification.requestPermission().then(p => {
    updateAppStatus();
    if (p === 'granted') { toast('Notificaciones activas'); systemNotify('Tienda de Mecatos', 'Te avisaré de agotados, stock bajo y deudas aunque uses otra pestaña.', 'welcome'); }
    else if (p === 'denied') toast('Permiso denegado: actívalo en el candado de la barra de direcciones');
  });
}
function systemNotify(title, body, tag) {
  if (!notifSupported() || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'mecatos-' + tag, renotify: false }); } catch (e) {}
}
/* Solo avisa de alertas nuevas (nunca al cargar la página) */
const seenAlerts = new Set();
let alertsBaselined = false;
function alertNotifications() {
  const items = notifItems();
  const keys = items.map(i => i.t);
  if (!alertsBaselined) { keys.forEach(k => seenAlerts.add(k)); alertsBaselined = true; return; }
  for (const it of items) {
    if (it.sev === 'muted' || seenAlerts.has(it.t)) continue;
    seenAlerts.add(it.t);
    systemNotify('Alerta de la tienda', it.t + ' — ' + it.d, it.t);
  }
  for (const k of Array.from(seenAlerts)) if (!keys.includes(k)) seenAlerts.delete(k);
}

/* Diálogo de activación: aparece una vez, y vuelve a ofrecer a los 7 días */
function maybeOfferActivation() {
  if (isStandalone() && (!notifSupported() || Notification.permission !== 'default')) return;
  const last = Number(localStorage.getItem('mecatos.activate') || 0);
  if (last && Date.now() - last < 7 * 86400000) return;
  $('#activateDlg').showModal();
  updateAppStatus();
}
function dismissActivation() {
  localStorage.setItem('mecatos.activate', String(Date.now()));
  $('#activateDlg').close();
}
addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredPrompt = e; updateAppStatus();
  if (!Number(localStorage.getItem('mecatos.activate') || 0)) maybeOfferActivation();
});
addEventListener('appinstalled', () => { deferredPrompt = null; updateAppStatus(); $('#activateDlg').close(); });
function applyTheme() {
  const t = localStorage.getItem('mecatos.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
  const b = $('#themeBtn');
  if (b) b.title = t === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
}
function applyBrand() { $('.brand strong').textContent = db.config.name || 'Mi Tienda de Mecatos'; document.title = db.config.name || 'Mi Tienda de Mecatos'; }
function categories() { return db.categories.map(c => c.name).sort((a, b) => a.localeCompare(b, 'es')); }
function catEmoji(name) { return (db.categories.find(c => c.name === name) || {}).emoji || ''; }

/* ---------- Caja ---------- */
function renderCaja() {
  const cf = $('#catFilter'), cur = cf.value;
  cf.innerHTML = '<option value="">Todas las categorías</option>' + categories().map(c => `<option>${esc(c)}</option>`).join('');
  cf.value = categories().includes(cur) ? cur : '';
  renderGrid(); renderCart();
}
function renderGrid() {
  const q = norm($('#q').value), cat = $('#catFilter').value;
  const list = db.products.filter(p => (!cat || p.cat === cat) && (!q || norm(p.name).includes(q) || (p.code && p.code.includes(q))))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  $('#grid').innerHTML = list.length ? list.map(p => {
    const cls = p.stock <= 0 ? 'out' : (p.stock <= (p.min || 0) ? 'low' : '');
    return `<div class="card ${cls}" data-id="${p.id}"><div class="em">${iconHtml(p.emoji || catEmoji(p.cat) || 'icon:mecato')}</div>
      <div class="nm">${esc(p.name)}</div><div class="pr">${money(p.price)}</div>
      <div class="st">${p.stock <= 0 ? 'Agotado' : 'Stock: ' + p.stock}</div></div>`;
  }).join('') : '<div class="empty">No hay productos. Agrégalos en la pestaña Productos.</div>';
}
async function addToCart(id) {
  const p = prod(id); if (!p) return;
  try {
    await api('/api/reserve', { session: SESSION, product: p.id, qty: 1 }); // se descuenta del stock disponible al instante
    const line = cart.find(l => l.pid === p.id);
    if (line) line.qty++; else cart.push({ pid: p.id, qty: 1 });
    p.stock = Math.max(0, p.stock - 1);
    renderGrid(); renderCart();
  } catch (e) { toast(e.message); refresh(); }
}
async function releaseLine(pid, qty) {
  try { await api('/api/release', { session: SESSION, product: pid, qty }); } catch (e) { toast(e.message); }
  const p = prod(pid); if (p) p.stock += qty;
  renderGrid();
}
const cartTotal = () => cart.reduce((s, l) => s + (prod(l.pid)?.price || 0) * l.qty, 0);
function renderCart() {
  $('#cartItems').innerHTML = cart.length ? cart.map(l => {
    const p = prod(l.pid); if (!p) return '';
    return `<div class="line"><div class="l-name">${esc(p.name)}<br><small>${money(p.price)} c/u</small></div>
      <div class="l-sub">${money(p.price * l.qty)}</div>
      <div class="qty"><button data-a="dec" data-id="${l.pid}">−</button><span>${l.qty}</span><button data-a="inc" data-id="${l.pid}">+</button>
      <button class="btn sm" data-a="del" data-id="${l.pid}" title="Quitar del carrito">Quitar</button></div></div>`;
  }).join('') : '<div class="empty">Toca un producto para agregarlo</div>';
  $('#cartTotal').textContent = money(cartTotal());
  $('#cartMini').textContent = money(cartTotal());
  $('#cartCount').textContent = cart.reduce((s, l) => s + l.qty, 0);
  updateChange();
}
function updateChange() {
  const m = $('#payMethod').value, total = cartTotal();
  $('#fiadoRow').classList.toggle('hidden', m !== 'fiado');
  $('#cashIn').classList.toggle('hidden', m !== 'efectivo');
  const rec = Number($('#cashIn').value) || 0;
  $('#changeLbl').textContent = m === 'efectivo' ? 'Cambio' : (m === 'fiado' ? 'Quedará debiendo' : 'Pago exacto');
  $('#changeVal').textContent = m === 'efectivo' ? money(Math.max(0, rec - total)) : money(total);
}
async function checkout() {
  if (!cart.length) return toast('El carrito está vacío');
  const method = $('#payMethod').value, total = cartTotal();
  let client = '', received = 0;
  if (method === 'efectivo') {
    received = Number($('#cashIn').value) || total;
    if (received < total) return toast('El dinero recibido es menor al total');
  }
  if (method === 'fiado') {
    client = $('#fiadoName').value.trim();
    if (!client) return toast('Escribe el nombre del cliente');
  }
  for (const l of cart) { const p = prod(l.pid); if (!p) return toast('Producto no disponible: ' + l.pid); }
  try {
    const items = cart.map(l => ({ product: l.pid, qty: l.qty }));
    await api('/api/sale', { items, method, client, received, session: SESSION }); // consume las reservas: el stock ya se descontó al agregar
    const change = method === 'efectivo' ? received - total : 0;
    cart = []; $('#cashIn').value = ''; $('#fiadoName').value = '';
    $('#cart').classList.remove('open'); $('#cartArrow').textContent = 'Abrir';
    toast(change > 0 ? `Venta lista. Cambio: ${money(change)}` : 'Venta registrada');
    await refresh();
  } catch (e) { toast(e.message); refresh(); }
}

/* ---------- Productos ---------- */
function renderProductos() {
  const q = norm($('#pq').value);
  const list = db.products.filter(p => !q || norm(p.name).includes(q) || norm(p.cat).includes(q) || (p.code || '').includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  $('#prodTable tbody').innerHTML = list.map(p => {
    const low = p.stock <= (p.min || 0);
    return `<tr><td>${iconHtml(p.emoji || catEmoji(p.cat))} ${esc(p.name)}</td><td>${iconPrefix(catEmoji(p.cat))}${esc(p.cat)}</td><td>${esc(p.code)}</td>
      <td class="num">${money(p.price)}</td>
      <td class="num"><span class="badge ${low ? 'bad' : ''}">${p.stock}</span></td>
      <td class="act"><button class="btn sm" data-restock="${p.id}">Reabastecer</button><button class="btn sm" data-edit="${p.id}">Editar</button></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty">Sin productos</td></tr>';
}
let lastCat = '';
function fillCatSelect(sel) {
  const s = $('#prodForm').elements.cat;
  s.innerHTML = '<option value="">— Elige una categoría —</option>' +
    categories().map(c => `<option value="${esc(c)}">${iconPrefix(catEmoji(c))}${esc(c)}</option>`).join('');
  s.value = categories().includes(sel) ? sel : '';
}

/* ---------- Selector de íconos SVG ---------- */
let iconTarget = null;
async function openIcons(input) {
  iconTarget = input;
  let names = [];
  try { names = await api('/api/icons', null, 'GET'); } catch (e) { toast('No se pudieron cargar los íconos'); return; }
  $('#iconGrid').innerHTML = (names.length ? names.map(n =>
    `<button type="button" data-icon="${esc(n)}" title="${esc(n)}"><img src="assets/icons/${encodeURIComponent(n)}.svg" alt=""></button>`).join('')
    : '<div class="empty">Suelta tus .svg en la carpeta <code>assets/icons</code> y recarga.</div>')
    + '<button type="button" data-icon="">Sin ícono</button>';
  $('#iconDlg').showModal();
}
$('#iconGrid').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !iconTarget) return;
  iconTarget.value = b.dataset.icon ? 'icon:' + b.dataset.icon : '';
  $('#iconDlg').close();
});
function openProd(id) {
  const f = $('#prodForm'), p = id ? prod(id) : null;
  f.reset(); f.dataset.id = id || '';
  $('#prodTitle').textContent = p ? 'Editar producto' : 'Nuevo producto';
  $('#delProd').classList.toggle('hidden', !p);
  fillCatSelect(p ? p.cat : lastCat);
  if (p) {
    for (const k of ['name', 'price', 'cost', 'stock', 'min', 'code', 'emoji']) f.elements[k].value = p[k] ?? '';
  } else f.elements.min.value = db.config.defMin ?? 5;
  $('#prodDlg').showModal();
  if (!categories().length) { toast('Primero crea una categoría'); openCats(); }
}
async function saveProd(e) {
  e.preventDefault();
  const f = e.target, id = f.dataset.id;
  const data = {
    id: id || undefined,
    name: f.elements.name.value.trim(), cat: f.elements.cat.value,
    price: Number(f.elements.price.value) || 0, cost: Number(f.elements.cost.value) || 0,
    stock: Math.max(0, Number(f.elements.stock.value) || 0), min: Number(f.elements.min.value) || 0,
    code: f.elements.code.value.trim(), emoji: f.elements.emoji.value.trim(),
  };
  if (!data.name) return;
  if (!data.cat) return toast('Elige o crea una categoría');
  lastCat = data.cat;
  try {
    await api('/api/product', data);
    $('#prodDlg').close();
    await refresh(); toast('Producto guardado');
  } catch (err) { toast(err.message); }
}

/* ---------- Reabastecer ---------- */
let restockPid = null;
async function openRestock(id) {
  restockPid = Number(id);
  const p = prod(restockPid); if (!p) return;
  $('#stockTitle').textContent = `Reabastecer: ${p.name}`;
  $('#stockNow').textContent = `Stock actual: ${p.stock}`;
  $('#stockForm').reset();
  $('#stockDlg').showModal();
  try {
    const moves = await api(`/api/moves?product=${restockPid}`, null, 'GET');
    $('#stockMoves').innerHTML = moves.length ? moves.map(m =>
      `<div class="rowitem"><span>${new Date(m.ts).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })} · ${esc(m.note || '')}</span><b class="${m.qty >= 0 ? 'up' : 'down'}">${m.qty > 0 ? '+' : ''}${m.qty}</b></div>`).join('')
      : '<div class="empty">Sin movimientos aún</div>';
  } catch (e) { $('#stockMoves').innerHTML = '<div class="empty">No se pudo cargar el historial</div>'; }
}
async function saveRestock(e) {
  e.preventDefault();
  const qty = Math.round(Number(e.target.elements.qty.value) || 0);
  if (!qty) return toast('Indica una cantidad (negativo para merma/salida)');
  try {
    await api('/api/restock', { product: restockPid, qty, note: e.target.elements.note.value.trim() });
    $('#stockDlg').close();
    await refresh(); toast(qty > 0 ? 'Entrada de mercancía registrada' : 'Salida registrada');
  } catch (err) { toast(err.message); }
}

/* ---------- Categorías ---------- */
function openCats() { renderCats(); $('#catForm').reset(); $('#catDlg').showModal(); }
function renderCats() {
  const n = c => db.products.filter(p => p.cat === c.name).length;
  $('#catList2').innerHTML = db.categories.slice().sort((a, b) => a.name.localeCompare(b.name, 'es')).map(c =>
    `<div class="rowitem"><span>${iconHtml(c.emoji || 'icon:mecato')} ${esc(c.name)} <small>(${n(c)})</small></span>
     <span class="act"><button class="btn sm" data-cemo="${esc(c.name)}">Ícono</button>
     <button class="btn sm" data-cedit="${esc(c.name)}">Renombrar</button>
     <button class="btn sm danger-o" data-cdel="${esc(c.name)}">Eliminar</button></span></div>`).join('')
    || '<div class="empty">Aún no tienes categorías. Crea la primera arriba.</div>';
}
async function addCat(e) {
  e.preventDefault();
  const name = e.target.elements.name.value.trim(), emoji = e.target.elements.emoji.value.trim();
  if (!name) return;
  try {
    await api('/api/category', { name, emoji });
    e.target.reset();
    await refresh(); renderCats();
    if ($('#prodDlg').open) fillCatSelect(name);
    toast('Categoría creada');
  } catch (err) { toast(err.message); }
}
async function catAction(e) {
  const b = e.target.closest('button'); if (!b) return;
  const name = b.dataset.cedit || b.dataset.cdel || b.dataset.cemo;
  const c = db.categories.find(x => x.name === name); if (!c) return;
  try {
    if (b.dataset.cemo) {
      const v = prompt('Ícono o emoji para "' + c.name + '" (ej: icon:papas o 🍬)', c.emoji || ''); if (v === null) return;
      await api('/api/category/update', { old: c.name, emoji: v.trim().slice(0, 40) });
    } else if (b.dataset.cedit) {
      const v = (prompt('Nuevo nombre', c.name) || '').trim(); if (!v || v === c.name) return;
      await api('/api/category/update', { old: c.name, name: v });
      if (lastCat === c.name) lastCat = v;
    } else {
      const used = db.products.filter(p => p.cat === c.name).length;
      if (used && c.name === 'General') return toast('Mueve primero esos productos a otra categoría');
      if (!confirm(used ? `Hay ${used} producto(s) en "${c.name}". Pasarán a "General". ¿Eliminar la categoría?` : `¿Eliminar "${c.name}"?`)) return;
      await api('/api/category/delete', { name: c.name });
      if (lastCat === c.name) lastCat = '';
    }
    await refresh(); renderCats(); renderProductos();
    if ($('#prodDlg').open) fillCatSelect($('#prodForm').elements.cat.value);
  } catch (err) { toast(err.message); }
}

/* ---------- Fiado ---------- */
const balance = c => c.charges.reduce((s, x) => s + x.amount, 0) - c.payments.reduce((s, x) => s + x.amount, 0);
let payingClient = null;
function renderFiado() {
  const list = Object.values(db.clients).map(c => ({ c, bal: balance(c) })).filter(x => x.bal > 0).sort((a, b) => b.bal - a.bal);
  const total = list.reduce((s, x) => s + x.bal, 0);
  $('#fiadoList').innerHTML = `<div class="cards"><div class="stat"><small>Total por cobrar</small><b>${money(total)}</b></div>
    <div class="stat"><small>Clientes con deuda</small><b>${list.length}</b></div></div>` +
    (list.length ? list.map(({ c, bal }) => `<div class="debtor"><header><div><strong>${esc(c.name)}</strong><br><span class="badge bad">Debe ${money(bal)}</span></div>
      <button class="btn primary" data-pay="${esc(c.name)}">Registrar abono</button></header>
      <ul>${[...c.charges.map(x => ({ ts: x.ts, t: 'Fiado', a: x.amount })), ...c.payments.map(x => ({ ts: x.ts, t: 'Abono', a: -x.amount }))]
        .sort((a, b) => b.ts - a.ts).slice(0, 8).map(x => `<li>${new Date(x.ts).toLocaleDateString('es-CO')} — ${x.t} ${money(Math.abs(x.a))}</li>`).join('')}</ul></div>`).join('')
      : '<div class="empty">No hay deudas pendientes</div>');
}
function openPay(name) { payingClient = name; $('#payTitle').textContent = 'Abono de ' + name; $('#payForm').reset(); $('#payDlg').showModal(); }
async function savePay(e) {
  e.preventDefault();
  const c = db.clients[payingClient]; if (!c) return;
  const amount = Math.min(Number(e.target.elements.amount.value) || 0, balance(c));
  if (amount <= 0) return;
  try {
    await api('/api/payment', { client: payingClient, amount });
    $('#payDlg').close();
    await refresh(); toast('Abono registrado');
  } catch (err) { toast(err.message); }
}

/* ---------- Reportes ---------- */
function presetDates() {
  const r = $('#repRange').value, nowD = new Date();
  const dstr = d => d.toISOString().slice(0, 10);
  if (r === 'todo') { $('#repFrom').value = ''; $('#repTo').value = ''; }
  else if (r === 'hoy') { $('#repFrom').value = dstr(nowD); $('#repTo').value = dstr(nowD); }
  else {
    const from = new Date(nowD.getTime() - Number(r) * 86400000);
    $('#repFrom').value = dstr(from); $('#repTo').value = dstr(nowD);
  }
}
function rangeFromTo() {
  const f = $('#repFrom').value, t = $('#repTo').value;
  const from = f ? new Date(f + 'T00:00:00').getTime() : 0;
  const to = t ? new Date(t + 'T23:59:59.999').getTime() : Date.now();
  return { from, to };
}
let lastSales = [];
async function renderReportes() {
  try {
    const { from, to } = rangeFromTo();
    const sales = await api(`/api/sales?from=${from}&to=${to}`, null, 'GET');
    lastSales = sales;
    const tot = sales.reduce((s, x) => s + x.total, 0);
    const by = m => sales.filter(s => s.method === m).reduce((s, x) => s + x.total, 0);
    const profit = sales.reduce((s, x) => s + x.items.reduce((a, i) => a + (i.price - (i.cost || 0)) * i.qty, 0), 0);
    $('#repCards').innerHTML = [['Ventas', money(tot)], ['# de ventas', sales.length], ['Efectivo', money(by('efectivo'))],
      ['Transferencia', money(by('transferencia'))], ['Fiado', money(by('fiado'))], ['Ganancia estimada', money(profit)]]
      .map(([a, b]) => `<div class="stat"><small>${a}</small><b>${b}</b></div>`).join('');
    const top = {};
    sales.forEach(s => s.items.forEach(i => { top[i.name] = (top[i.name] || 0) + i.qty; }));
    $('#repTop').innerHTML = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([n, q]) => `<div class="rowitem"><span>${esc(n)}</span><b>${q}</b></div>`).join('') || '<div class="empty">Sin ventas</div>';
    $('#repLow').innerHTML = db.products.filter(p => p.stock <= (p.min || 0)).sort((a, b) => a.stock - b.stock).slice(0, 10)
      .map(p => `<div class="rowitem"><span>${esc(p.name)}</span><b>${p.stock}</b></div>`).join('') || '<div class="empty">Todo bien de stock</div>';
    renderChart(sales);
    $('#salesTable tbody').innerHTML = sales.slice(0, 80).map(s =>
      `<tr><td>${new Date(s.ts).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</td>
       <td>${esc(s.items.map(i => i.qty + '× ' + i.name).join(', ')).slice(0, 80)}</td>
       <td>${esc(s.method)}${s.client ? ' · ' + esc(s.client) : ''}</td><td class="num">${money(s.total)}</td>
       <td class="act"><button class="btn sm danger-o" data-void="${s.id}" title="Anular venta (devuelve el stock)">Anular</button></td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">Sin ventas en este rango de fechas</td></tr>';
  } catch (e) { toast(e.message); }
}
function renderChart(sales) {
  const byDay = {};
  for (const s of sales) {
    const d = new Date(s.ts); const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    byDay[key] = (byDay[key] || 0) + s.total;
  }
  const keys = Object.keys(byDay).sort((a, b) => {
    const [am, ad] = a.split('/').map(Number), [bm, bd] = b.split('/').map(Number);
    return am - bm || ad - bd;
  });
  if (!keys.length) { $('#repChart').innerHTML = '<div class="empty">Sin ventas para graficar</div>'; return; }
  const max = Math.max(...keys.map(k => byDay[k]), 1);
  $('#repChart').innerHTML = '<div class="chart">' + keys.slice(-31).map(k => {
    const v = byDay[k];
    return `<div class="bar" title="${k}: ${money(v)}"><div class="fill" style="height:${Math.max(3, Math.round(v / max * 100))}%"></div><span>${k.split('/')[1]}</span></div>`;
  }).join('') + '</div>';
}
async function voidSale(id) {
  if (!confirm('¿Anular esta venta? Se devolverá el stock al inventario.')) return;
  try {
    await api('/api/sale/void', { id: Number(id) });
    await refresh(); toast('Venta anulada');
  } catch (e) { toast(e.message); }
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportCsv() {
  const q = v => '"' + String(v).replace(/"/g, '""') + '"';
  const rows = [['Fecha', 'Producto', 'Cantidad', 'Precio', 'Subtotal', 'Pago', 'Cliente']];
  lastSales.forEach(s => s.items.forEach(i => rows.push([new Date(s.ts).toLocaleString('es-CO'), i.name, i.qty, i.price, i.qty * i.price, s.method, s.client])));
  download('ventas.csv', '\ufeff' + rows.map(r => r.map(q).join(',')).join('\n'), 'text/csv');
}

/* ---------- Ajustes ---------- */
function renderAjustes() {
  updateAppStatus();
  $('#storeName').value = db.config.name || '';
  $('#defMin').value = db.config.defMin ?? 5;
  if (MODE === 'local') {
    $('#accessInfo').innerHTML = `<p><b>Estás en modo local</b> (página publicada o servidor de la tienda apagado): los datos se guardan en el almacenamiento de <u>este</u> navegador y no se comparten con los demás equipos.</p>
      <p>Para tener la misma información en todos los dispositivos, ejecuta la versión con base SQLite en la PC de la tienda (<code>node server.js</code>) y abre esa dirección. Puedes traer tus datos de aquí con <b>Descargar copia</b> y <b>Restaurar copia</b> en el otro modo.</p>`;
    return;
  }
  api('/api/info', null, 'GET').then(i => {
    $('#accessInfo').innerHTML = `<p>Base de datos compartida: <code>datos/tienda.db</code></p>
      <p>Para vender desde el celular u otro PC (misma WiFi), abre:</p>
      <ul class="urls">${i.ips.map(ip => `<li><a href="http://${ip}:${i.port}" target="_blank">http://${ip}:${i.port}</a></li>`).join('') || '<li>Solo este equipo (no se detectó red)</li>'}</ul>`;
  }).catch(() => { $('#accessInfo').innerHTML = '<p class="empty">No se pudo leer la información del servidor.</p>'; });
}
function importJson(file) {
  const r = new FileReader();
  r.onload = async () => {
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d.products) || !Array.isArray(d.sales)) throw 0;
      if (!confirm('Esto reemplazará TODOS los datos del servidor con la copia. ¿Continuar?')) return;
      await api('/api/import', { ...d, confirm: true });
      await refresh(); toast('Copia restaurada en la base SQLite');
    } catch (e) { toast(e instanceof TypeError || e.message === '0' ? 'Archivo no válido' : e.message); }
  };
  r.readAsText(file);
}

/* ---------- Eventos ---------- */
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.view) show(b.dataset.view); });
$('#notifBtn').addEventListener('click', e => {
  e.stopPropagation();
  $('#notifPop').classList.contains('open') ? closeNotif() : openNotif();
});
$('#notifList').addEventListener('click', e => {
  const b = e.target.closest('[data-n]'); if (!b) return;
  const it = notifActions[Number(b.dataset.n)];
  closeNotif();
  if (it) it.act();
});
$('#notifClear').addEventListener('click', e => { e.stopPropagation(); closeNotif(); });
document.addEventListener('click', e => { if (!e.target.closest('#notifPop')) closeNotif(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNotif(); });
addEventListener('resize', () => { if ($('#notifPop').classList.contains('open')) placeNotifPop(); });
addEventListener('scroll', () => { if ($('#notifPop').classList.contains('open')) placeNotifPop(); }, true);
$('#q').addEventListener('input', renderGrid);
$('#q').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const v = e.target.value.trim(); if (!v) return;
  const exact = db.products.find(p => p.code && p.code === v);
  const found = exact || (renderGrid(), $$('#grid .card').length === 1 ? prod($('#grid .card').dataset.id) : null);
  if (found) { addToCart(found.id); e.target.value = ''; renderGrid(); }
});
$('#catFilter').addEventListener('change', renderGrid);
$('#grid').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) addToCart(c.dataset.id); });
$('#cartItems').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const l = cart.find(x => x.pid === Number(b.dataset.id)); if (!l) return;
  if (b.dataset.a === 'inc') addToCart(l.pid);
  else if (b.dataset.a === 'dec' && l.qty > 1) { l.qty--; renderCart(); await releaseLine(l.pid, 1); }
  else { cart = cart.filter(x => x !== l); renderCart(); await releaseLine(l.pid, l.qty); }
});
$('#payMethod').addEventListener('change', updateChange);
$('#cashIn').addEventListener('input', updateChange);
$('#clearCart').addEventListener('click', async () => {
  cart = []; renderCart();
  try { await api('/api/release', { session: SESSION, all: true }); await refresh(); } catch (e) { toast(e.message); }
});
$('#payBtn').addEventListener('click', checkout);
$('#fiadoName').addEventListener('focus', () => { $('#clientesList').innerHTML = Object.keys(db.clients).map(n => `<option value="${esc(n)}">`).join(''); });

$('#pq').addEventListener('input', renderProductos);
$('#newProd').addEventListener('click', () => openProd());
$('#prodTable').addEventListener('click', e => {
  const ed = e.target.closest('[data-edit]'); if (ed) return openProd(Number(ed.dataset.edit));
  const rs = e.target.closest('[data-restock]'); if (rs) openRestock(rs.dataset.restock);
});
$('#prodForm').addEventListener('submit', saveProd);
$('#cancelProd').addEventListener('click', () => $('#prodDlg').close());
$('#pickProdIcon').addEventListener('click', () => openIcons($('#prodForm').elements.emoji));
$('#pickCatIcon').addEventListener('click', () => openIcons($('#catForm').elements.emoji));
$('#closeIcon').addEventListener('click', () => $('#iconDlg').close());
$('#installBtn').addEventListener('click', installApp);
$('#installBtn2').addEventListener('click', installApp);
$('#notifPermBtn').addEventListener('click', askNotifPerm);
$('#notifBtn2').addEventListener('click', askNotifPerm);
$('#notifTest').addEventListener('click', () => systemNotify('Prueba de alerta', 'Así se verán los avisos de agotados, stock bajo y deudas.', 'test'));
$('#skipActivate').addEventListener('click', dismissActivation);
$('#activateDlg').addEventListener('cancel', dismissActivation);
$('#delProd').addEventListener('click', async () => {
  const id = $('#prodForm').dataset.id;
  if (id && confirm('¿Eliminar este producto?')) {
    try {
      await api('/api/product/delete', { id: Number(id) });
      cart = cart.filter(l => l.pid !== Number(id));
      $('#prodDlg').close();
      await refresh(); toast('Producto eliminado');
    } catch (e) { toast(e.message); }
  }
});
$('#stockForm').addEventListener('submit', saveRestock);
$('#cancelStock').addEventListener('click', () => $('#stockDlg').close());

$('#cartHandle').addEventListener('click', () => {
  const open = $('#cart').classList.toggle('open'); $('#cartArrow').textContent = open ? 'Cerrar' : 'Abrir';
});
$('#catMgr').addEventListener('click', openCats);
$('#newCatBtn').addEventListener('click', openCats);
$('#catForm').addEventListener('submit', addCat);
$('#catList2').addEventListener('click', catAction);
$('#closeCat').addEventListener('click', () => $('#catDlg').close());

$('#fiadoList').addEventListener('click', e => { const b = e.target.closest('[data-pay]'); if (b) openPay(b.dataset.pay); });
$('#payForm').addEventListener('submit', savePay);
$('#cancelPay').addEventListener('click', () => $('#payDlg').close());

$('#repRange').addEventListener('change', () => { presetDates(); renderReportes(); });
$('#repFrom').addEventListener('change', () => { $('#repRange').value = ''; renderReportes(); });
$('#repTo').addEventListener('change', () => { $('#repRange').value = ''; renderReportes(); });
$('#expCsv').addEventListener('click', exportCsv);
$('#salesTable').addEventListener('click', e => { const b = e.target.closest('[data-void]'); if (b) voidSale(b.dataset.void); });

$('#expJson').addEventListener('click', async () => {
  try {
    const d = await api('/api/export', null, 'GET');
    download('copia-tienda-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(d), 'application/json');
  } catch (e) { toast(e.message); }
});
$('#impJson').addEventListener('change', e => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; });
$('#saveCfg').addEventListener('click', async () => {
  try {
    await api('/api/config', { name: $('#storeName').value.trim(), defMin: Number($('#defMin').value) || 0 });
    await refresh(); toast('Guardado');
  } catch (e) { toast(e.message); }
});
$('#resetAll').addEventListener('click', async () => {
  if (confirm('¿Borrar TODOS los datos de la base SQLite? Esta acción no se puede deshacer.') && confirm('¿Seguro? Descarga una copia antes si dudas.')) {
    try {
      await api('/api/reset', { confirm: true });
      cart = [];
      await refresh(); show('caja'); toast('Datos reiniciados');
    } catch (e) { toast(e.message); }
  }
});
$('#themeBtn').addEventListener('click', () => {  localStorage.setItem('mecatos.theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  applyTheme();
});

function net() {
  const dot = $('#netdot'), txt = $('#nettxt');
  if (MODE === 'local') {
    dot.classList.remove('off'); dot.classList.add('local');
    txt.textContent = 'Modo local · datos en este dispositivo';
    return;
  }
  dot.classList.remove('local');
  const on = serverOk && navigator.onLine;
  dot.classList.toggle('off', !on);
  txt.textContent = on ? 'En línea · datos compartidos' : 'Sin conexión con el servidor (enciende la PC con la tienda)';
}
addEventListener('online', net); addEventListener('offline', net);

/* ---------- Inicio ---------- */
applyTheme(); presetDates();
detectMode().then(refresh).then(async () => {
  applyBrand(); net(); show('caja');
  if (MODE === 'local') toast('Sin servidor de tienda a la vista: funcionas en modo local, con datos solo en este dispositivo');
  try { // recupera el carrito (reservas) tras recargar la pestaña
    const res = await api(`/api/reservations?session=${SESSION}`, null, 'GET');
    cart = res.filter(r => prod(r.pid)).map(r => ({ pid: Number(r.pid), qty: Number(r.qty) }));
    renderCart();
  } catch (e) {}
  connectEvents();
  setTimeout(maybeOfferActivation, 1400); // deja tiempo a beforeinstallprompt de llegar
});
/* Latido: mantiene vivas mis reservas mientras la caja esté abierta; si la cierras, el servidor devuelve el stock a los ~15 min */
setInterval(() => { if (cart.length) api('/api/reserve-touch', { session: SESSION }).catch(() => {}); }, 180000);
connectEvents();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
