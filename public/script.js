const STORAGE_KEYS = {
  session: 'licoreria_session',
};

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

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'Error de la solicitud');
  }

  return data;
}

function showScreen(name) {
  if (name === 'app') {
    loginScreen.classList.remove('active');
    appScreen.classList.add('active');
  } else {
    appScreen.classList.remove('active');
    loginScreen.classList.add('active');
  }
}

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.session) || 'null');
  } catch {
    return null;
  }
}

function setSession(user) {
  localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.session);
  showScreen('login');
}

function formatMoney(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
  }).format(Number(value || 0));
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

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();

  try {
    const data = await apiFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    setSession(data.user);
    showScreen('app');
    renderNav('dashboard');
    await loadAllData();
  } catch (error) {
    alert(error.message);
  }
});

logoutBtn.addEventListener('click', () => {
  clearSession();
});

async function loadSummary() {
  const data = await apiFetch('/api/summary');
  document.getElementById('totalVentas').textContent = formatMoney(data.totalVentas);
  document.getElementById('totalProductos').textContent = data.totalProductos;
  document.getElementById('stockBajo').textContent = data.stockBajo;
  document.getElementById('totalEstancos').textContent = data.totalEstancos;
}

async function loadProducts() {
  const products = await apiFetch('/api/products');
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
      const productId = Number(btn.dataset.edit);
      const products = JSON.parse(localStorage.getItem('products_local_cache') || '[]');
      const product = products.find((item) => Number(item.id) === productId);

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
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delete;
      try {
        await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
        await loadAllData();
      } catch (error) {
        alert(error.message);
      }
    });
  });

  localStorage.setItem('products_local_cache', JSON.stringify(products));
}

async function loadSales() {
  const sales = await apiFetch('/api/sales');
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

async function loadEstancos() {
  const estancos = await apiFetch('/api/estancos');
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
      const estancoId = Number(btn.dataset.estancoEdit);
      const estancos = JSON.parse(localStorage.getItem('estancos_local_cache') || '[]');
      const estanco = estancos.find((item) => Number(item.id) === estancoId);

      if (!estanco) return;

      estancoIdInput.value = estanco.id;
      estancoNameInput.value = estanco.name;
      estancoAddressInput.value = estanco.address;
      estancoPhoneInput.value = estanco.phone || '';
      estancoManagerInput.value = estanco.manager || '';
    });
  });

  estancoTableBody.querySelectorAll('[data-estanco-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/api/estancos/${btn.dataset.estancoDelete}`, { method: 'DELETE' });
        await loadAllData();
      } catch (error) {
        alert(error.message);
      }
    });
  });

  localStorage.setItem('estancos_local_cache', JSON.stringify(estancos));
}

async function loadProductsIntoSelect() {
  const products = await apiFetch('/api/products');
  saleProductSelect.innerHTML = '';

  products.forEach((product) => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = `${product.name} - ${formatMoney(product.price)}`;
    saleProductSelect.appendChild(option);
  });
}

async function loadAllData() {
  await Promise.all([loadSummary(), loadProducts(), loadSales(), loadEstancos(), loadProductsIntoSelect()]);
}

productForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    name: productNameInput.value.trim(),
    category: productCategoryInput.value,
    price: Number(productPriceInput.value),
    stock: Number(productStockInput.value),
  };

  try {
    if (productIdInput.value) {
      await apiFetch(`/api/products/${productIdInput.value}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      await apiFetch('/api/products', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    productForm.reset();
    productForm.querySelector('button').textContent = 'Guardar producto';
    await loadAllData();
  } catch (error) {
    alert(error.message);
  }
});

saleForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    productId: saleProductSelect.value,
    quantity: Number(saleQtyInput.value),
    type: saleTypeInput.value,
  };

  try {
    await apiFetch('/api/sales', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    saleForm.reset();
    await loadAllData();
  } catch (error) {
    alert(error.message);
  }
});

estancoForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    name: estancoNameInput.value.trim(),
    address: estancoAddressInput.value.trim(),
    phone: estancoPhoneInput.value.trim(),
    manager: estancoManagerInput.value.trim(),
  };

  try {
    if (estancoIdInput.value) {
      await apiFetch(`/api/estancos/${estancoIdInput.value}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      await apiFetch('/api/estancos', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    estancoForm.reset();
    await loadAllData();
  } catch (error) {
    alert(error.message);
  }
});

const session = getSession();
if (session) {
  showScreen('app');
  renderNav('dashboard');
  loadAllData();
}
