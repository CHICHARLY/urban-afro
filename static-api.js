/* Adaptador estático: ofrece la MISMA API que server.js, pero guardando los datos
   en este navegador (localStorage). Se activa solo cuando no hay servidor SQLite
   accesible, por ejemplo en GitHub Pages. Los datos NO se comparten entre dispositivos. */
(() => {
'use strict';

const KEY = 'mecatos.static.db';
const now = () => Date.now();
const STALE = 15 * 60 * 1000; // reservas abandonadas: 15 min
const ICONS = ['agua', 'bonbon', 'caramelo', 'chocolate', 'galletas', 'gaseosa', 'gelatina', 'jugo', 'mecato', 'papas', 'popcorn', 'saltin'];
const byName = (a, b) => a.name.localeCompare(b.name, 'es');
const err = m => { const e = new Error(m); e.apiError = true; return e; };
const nextId = arr => arr.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;

function seed() {
  const em = { Papas: 'icon:papas', Dulces: 'icon:caramelo', Bebidas: 'icon:gaseosa', Galletas: 'icon:galletas' };
  const cats = ['Papas', 'Dulces', 'Bebidas', 'Galletas'].map(name => ({ name, emoji: em[name] || '' }));
  const rows = [
    ['Papas Margarita pollo', 'Papas', 2500, 'icon:papas'], ['Papas Margarita limón', 'Papas', 2500, 'icon:papas'],
    ['Detodito', 'Papas', 3000, 'icon:popcorn'], ['Chocorramo', 'Dulces', 2800, 'icon:chocolate'],
    ['Chocolatina Jet', 'Dulces', 1200, 'icon:chocolate'], ['Bom Bom Bum', 'Dulces', 500, 'icon:bonbon'],
    ['Gelatina', 'Dulces', 1000, 'icon:gelatina'], ['Gaseosa 400 ml', 'Bebidas', 2500, 'icon:gaseosa'],
    ['Jugo Hit', 'Bebidas', 2200, 'icon:jugo'], ['Agua botella', 'Bebidas', 1800, 'icon:agua'],
    ['Galletas Festival', 'Galletas', 1500, 'icon:galletas'], ['Galletas Saltin', 'Galletas', 1300, 'icon:saltin'],
  ];
  return {
    config: { name: 'Mi Tienda de Mecatos', defMin: 5 },
    categories: cats,
    products: rows.map(([name, cat, price, emoji], i) => ({ id: i + 1, name, cat, price, cost: 0, stock: 20, min: 5, code: '', emoji })),
    sales: [], debts: [], payments: [], moves: [], reservations: [],
  };
}

let db = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const d = JSON.parse(raw); if (Array.isArray(d.products)) return d; }
  } catch (e) {}
  const d = seed();
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
  return d;
})();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { throw err('Este navegador ya no tiene espacio para guardar más datos'); }
}
/* Otra pestaña del mismo navegador pudo escribir: siempre se lee la última versión */
function reload() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const d = JSON.parse(raw); if (Array.isArray(d.products)) db = d; } } catch (e) {}
}
const product = id => db.products.find(p => p.id === Number(id));
const getRes = (session, pid) => db.reservations.find(r => r.session === session && r.product === Number(pid));

/* Devuelve al inventario las reservas de cajas abandonadas */
function cleanStale() {
  const cut = now() - STALE;
  const keep = [];
  let changed = false;
  for (const r of db.reservations) {
    if (r.ts < cut) { const p = product(r.product); if (p) p.stock += r.qty; changed = true; }
    else keep.push(r);
  }
  if (changed) { db.reservations = keep; save(); }
  return changed;
}

function clientsMap() {
  const names = new Set([...db.debts.map(d => d.client), ...db.payments.map(p => p.client)]);
  const out = {};
  for (const n of names) out[n] = {
    name: n,
    charges: db.debts.filter(d => d.client === n).map(d => ({ ts: d.ts, saleId: d.sale, amount: d.amount })),
    payments: db.payments.filter(p => p.client === n).map(p => ({ ts: p.ts, amount: p.amount })),
  };
  return out;
}
const debtOf = n => clientsMap()[n] ? clientsMap()[n].charges.reduce((s, x) => s + x.amount, 0) - clientsMap()[n].payments.reduce((s, x) => s + x.amount, 0) : 0;

