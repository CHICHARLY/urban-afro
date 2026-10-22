const STORAGE_KEYS = {
  users: 'licoreria_users',
  products: 'licoreria_products',
  sales: 'licoreria_sales',
  estancos: 'licoreria_estancos',
  session: 'licoreria_session',
};

const defaultUsers = [{ username: 'root', password: '1234', role: 'root' }];

const initialProducts = [
  { id: 1, name: 'Vodka Premium', category: 'Vodka', price: 4200, stock: 18 },
  { id: 2, name: 'Whisky Escocés', category: 'Whisky', price: 6800, stock: 12 },
  { id: 3, name: 'Vino Tinto', category: 'Vinos', price: 3200, stock: 20 },
  { id: 4, name: 'Cerveza Artesanal', category: 'Cerveza', price: 1800, stock: 42 },
];

const initialEstancos = [
  { id: 1, name: 'Estanco Centro', address: 'Av. Principal 123', phone: '555-001', manager: 'Luis' },
  { id: 2, name: 'Estanco Norte', address: 'Calle Norte 45', phone: '555-002', manager: 'Ana' },
];

function readStorage(key, fallback) {
  const value = localStorage.getItem(key);
  return value ? JSON.parse(value) : fallback;
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function seedData() {
  if (!readStorage(STORAGE_KEYS.users, null)) {
    writeStorage(STORAGE_KEYS.users, defaultUsers);
  }

  if (!readStorage(STORAGE_KEYS.products, null)) {
    writeStorage(STORAGE_KEYS.products, initialProducts);
  }

  if (!readStorage(STORAGE_KEYS.estancos, null)) {
    writeStorage(STORAGE_KEYS.estancos, initialEstancos);
  }

  if (!readStorage(STORAGE_KEYS.sales, null)) {
    writeStorage(STORAGE_KEYS.sales, []);
  }
}

seedData();

const loginScreen = document.getElementById('loginScreen');
const appScreen = document.getElementById('appScreen');
const loginForm = document.getElementById('loginForm');
const logoutBtn = document.getElementById('logoutBtn');
const navButtons = document.querySelectorAll('.nav-btn[data-section]');
const panels = document.querySelectorAll('.panel');

const productForm = document.getElementById('productForm');
const productTableBody = document.getElementById('productTableBody');
const saleForm = document.getElementById('saleForm');
const salesTableBody = document.getElementById('salesTableBody');
const estancoForm = document.getElementById('estancoForm');
const estancoTableBody = document.getElementById('estancoTableBody');

const productIdInput = document.getElementById('productId');
const productNameInput = document.getElementById('productName');
const productCategoryInput = document.getElementById('productCategory');
const productPriceInput = document.getElementById('productPrice');
const productStockInput = document.getElementById('productStock');

const estancoIdInput = document.getElementById('estancoId');
const estancoNameInput = document.getElementById('estancoName');
const estancoAddressInput = document.getElementById('estancoAddress');
const estancoPhoneInput = document.getElementById('estancoPhone');
const estancoManagerInput = document.getElementById('estancoManager');

const saleProductSelect = document.getElementById('saleProduct');
const saleQtyInput = document.getElementById('saleQty');
const saleTypeInput = document.getElementById('saleType');

function showScreen(screenName) {
  if (screenName === 'app') {
    loginScreen.classList.remove('active');
    appScreen.classList.add('active');
  } else {
    appScreen.classList.remove('active');
    loginScreen.classList.add('active');
  }
}

function getSession() {
  return readStorage(STORAGE_KEYS.session, null);
}

function setSession(value) {
  writeStorage(STORAGE_KEYS.session, value);
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.session);
  showScreen('login');
}

function renderNav(sectionId) {
  navButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
  });

  panels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === sectionId);
  });
}

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => renderNav(btn.dataset.section));
});

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();

  const users = readStorage(STORAGE_KEYS.users, []);
  const user = users.find((item) => item.username === username && item.password === password);

  if (!user) {
    alert('Usuario o contraseña incorrectos');
    return;
  }

  setSession({ username: user.username, role: user.role });
  showScreen('app');
  renderNav('dashboard');
  renderDashboard();
  renderProducts();
  renderSales();
  renderEstancos();
  populateSaleSelect();
});

logoutBtn.addEventListener('click', () => {
  clearSession();
});

function formatMoney(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
  }).format(value);
}

function renderDashboard() {
  const products = readStorage(STORAGE_KEYS.products, []);
  const sales = readStorage(STORAGE_KEYS.sales, []);
  const estancos = readStorage(STORAGE_KEYS.estancos, []);

  const totalVentas = sales.reduce((sum, item) => sum + Number(item.total), 0);
  const stockBajo = products.filter((product) => product.stock < 10).length;

  document.getElementById('totalVentas').textContent = formatMoney(totalVentas);
  document.getElementById('totalProductos').textContent = products.length;
  document.getElementById('stockBajo').textContent = stockBajo;
  document.getElementById('totalEstancos').textContent = estancos.length;
}

productForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const id = productIdInput.value ? Number(productIdInput.value) : Date.now();
  const product = {
    id,
    name: productNameInput.value.trim(),
    category: productCategoryInput.value,
    price: Number(productPriceInput.value),
    stock: Number(productStockInput.value),
  };

  const products = readStorage(STORAGE_KEYS.products, []);
  const index = products.findIndex((item) => item.id === id);

  if (index >= 0) {
    products[index] = product;
  } else {
    products.push(product);
  }

  writeStorage(STORAGE_KEYS.products, products);
  productForm.reset();
  renderProducts();
  renderDashboard();
  populateSaleSelect();
});

