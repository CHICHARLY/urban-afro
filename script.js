const servicioPrecio = {
  'Corte clásico': 2800,
  'Corte + barba': 3600,
  'Fade premium': 4200,
  'Afeitada royal': 2600,
};

const servicioSelect = document.getElementById('servicio');
const precioServicio = document.getElementById('precioServicio');

function actualizarPrecio() {
  const valor = servicioSelect.value;
  const precio = servicioPrecio[valor] || 0;
  precioServicio.textContent = `$${precio.toLocaleString('es-AR')}`;
}

servicioSelect.addEventListener('change', actualizarPrecio);

const timeSlots = document.querySelectorAll('.time-slot');

timeSlots.forEach((slot) => {
  slot.addEventListener('click', () => {
    timeSlots.forEach((item) => item.classList.remove('selected'));
    slot.classList.add('selected');
  });
});

const bookingForm = document.getElementById('bookingForm');
bookingForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const nombre = bookingForm.querySelector('input[name="nombre"]').value.trim();
  const servicio = servicioSelect.value;
  const fecha = bookingForm.querySelector('input[name="fecha"]').value;
  const horario = document.querySelector('.time-slot.selected')?.dataset.time || '10:00';

  if (!nombre || !fecha) {
    alert('Completá tu nombre y la fecha para continuar.');
    return;
  }

  const resumen = `Turno confirmado para ${nombre}: ${servicio} el ${fecha} a las ${horario}.`;
  alert(resumen);
  bookingForm.reset();
  timeSlots[0].classList.add('selected');
  timeSlots.forEach((slot) => {
    if (slot !== timeSlots[0]) slot.classList.remove('selected');
  });
  actualizarPrecio();
});

document.getElementById('year').textContent = new Date().getFullYear();
actualizarPrecio();