function fullData() {
  cleanStale();
  return {
    config: { name: db.config.name, defMin: db.config.defMin, theme: '' },
    categories: db.categories.slice().sort(byName).map(c => ({ name: c.name, emoji: c.emoji })),
    products: db.products.slice().sort(byName).map(p => Object.assign({}, p)),
    clients: clientsMap(),
    reservations: db.reservations.reduce((s, r) => s + r.qty, 0),
    static: true,
  };
}
function salesInRange(from, to) {
  cleanStale();
  return db.sales.filter(s => s.ts >= from && s.ts <= to).sort((a, b) => b.ts - a.ts)
    .map(s => ({ id: s.id, ts: s.ts, total: s.total, method: s.method, client: s.client, received: s.received, items: s.items.map(i => Object.assign({}, i)) }));
}
function addMove(pid, qty, note) { db.moves.push({ id: nextId(db.moves), product: Number(pid), qty, ts: now(), note }); }

/* ---------- El manejador: mismas rutas y mismos errores que server.js ---------- */
function handle(method, path, body) {
  reload();
  const [pathname, qs = ''] = path.split('?');
  const q = new URLSearchParams(qs);
  const b = body || {};
  const M = method || (body ? 'POST' : 'GET');

  if (M === 'GET') {
    if (pathname === '/api/data') return fullData();
    if (pathname === '/api/sales') return salesInRange(Number(q.get('from') || 0), Number(q.get('to') || now()));
    if (pathname === '/api/icons') return ICONS.slice();
    if (pathname === '/api/reservations') {
      cleanStale();
      const s = String(q.get('session') || '');
      return db.reservations.filter(r => r.session === s).map(r => ({ pid: r.product, qty: r.qty }));
    }
    if (pathname === '/api/moves') {
      const pid = Number(q.get('product') || 0);
      return db.moves.filter(m => m.product === pid).sort((a, b2) => b2.ts - a.ts).slice(0, 50)
        .map(m => Object.assign({}, m, { name: (product(m.product) || {}).name || '' }));
    }
    if (pathname === '/api/info') return { ips: [], port: 0, static: true };
    if (pathname === '/api/export') {
      const d = fullData();
      d.sales = db.sales.slice().sort((a, b2) => a.ts - b2.ts).map(s => Object.assign({}, s));
      return d;
    }
    throw err('Ruta no encontrada: ' + pathname);
  }

  if (pathname === '/api/reserve') {
    const session = String(b.session || ''), pid = Number(b.product), qty = Math.max(1, Math.floor(Number(b.qty) || 1));
    if (!session) throw err('Sesión de caja requerida');
    const p = product(pid); if (!p) throw err('Producto no encontrado');
    if (p.stock < qty) throw err(`Sin stock disponible de ${p.name} (quedan ${p.stock})`);
    p.stock -= qty;
    const r = getRes(session, pid);
    if (r) { r.qty += qty; r.ts = now(); } else db.reservations.push({ session, product: p.id, qty, ts: now() });
    save();
    return { ok: true, stock: p.stock };
  }

  if (pathname === '/api/reserve-touch') {
    const session = String(b.session || '');
    for (const r of db.reservations) if (r.session === session) r.ts = now();
    save();
    return { ok: true };
  }

  if (pathname === '/api/release') {
    const session = String(b.session || '');
    if (!session) throw err('Sesión de caja requerida');
    if (b.all) {
      for (const r of db.reservations.filter(x => x.session === session)) { const p = product(r.product); if (p) p.stock += r.qty; }
      db.reservations = db.reservations.filter(x => x.session !== session);
    } else {
      const pid = Number(b.product), qty = Math.max(1, Math.floor(Number(b.qty) || 1));
      const r = getRes(session, pid);
      if (r) {
        const back = Math.min(qty, r.qty);
        const p = product(pid); if (p) p.stock += back;
        if (r.qty - back <= 0) db.reservations = db.reservations.filter(x => x !== r);
        else { r.qty -= back; r.ts = now(); }
      }
    }
    save();
    return { ok: true };
  }

  if (pathname === '/api/sale') {
    const items = b.items, session = String(b.session || '');
    if (!Array.isArray(items) || !items.length) throw err('Carrito vacío');
    const method = b.method, client = String(b.client || '').trim(), received = Number(b.received) || 0;
    if (!['efectivo', 'transferencia', 'fiado'].includes(method)) throw err('Método de pago inválido');
    if (method === 'fiado' && !client) throw err('Nombre de cliente requerido para fiado');
    cleanStale();
    let total = 0;
    const lines = [];
    for (const i of items) {
      const p = product(i.product); if (!p) throw err('Producto no encontrado: ' + i.product);
      const qty = Math.max(1, Math.floor(Number(i.qty) || 0));
      const r = session ? getRes(session, p.id) : null;
      const rQty = r ? r.qty : 0;
      if (rQty + p.stock < qty) throw err(`Stock insuficiente de ${p.name} (quedan ${rQty + p.stock})`);
      const fromRes = Math.min(qty, rQty), fromFree = qty - fromRes;
      p.stock -= fromFree;
      if (r) { if (r.qty - fromRes <= 0) db.reservations = db.reservations.filter(x => x !== r); else r.qty -= fromRes; }
      addMove(p.id, -qty, 'venta');
      total += p.price * qty;
      lines.push({ pid: p.id, name: p.name, qty, price: p.price, cost: p.cost || 0 });
    }
    if (method === 'efectivo' && received < total) throw err('El dinero recibido es menor al total');
    const sale = { id: nextId(db.sales), ts: now(), total, method, client, received, items: lines };
    db.sales.push(sale);
    if (method === 'fiado') db.debts.push({ client, sale: sale.id, amount: total, ts: now() });
    save();
    return { ok: true, id: sale.id, total };
  }

  if (pathname === '/api/sale/void') {
    const id = Number(b.id);
    const s = db.sales.find(x => x.id === id); if (!s) throw err('Venta no encontrada');
    for (const i of s.items) { const p = product(i.pid); if (p) p.stock += i.qty; addMove(i.pid, i.qty, 'anulación venta #' + id); }
    db.sales = db.sales.filter(x => x !== s);
    db.debts = db.debts.filter(d => d.sale !== id);
    save();
    return { ok: true };
  }

  if (pathname === '/api/product') {
    const name = String(b.name || '').trim(), cat = String(b.cat || '').trim();
    if (!name || !cat) throw err('Nombre y categoría son obligatorios');
    if (!db.categories.some(c => c.name === cat)) throw err('La categoría no existe');
    const data = {
      name, cat, price: Math.max(0, Number(b.price) || 0), cost: Math.max(0, Number(b.cost) || 0),
      stock: Math.max(0, Math.floor(Number(b.stock) || 0)), min: Math.max(0, Math.floor(Number(b.min) || 0)),
      code: String(b.code || '').trim(), emoji: String(b.emoji || '').trim().slice(0, 40),
    };
    const id = b.id ? Number(b.id) : null;
    if (data.code && db.products.some(x => x.code === data.code && x.id !== id)) throw err('Ese código ya existe en otro producto');
    if (id) {
      const p = product(id); if (!p) throw err('Producto no encontrado');
      if (data.stock !== p.stock) addMove(id, data.stock - p.stock, 'ajuste manual');
      Object.assign(p, data);
    } else {
      const nuevo = Object.assign({ id: nextId(db.products) }, data);
      db.products.push(nuevo);
      if (nuevo.stock > 0) addMove(nuevo.id, nuevo.stock, 'inventario inicial');
    }
    save();
    return { ok: true };
  }

  if (pathname === '/api/product/delete') {
    const id = Number(b.id);
    if (!product(id)) throw err('Producto no encontrado');
    db.products = db.products.filter(p => p.id !== id);
    db.moves = db.moves.filter(m => m.product !== id);
    db.reservations = db.reservations.filter(r => r.product !== id);
    save();
    return { ok: true };
  }

  if (pathname === '/api/restock') {
    const id = Number(b.product), qty = Math.floor(Number(b.qty) || 0), note = String(b.note || '').trim();
    const p = product(id); if (!p) throw err('Producto no encontrado');
    if (!qty) throw err('Indica una cantidad');
    if (p.stock + qty < 0) throw err('Quedaría stock negativo');
    p.stock += qty;
    addMove(id, qty, note || (qty > 0 ? 'reabastecimiento' : 'ajuste'));
    save();
    return { ok: true };
  }

  if (pathname === '/api/category') {
    const name = String(b.name || '').trim();
    if (!name) throw err('Nombre de categoría requerido');
    if (db.categories.some(c => c.name === name)) throw err('Esa categoría ya existe');
    db.categories.push({ name, emoji: String(b.emoji || '').trim().slice(0, 40) });
    save();
    return { ok: true };
  }

  if (pathname === '/api/category/update') {
    const oldName = String(b.old || '').trim();
    const c = db.categories.find(x => x.name === oldName); if (!c) throw err('Categoría no encontrada');
    const newName = String(b.name ?? oldName).trim() || oldName;
    if (newName !== oldName && db.categories.some(x => x.name === newName)) throw err('Ese nombre ya existe');
    c.emoji = String(b.emoji ?? c.emoji).trim().slice(0, 40);
    if (newName !== oldName) {
      c.name = newName;
      for (const p of db.products) if (p.cat === oldName) p.cat = newName;
    }
    save();
    return { ok: true };
  }

  if (pathname === '/api/category/delete') {
    const name = String(b.name || '').trim();
    const c = db.categories.find(x => x.name === name); if (!c) throw err('Categoría no encontrada');
    const used = db.products.filter(p => p.cat === name).length;
    if (used) {
      if (name === 'General') throw err('Mueve primero esos productos a otra categoría');
      if (!db.categories.some(x => x.name === 'General')) db.categories.push({ name: 'General', emoji: 'icon:mecato' });
      for (const p of db.products) if (p.cat === name) p.cat = 'General';
    }
    db.categories = db.categories.filter(x => x !== c);
    save();
    return { ok: true };
  }

  if (pathname === '/api/payment') {
    const client = String(b.client || '').trim(), amount = Number(b.amount) || 0;
    if (!client || amount <= 0) throw err('Cliente y valor válido requeridos');
    if (!clientsMap()[client]) throw err('El cliente no existe');
    const deuda = debtOf(client);
    if (amount > deuda + 0.001) throw err('El abono es mayor a la deuda');
    db.payments.push({ client, amount, ts: now() });
    save();
    return { ok: true };
  }

  if (pathname === '/api/config') {
    if (b.name !== undefined) db.config.name = String(b.name).trim() || 'Mi Tienda de Mecatos';
    if (b.defMin !== undefined) db.config.defMin = Math.max(0, Number(b.defMin) || 0);
    save();
    return { ok: true };
  }

  if (pathname === '/api/import') {
    if (!Array.isArray(b.products)) throw err('Archivo no válido (faltan productos)');
    if (b.confirm !== true) throw err('Falta confirmación de reemplazo');
    const d = seed();
    d.config = Object.assign(d.config, b.config || {});
    d.categories = (b.categories || []).map(c => ({ name: c.name, emoji: c.emoji || '' }));
    let id = 0;
    const idMap = {};
    d.products = b.products.map(p => {
      const nid = ++id; idMap[p.id] = nid;
      if (p.cat && !d.categories.some(c => c.name === p.cat)) d.categories.push({ name: p.cat, emoji: '' });
      return { id: nid, name: p.name, cat: p.cat || 'General', price: Number(p.price) || 0, cost: Number(p.cost) || 0, stock: Number(p.stock) || 0, min: Number(p.min) || 0, code: p.code || '', emoji: p.emoji || '' };
    });
    if (!d.categories.length) d.categories.push({ name: 'General', emoji: 'icon:mecato' });
    for (const s of (b.sales || [])) {
      const nid = ++id;
      d.sales.push({
        id: nid, ts: Number(s.ts) || now(), total: Number(s.total) || 0, method: s.method || 'efectivo',
        client: s.client || '', received: Number(s.received) || 0,
        items: (s.items || []).map(i => ({ pid: idMap[i.pid] ?? 0, name: i.name, qty: i.qty, price: i.price, cost: i.cost || 0 })),
      });
      if ((s.method || '') === 'fiado' && s.client) d.debts.push({ client: s.client, sale: nid, amount: Number(s.total) || 0, ts: Number(s.ts) || now() });
    }
    for (const [name, c] of Object.entries(b.clients || {}))
      for (const pay of (c.payments || [])) d.payments.push({ client: name, amount: pay.amount, ts: pay.ts });
    db = d; save();
    return { ok: true };
  }

  if (pathname === '/api/reset') {
    if (b.confirm !== true) throw err('Falta confirmación');
    db = seed(); save();
    return { ok: true };
  }

  throw err('Ruta no encontrada: ' + pathname);
}

window.StaticAPI = { handle, key: KEY };
})();