function renderProducts() {
  const products = readStorage(STORAGE_KEYS.products, []);
  productTableBody.innerHTML = '';

  products.forEach((product) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${product.name}</td>
      <td>${product.category}</td>
      <td>${formatMoney(product.price)}</td>
      <td>${product.stock}</td>
      <td>
        <button class="action-btn" data-edit="${product.id}">Editar</button>
        <button class="action-btn delete" data-delete="${product.id}">Eliminar</button>
      </td>
    `;

    productTableBody.appendChild(row);
  });

  productTableBody.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const products = readStorage(STORAGE_KEYS.products, []);
      const product = products.find((item) => item.id === Number(btn.dataset.edit));
      if (!product) return;

      productIdInput.value = product.id;
      productNameInput.value = product.name;
      productCategoryInput.value = product.category;
      productPriceInput.value = product.price;
      productStockInput.value = product.stock;
      productForm.querySelector('button').textContent = 'Actualizar producto';
    });
  });

  productTableBody.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const products = readStorage(STORAGE_KEYS.products, []);
      const filtered = products.filter((item) => item.id !== Number(btn.dataset.delete));
      writeStorage(STORAGE_KEYS.products, filtered);
      renderProducts();
      renderDashboard();
      populateSaleSelect();
    });
  });
}

function populateSaleSelect() {
  const products = readStorage(STORAGE_KEYS.products, []);
  saleProductSelect.innerHTML = '';

  products.forEach((product) => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = `${product.name} - ${formatMoney(product.price)}`;
    saleProductSelect.appendChild(option);
  });
}

saleForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const products = readStorage(STORAGE_KEYS.products, []);
  const productId = Number(saleProductSelect.value);
  const product = products.find((item) => item.id === productId);

  if (!product) {
    alert('Selecciona un producto válido');
    return;
  }

  const qty = Number(saleQtyInput.value);
  if (qty <= 0) {
    alert('La cantidad debe ser mayor a cero');
    return;
  }

  if (product.stock < qty) {
    alert('No hay suficiente stock');
    return;
  }

  product.stock -= qty;

  const sales = readStorage(STORAGE_KEYS.sales, []);
  sales.push({
    id: Date.now(),
    product: product.name,
    quantity: qty,
    total: product.price * qty,
    type: saleTypeInput.value,
    date: new Date().toLocaleString(),
  });

  writeStorage(STORAGE_KEYS.products, products);
  writeStorage(STORAGE_KEYS.sales, sales);

  saleForm.reset();
  renderSales();
  renderDashboard();
});

function renderSales() {
  const sales = readStorage(STORAGE_KEYS.sales, []);
  salesTableBody.innerHTML = '';

  sales.forEach((sale) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${sale.date}</td>
      <td>${sale.product}</td>
      <td>${sale.quantity}</td>
      <td>${formatMoney(sale.total)}</td>
      <td>${sale.type}</td>
    `;
    salesTableBody.appendChild(row);
  });
}

estancoForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const estanco = {
    id: estancoIdInput.value ? Number(estancoIdInput.value) : Date.now(),
    name: estancoNameInput.value.trim(),
    address: estancoAddressInput.value.trim(),
    phone: estancoPhoneInput.value.trim(),
    manager: estancoManagerInput.value.trim(),
  };

  const estancos = readStorage(STORAGE_KEYS.estancos, []);
  const index = estancos.findIndex((item) => item.id === estanco.id);

  if (index >= 0) {
    estancos[index] = estanco;
  } else {
    estancos.push(estanco);
  }

  writeStorage(STORAGE_KEYS.estancos, estancos);
  estancoForm.reset();
  renderEstancos();
  renderDashboard();
});

function renderEstancos() {
  const estancos = readStorage(STORAGE_KEYS.estancos, []);
  estancoTableBody.innerHTML = '';

  estancos.forEach((estanco) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${estanco.name}</td>
      <td>${estanco.address}</td>
      <td>${estanco.phone || '—'}</td>
      <td>${estanco.manager || '—'}</td>
      <td>
        <button class="action-btn" data-estanco-edit="${estanco.id}">Editar</button>
        <button class="action-btn delete" data-estanco-delete="${estanco.id}">Eliminar</button>
      </td>
    `;

    estancoTableBody.appendChild(row);
  });

  estancoTableBody.querySelectorAll('[data-estanco-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const estancos = readStorage(STORAGE_KEYS.estancos, []);
      const estanco = estancos.find((item) => item.id === Number(btn.dataset.estancoEdit));
      if (!estanco) return;

      estancoIdInput.value = estanco.id;
      estancoNameInput.value = estanco.name;
      estancoAddressInput.value = estanco.address;
      estancoPhoneInput.value = estanco.phone || '';
      estancoManagerInput.value = estanco.manager || '';
    });
  });

  estancoTableBody.querySelectorAll('[data-estanco-delete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const estancos = readStorage(STORAGE_KEYS.estancos, []);
      const filtered = estancos.filter((item) => item.id !== Number(btn.dataset.estancoDelete));
      writeStorage(STORAGE_KEYS.estancos, filtered);
      renderEstancos();
      renderDashboard();
    });
  });
}

const session = readStorage(STORAGE_KEYS.session, null);
if (session) {
  showScreen('app');
  renderNav('dashboard');
  renderDashboard();
  renderProducts();
  renderSales();
  renderEstancos();
  populateSaleSelect();
}
