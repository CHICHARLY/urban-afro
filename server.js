/* Mi Tienda de Mecatos — servidor local con base de datos SQLite
 * Arrancar:  node server.js        (abre http://localhost:3000)
 * Puerto:    node server.js 8080   o  set PORT=8080
 * Sin dependencias: usa node:sqlite y node:http integrados (Node >= 23). */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.argv[2] || process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'datos');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'tienda.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

/* ---------- Esquema ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS categories (name TEXT PRIMARY KEY, emoji TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, cat TEXT NOT NULL, price REAL NOT NULL, cost REAL DEFAULT 0,
  stock INTEGER DEFAULT 0, min INTEGER DEFAULT 0, code TEXT DEFAULT '', emoji TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, total REAL NOT NULL, method TEXT NOT NULL,
  client TEXT DEFAULT '', received REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sale INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product INTEGER NOT NULL, name TEXT NOT NULL, qty INTEGER NOT NULL, price REAL NOT NULL, cost REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS clients (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client TEXT NOT NULL, sale INTEGER, amount REAL NOT NULL, ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client TEXT NOT NULL, amount REAL NOT NULL, ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product INTEGER NOT NULL, qty INTEGER NOT NULL, ts INTEGER NOT NULL, note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS reservations (
  session TEXT NOT NULL, product INTEGER NOT NULL, qty INTEGER NOT NULL, ts INTEGER NOT NULL,
  PRIMARY KEY (session, product)
);
`);

/* ---------- Semilla inicial (solo base vacía) ---------- */
const nProducts = db.prepare('SELECT COUNT(*) c FROM products').get().c;
if (nProducts === 0 && db.prepare('SELECT COUNT(*) c FROM categories').get().c === 0) {
  const em = { Papas: 'icon:papas', Dulces: 'icon:caramelo', Bebidas: 'icon:gaseosa', Galletas: 'icon:galletas' };
  const insCat = db.prepare('INSERT INTO categories (name, emoji) VALUES (?, ?)');
  for (const c of ['Papas', 'Dulces', 'Bebidas', 'Galletas']) insCat.run(c, em[c] || '');
  const insP = db.prepare('INSERT INTO products (name, cat, price, cost, stock, min, code, emoji) VALUES (?,?,?,?,?,?,?,?)');
  const seed = [
    ['Papas Margarita pollo', 'Papas', 2500, 'icon:papas'], ['Papas Margarita limón', 'Papas', 2500, 'icon:papas'],
    ['Detodito', 'Papas', 3000, 'icon:popcorn'], ['Chocorramo', 'Dulces', 2800, 'icon:chocolate'],
    ['Chocolatina Jet', 'Dulces', 1200, 'icon:chocolate'], ['Bom Bom Bum', 'Dulces', 500, 'icon:bonbon'],
    ['Gelatina', 'Dulces', 1000, 'icon:gelatina'], ['Gaseosa 400 ml', 'Bebidas', 2500, 'icon:gaseosa'],
    ['Jugo Hit', 'Bebidas', 2200, 'icon:jugo'], ['Agua botella', 'Bebidas', 1800, 'icon:agua'],
    ['Galletas Festival', 'Galletas', 1500, 'icon:galletas'], ['Galletas Saltin', 'Galletas', 1300, 'icon:saltin'],
  ];
  for (const [name, cat, price, emoji] of seed) insP.run(name, cat, price, 0, 20, 5, '', emoji);
}
function cfg(key, def) { const r = db.prepare('SELECT value FROM config WHERE key=?').get(key); return r ? JSON.parse(r.value) : def; }
function setCfg(key, val) { db.prepare('INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(val)); }
if (cfg('name', null) === null) setCfg('name', 'Mi Tienda de Mecatos');
if (cfg('defMin', null) === null) setCfg('defMin', 5);

/* ---------- Migración única: emojis del semillero viejo -> iconos SVG ---------- */
if (!cfg('icons-migrated', false)) {
  const map = { '🥔': 'icon:papas', '🍿': 'icon:popcorn', '🍫': 'icon:chocolate', '🍭': 'icon:bonbon', '🍬': 'icon:caramelo', '🍮': 'icon:gelatina', '🥤': 'icon:gaseosa', '🧃': 'icon:jugo', '💧': 'icon:agua', '🍪': 'icon:galletas', '🍘': 'icon:saltin', '🛍️': 'icon:mecato' };
  const up = db.prepare('UPDATE products SET emoji=? WHERE emoji=?');
  const upC = db.prepare('UPDATE categories SET emoji=? WHERE emoji=?');
  for (const [e, i] of Object.entries(map)) { up.run(i, e); upC.run(i, e); }
  setCfg('icons-migrated', true);
}

/* ---------- Reservas de carrito huérfanas (cajas cerradas: sin latido > 15 min) ---------- */
function cleanStaleReservations() {
  const cutoff = Date.now() - 15 * 60 * 1000;
  const stale = db.prepare('SELECT * FROM reservations WHERE ts < ?').all(cutoff);
  for (const r of stale) db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(r.qty, r.product);
  if (stale.length) db.prepare('DELETE FROM reservations WHERE ts < ?').run(cutoff);
  return stale.length;
}

/* ---------- Eventos SSE (multi-caja en tiempo real) ---------- */
const sseClients = new Set();
function broadcast() {
  for (const res of sseClients) {
    if (res.headersSent) { try { res.write('event: change\ndata: ' + Date.now() + '\n\n'); } catch (e) {} }
    else queueMicrotask(() => { try { res.write('event: change\ndata: ' + Date.now() + '\n\n'); } catch (e) {} });
  }
}

/* Cada minuto se recuperan del stock las reservas de cajas cerradas (sin latido > 15 min) */
cleanStaleReservations();
setInterval(() => { if (cleanStaleReservations()) broadcast(); }, 60 * 1000).unref();

/* ---------- Helpers ---------- */
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const now = () => Date.now();
const json = (obj) => JSON.stringify(obj);

function fullData() {
  return {
    config: { name: cfg('name', 'Mi Tienda de Mecatos'), defMin: cfg('defMin', 5), theme: cfg('theme', '') },
    categories: all('SELECT name, emoji FROM categories ORDER BY name'),
    products: all('SELECT * FROM products ORDER BY name'),
    clients: (() => {
      const out = {};
      for (const c of all('SELECT name FROM clients')) {
        out[c.name] = {
          name: c.name,
          charges: all('SELECT ts, sale AS saleId, amount FROM debts WHERE client=?', c.name),
          payments: all('SELECT ts, amount FROM payments WHERE client=?', c.name),
        };
      }
      return out;
    })(),
    reservations: get('SELECT IFNULL(SUM(qty),0) q FROM reservations').q,
  };
}
function salesInRange(from, to) {
  const sales = all('SELECT * FROM sales WHERE ts >= ? AND ts <= ? ORDER BY ts DESC', from, to);
  const q = db.prepare('SELECT product AS pid, name, qty, price, cost FROM sale_items WHERE sale=?');
  for (const s of sales) s.items = q.all(s.id);
  return sales;
}

/* ---------- API ---------- */
function handleApi(req, res, pathname, query, body) {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(json(obj)); };
  const bad = (msg) => send(400, { error: msg });

  if (pathname === '/api/data' && req.method === 'GET') return send(200, fullData());

  if (pathname === '/api/sales' && req.method === 'GET') {
    const from = Number(query.get('from') || 0), to = Number(query.get('to') || now());
    return send(200, salesInRange(from, to));
  }

  if (pathname === '/api/icons' && req.method === 'GET') {
    const dir = path.join(ROOT, 'assets', 'icons');
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.svg')); } catch (e) {}
    return send(200, files.map(f => f.replace(/\.svg$/, '')));
  }

  if (pathname === '/api/reserve' && req.method === 'POST') {
    const session = String(body?.session || ''), pid = Number(body?.product), qty = Math.max(1, Math.floor(Number(body?.qty) || 1));
    if (!session) return bad('Sesión de caja requerida');
    const p = get('SELECT * FROM products WHERE id=?', pid);
    if (!p) return bad('Producto no encontrado');
    if (p.stock < qty) { broadcast(); return bad(`Sin stock disponible de ${p.name} (quedan ${p.stock})`); }
    db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(qty, p.id);
    db.prepare('INSERT INTO reservations (session, product, qty, ts) VALUES (?,?,?,?) ON CONFLICT(session,product) DO UPDATE SET qty=qty+excluded.qty, ts=excluded.ts')
      .run(session, p.id, qty, now());
    broadcast();
    return send(200, { ok: true, stock: p.stock - qty });
  }

  if (pathname === '/api/reserve-touch' && req.method === 'POST') {
    const session = String(body?.session || '');
    db.prepare('UPDATE reservations SET ts=? WHERE session=?').run(now(), session);
    return send(200, { ok: true });
  }

  if (pathname === '/api/release' && req.method === 'POST') {
    const session = String(body?.session || '');
    if (!session) return bad('Sesión de caja requerida');
    if (body?.all) {
      for (const r of all('SELECT * FROM reservations WHERE session=?', session))
        db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(r.qty, r.product);
      db.prepare('DELETE FROM reservations WHERE session=?').run(session);
    } else {
      const pid = Number(body?.product), qty = Math.max(1, Math.floor(Number(body?.qty) || 1));
      const r = get('SELECT * FROM reservations WHERE session=? AND product=?', session, pid);
      if (r) {
        const back = Math.min(qty, r.qty);
        db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(back, pid);
        if (r.qty - back <= 0) db.prepare('DELETE FROM reservations WHERE session=? AND product=?').run(session, pid);
        else db.prepare('UPDATE reservations SET qty=? WHERE session=? AND product=?').run(r.qty - back, session, pid);
      }
    }
    broadcast();
    return send(200, { ok: true });
  }

  if (pathname === '/api/reservations' && req.method === 'GET') {
    const session = String(query.get('session') || '');
    return send(200, all('SELECT product AS pid, qty FROM reservations WHERE session=?', session));
  }

  if (pathname === '/api/moves' && req.method === 'GET') {
    const pid = Number(query.get('product') || 0);
    return send(200, all('SELECT m.*, p.name FROM stock_moves m JOIN products p ON p.id=m.product WHERE p.id=? ORDER BY m.ts DESC LIMIT 50', pid));
  }

  if (pathname === '/api/sale' && req.method === 'POST') {
    const { items, method, client = '', received = 0, session = '' } = body || {};
    if (!Array.isArray(items) || !items.length) return bad('Carrito vacío');
    if (!['efectivo', 'transferencia', 'fiado'].includes(method)) return bad('Método de pago inválido');
    if (method === 'fiado' && !String(client).trim()) return bad('Nombre de cliente requerido para fiado');
    const tx = db.prepare('BEGIN'); const commit = db.prepare('COMMIT'); const rollback = db.prepare('ROLLBACK');
    try {
      tx.run();
      const getP = db.prepare('SELECT * FROM products WHERE id=?');
      const setStock = db.prepare('UPDATE products SET stock=? WHERE id=?');
      const getRes = db.prepare('SELECT qty FROM reservations WHERE session=? AND product=?');
      const delRes = db.prepare('DELETE FROM reservations WHERE session=? AND product=?');
      const upRes = db.prepare('UPDATE reservations SET qty=? WHERE session=? AND product=?');
      const move = db.prepare('INSERT INTO stock_moves (product, qty, ts, note) VALUES (?,?,?,?)');
      let total = 0; // el total se calcula aquí, con los precios del catálogo, nunca con los del cliente
      for (const i of items) {
        const p = getP.get(Number(i.product));
        if (!p) { rollback.run(); return bad('Producto no encontrado: ' + i.product); }
        const q = Math.max(1, Math.floor(Number(i.qty) || 0));
        const r = session ? getRes.get(String(session), p.id) : null;
        const rQty = r ? r.qty : 0;
        if (rQty + p.stock < q) { rollback.run(); return bad(`Stock insuficiente de ${p.name} (quedan ${rQty + p.stock})`); }
        const fromRes = Math.min(q, rQty), fromFree = q - fromRes;
        if (fromFree > 0) setStock.run(p.stock - fromFree, p.id);
        if (fromRes > 0) { if (rQty - fromRes <= 0) delRes.run(String(session), p.id); else upRes.run(rQty - fromRes, String(session), p.id); }
        move.run(p.id, -q, now(), 'venta');
        total += p.price * q;
        i._price = p.price; i._cost = p.cost || 0; i._name = p.name; i._qty = q;
      }
      if (method === 'efectivo' && Number(received) < total) { rollback.run(); return bad('El dinero recibido es menor al total'); }
      const r = db.prepare('INSERT INTO sales (ts, total, method, client, received) VALUES (?,?,?,?,?)')
        .run(now(), total, method, String(client).trim(), Number(received) || 0);
      const saleId = Number(r.lastInsertRowid);
      const insItem = db.prepare('INSERT INTO sale_items (sale, product, name, qty, price, cost) VALUES (?,?,?,?,?,?)');
      for (const i of items) insItem.run(saleId, Number(i.product), i._name, i._qty, i._price, i._cost);
      if (method === 'fiado') {
        const cname = String(client).trim();
        db.prepare('INSERT OR IGNORE INTO clients (name) VALUES (?)').run(cname);
        db.prepare('INSERT INTO debts (client, sale, amount, ts) VALUES (?,?,?,?)').run(cname, saleId, total, now());
      }
      commit.run();
      broadcast();
      return send(200, { ok: true, id: saleId, total });
    } catch (e) { try { rollback.run(); } catch (e2) {} return bad('Error al registrar la venta: ' + e.message); }
  }

  if (pathname === '/api/sale/void' && req.method === 'POST') {
    const id = Number(body?.id);
    const s = get('SELECT * FROM sales WHERE id=?', id);
    if (!s) return bad('Venta no encontrada');
    db.prepare('BEGIN').run();
    try {
      const items = all('SELECT * FROM sale_items WHERE sale=?', id);
      for (const i of items) {
        db.prepare('UPDATE products SET stock = stock + ? WHERE id=?').run(i.qty, i.product);
        db.prepare('INSERT INTO stock_moves (product, qty, ts, note) VALUES (?,?,?,?)').run(i.product, i.qty, now(), 'anulación venta #' + id);
      }
      db.prepare('DELETE FROM sale_items WHERE sale=?').run(id);
      db.prepare('DELETE FROM sales WHERE id=?').run(id);
      db.prepare('DELETE FROM debts WHERE sale=?').run(id);
      db.prepare('COMMIT').run();
      broadcast();
      return send(200, { ok: true });
    } catch (e) { db.prepare('ROLLBACK').run(); return bad(e.message); }
  }

  if (pathname === '/api/product' && req.method === 'POST') {
    const p = body || {};
    const name = String(p.name || '').trim(), cat = String(p.cat || '').trim();
    if (!name || !cat) return bad('Nombre y categoría son obligatorios');
    if (!get('SELECT 1 FROM categories WHERE name=?', cat)) return bad('La categoría no existe');
    const data = { name, cat, price: Math.max(0, Number(p.price) || 0), cost: Math.max(0, Number(p.cost) || 0), stock: Math.max(0, Math.floor(Number(p.stock) || 0)), min: Math.max(0, Math.floor(Number(p.min) || 0)), code: String(p.code || '').trim(), emoji: String(p.emoji || '').trim() };
    if (data.code && get('SELECT id FROM products WHERE code=? AND id IS NOT ?', data.code, p.id ? Number(p.id) : null)) return bad('Ese código ya existe en otro producto');
    if (p.id) {
      const before = get('SELECT stock FROM products WHERE id=?', Number(p.id));
      if (!before) return bad('Producto no encontrado');
      db.prepare('UPDATE products SET name=?, cat=?, price=?, cost=?, stock=?, min=?, code=?, emoji=? WHERE id=?')
        .run(data.name, data.cat, data.price, data.cost, data.stock, data.min, data.code, data.emoji, Number(p.id));
      if (data.stock !== before.stock)
        db.prepare('INSERT INTO stock_moves (product, qty, ts, note) VALUES (?,?,?,?)').run(Number(p.id), data.stock - before.stock, now(), 'ajuste manual');
    } else {
      const r = db.prepare('INSERT INTO products (name, cat, price, cost, stock, min, code, emoji) VALUES (?,?,?,?,?,?,?,?)')
        .run(data.name, data.cat, data.price, data.cost, data.stock, data.min, data.code, data.emoji);
      if (data.stock > 0) db.prepare('INSERT INTO stock_moves (product, qty, ts, note) VALUES (?,?,?,?)').run(Number(r.lastInsertRowid), data.stock, now(), 'inventario inicial');
    }
    broadcast();
    return send(200, { ok: true });
  }

  if (pathname === '/api/product/delete' && req.method === 'POST') {
    const id = Number(body?.id);
    if (!get('SELECT id FROM products WHERE id=?', id)) return bad('Producto no encontrado');
    db.prepare('DELETE FROM products WHERE id=?').run(id);
    db.prepare('DELETE FROM stock_moves WHERE product=?').run(id);
    db.prepare('DELETE FROM reservations WHERE product=?').run(id);
    broadcast();
    return send(200, { ok: true });
  }

  if (pathname === '/api/restock' && req.method === 'POST') {
    const id = Number(body?.product), qty = Math.floor(Number(body?.qty) || 0), note = String(body?.note || '').trim();
    if (!get('SELECT id FROM products WHERE id=?', id)) return bad('Producto no encontrado');
    if (!qty) return bad('Indica una cantidad');
    const p = get('SELECT stock FROM products WHERE id=?', id);
    if (p.stock + qty < 0) return bad('Quedaría stock negativo');
    db.prepare('UPDATE products SET stock = stock + ? WHERE id=?').run(qty, id);
    db.prepare('INSERT INTO stock_moves (product, qty, ts, note) VALUES (?,?,?,?)').run(id, qty, now(), note || (qty > 0 ? 'reabastecimiento' : 'ajuste'));
    broadcast();
    return send(200, { ok: true });
  }

  if (pathname === '/api/category' && req.method === 'POST') {
    const name = String(body?.name || '').trim();
    const emoji = String(body?.emoji || '').trim().slice(0, 40);
    if (!name) return bad('Nombre de categoría requerido');
    if (get('SELECT 1 FROM categories WHERE name=?', name)) return bad('Esa categoría ya existe');
    db.prepare('INSERT INTO categories (name, emoji) VALUES (?,?)').run(name, emoji);
    broadcast();
    return send(200, { ok: true });
  }
  if (pathname === '/api/category/update' && req.method === 'POST') {
    const oldName = String(body?.old || '').trim();
    const c = get('SELECT * FROM categories WHERE name=?', oldName);
    if (!c) return bad('Categoría no encontrada');
    const newName = String(body?.name ?? oldName).trim() || oldName;
    if (newName !== oldName && get('SELECT 1 FROM categories WHERE name=?', newName)) return bad('Ese nombre ya existe');
    db.prepare('UPDATE categories SET name=?, emoji=? WHERE name=?').run(newName, String(body?.emoji ?? c.emoji).trim().slice(0, 40), oldName);
    if (newName !== oldName) db.prepare('UPDATE products SET cat=? WHERE cat=?').run(newName, oldName);
    broadcast();
    return send(200, { ok: true });
  }
  if (pathname === '/api/category/delete' && req.method === 'POST') {
    const name = String(body?.name || '').trim();
    if (!get('SELECT 1 FROM categories WHERE name=?', name)) return bad('Categoría no encontrada');
    const used = get('SELECT COUNT(*) c FROM products WHERE cat=?', name).c;
    if (used) {
      if (name === 'General') return bad('Mueve primero esos productos a otra categoría');
      if (!get('SELECT 1 FROM categories WHERE name=?', 'General')) db.prepare("INSERT INTO categories (name, emoji) VALUES ('General','🛍️')").run();
      db.prepare("UPDATE products SET cat='General' WHERE cat=?").run(name);
    }
    db.prepare('DELETE FROM categories WHERE name=?').run(name);
    broadcast();
    return send(200, { ok: true });
  }

  if (pathname === '/api/payment' && req.method === 'POST') {
    const client = String(body?.client || '').trim();
    const amount = Number(body?.amount) || 0;
    if (!client || amount <= 0) return bad('Cliente y valor válido requeridos');
    if (!get('SELECT 1 FROM clients WHERE name=?', client)) return bad('El cliente no existe');
    const deuda = get('SELECT IFNULL((SELECT SUM(amount) FROM debts WHERE client=?),0) - IFNULL((SELECT SUM(amount) FROM payments WHERE client=?),0) AS b', client, client).b;
    if (amount > deuda + 0.001) return bad('El abono es mayor a la deuda');
    db.prepare('INSERT INTO payments (client, amount, ts) VALUES (?,?,?)').run(client, amount, now());
    broadcast();
    return send(200, { ok: true });
  }

  if (pathname === '/api/config' && req.method === 'POST') {
    if (body?.name !== undefined) setCfg('name', String(body.name).trim() || 'Mi Tienda de Mecatos');
    if (body?.defMin !== undefined) setCfg('defMin', Math.max(0, Number(body.defMin) || 0));
    broadcast();
    return send(200, { ok: true });
  }

  if (pathname === '/api/export' && req.method === 'GET') {
    const d = fullData();
    d.sales = all('SELECT * FROM sales ORDER BY ts');
    const qi = db.prepare('SELECT product AS pid, name, qty, price, cost FROM sale_items WHERE sale=?');
    for (const s of d.sales) s.items = qi.all(s.id);
    return send(200, d);
  }

  if (pathname === '/api/import' && req.method === 'POST') {
    const d = body || {};
    if (!Array.isArray(d.products)) return bad('Archivo no válido (faltan productos)');
    if (!confirmLike(d)) return bad('Falta confirmación de reemplazo');
    db.exec('BEGIN');
    try {
      for (const t of ['sale_items', 'sales', 'debts', 'payments', 'stock_moves', 'reservations', 'products', 'categories', 'clients']) db.exec(`DELETE FROM ${t}`);
      const insCat = db.prepare('INSERT OR IGNORE INTO categories (name, emoji) VALUES (?,?)');
      const emOf = {};
      for (const c of (d.categories || [])) { insCat.run(c.name, c.emoji || ''); emOf[c.name] = c.emoji || ''; }
      const insP = db.prepare('INSERT INTO products (name, cat, price, cost, stock, min, code, emoji) VALUES (?,?,?,?,?,?,?,?)');
      const idMap = {};
      for (const p of d.products) {
        if (p.cat && !get('SELECT 1 FROM categories WHERE name=?', p.cat)) insCat.run(p.cat, '');
        const r = insP.run(p.name, p.cat || 'General', p.price || 0, p.cost || 0, p.stock || 0, p.min || 0, p.code || '', p.emoji || '').lastInsertRowid;
        idMap[p.id] = Number(r);
      }
      if (!get('SELECT 1 FROM categories WHERE name=?', 'General') && !all('SELECT name FROM categories').length)
        insCat.run('General', '🛍️');
      const insS = db.prepare('INSERT INTO sales (ts, total, method, client, received) VALUES (?,?,?,?,?)');
      const insI = db.prepare('INSERT INTO sale_items (sale, product, name, qty, price, cost) VALUES (?,?,?,?,?,?)');
      const insCli = db.prepare('INSERT OR IGNORE INTO clients (name) VALUES (?)');
      const insD = db.prepare('INSERT INTO debts (client, sale, amount, ts) VALUES (?,?,?,?)');
      const insPay = db.prepare('INSERT INTO payments (client, amount, ts) VALUES (?,?,?)');
      for (const s of (d.sales || [])) {
        const saleId = Number(insS.run(s.ts, s.total, s.method || 'efectivo', s.client || '', s.received || 0).lastInsertRowid);
        for (const i of (s.items || [])) insI.run(saleId, idMap[i.pid] ?? i.pid ?? 0, i.name, i.qty, i.price, i.cost || 0);
        if (s.method === 'fiado' && s.client) { insCli.run(s.client); insD.run(s.client, saleId, s.total, s.ts); }
      }
      for (const [name, c] of Object.entries(d.clients || {})) {
        insCli.run(name);
        for (const pay of (c.payments || [])) insPay.run(name, pay.amount, pay.ts);
      }
      if (d.config?.name) setCfg('name', d.config.name);
      if (d.config?.defMin != null) setCfg('defMin', d.config.defMin);
      db.exec('COMMIT');
      broadcast();
      return send(200, { ok: true });
    } catch (e) { db.exec('ROLLBACK'); return bad('Error al importar: ' + e.message); }
  }

  if (pathname === '/api/reset' && req.method === 'POST') {
    if (!confirmLike(body)) return bad('Falta confirmación de borrado');
    db.exec('BEGIN');
    for (const t of ['sale_items', 'sales', 'debts', 'payments', 'stock_moves', 'reservations', 'products', 'categories', 'clients']) db.exec(`DELETE FROM ${t}`);
    db.exec('DELETE FROM config');
    db.exec('COMMIT');
    setCfg('name', 'Mi Tienda de Mecatos'); setCfg('defMin', 5);
    const em = { Papas: 'icon:papas', Dulces: 'icon:caramelo', Bebidas: 'icon:gaseosa', Galletas: 'icon:galletas' };
    const insCat = db.prepare('INSERT INTO categories (name, emoji) VALUES (?, ?)');
    for (const c of ['Papas', 'Dulces', 'Bebidas', 'Galletas']) insCat.run(c, em[c]);
    const insP = db.prepare('INSERT INTO products (name, cat, price, cost, stock, min, code, emoji) VALUES (?,?,?,?,?,?,?,?)');
    for (const [name, cat, price, emoji] of [
      ['Papas Margarita pollo', 'Papas', 2500, 'icon:papas'], ['Papas Margarita limón', 'Papas', 2500, 'icon:papas'],
      ['Detodito', 'Papas', 3000, 'icon:popcorn'], ['Chocorramo', 'Dulces', 2800, 'icon:chocolate'],
      ['Chocolatina Jet', 'Dulces', 1200, 'icon:chocolate'], ['Bom Bom Bum', 'Dulces', 500, 'icon:bonbon'],
      ['Gelatina', 'Dulces', 1000, 'icon:gelatina'], ['Gaseosa 400 ml', 'Bebidas', 2500, 'icon:gaseosa'],
      ['Jugo Hit', 'Bebidas', 2200, '🧃'], ['Agua botella', 'Bebidas', 1800, '💧'],
      ['Galletas Festival', 'Galletas', 1500, '🍪'], ['Galletas Saltin', 'Galletas', 1300, '🍘']])
      insP.run(name, cat, price, 0, 20, 5, '', emoji);
    broadcast();
    return send(200, { ok: true });
  }

  if (pathname === '/api/info' && req.method === 'GET') {
    const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    return send(200, { port: PORT, ips, dbFile: path.join(DATA_DIR, 'tienda.db'), node: process.version });
  }

  return send(404, { error: 'Ruta no conocida' });
}
function confirmLike(body) { return body && body.confirm === true; }

/* ---------- Static ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  try {
    route(req, res);
  } catch (e) {
    console.error('Error no esperado:', e.message);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); res.end('{"error":"Error interno del servidor"}'); }
    else { try { res.end(); } catch (e2) {} }
  }
});

function route(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (p.startsWith('/api/')) {
    if (req.method === 'GET') return handleApi(req, res, p, u.searchParams, null);
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 20e6) req.destroy(); });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"JSON inválido"}'); return; }
      try { handleApi(req, res, p, u.searchParams, body); }
      catch (e) { console.error('Error en API:', e.message); if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); res.end('{"error":"Error interno del servidor"}'); } }
    });
    return;
  }

  let file = p === '/' ? '/index.html' : p;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
  const abs = path.join(ROOT, file);
  if (!abs.startsWith(ROOT)) { res.writeHead(403); res.end('No'); return; }
  fs.readFile(abs, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('No encontrado'); return; }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=86400' });
    res.end(buf);
  });
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('🍬 Mi Tienda de Mecatos (SQLite) corriendo en:');
  console.log('   Este equipo:   http://localhost:' + PORT);
  for (const ip of ips) console.log('   Otros (misma WiFi/red):  http://' + ip + ':' + PORT);
  console.log('   Base de datos: ' + path.join(DATA_DIR, 'tienda.db'));
});
