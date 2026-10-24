# 🍬 Mi Tienda de Mecatos

Caja, inventario, fiado y reportes para una tienda de mecatos. Funciona de dos formas con el **mismo código**:

| Dónde | Cómo se guardan los datos | Para qué sirve |
|---|---|---|
| **Tu PC con `node server.js`** | Base SQLite compartida (`datos/tienda.db`) | Todos los dispositivos de la casa/Local ven y escriben la misma información, en tiempo real |
| **GitHub Pages (esta página)** | Almacenamiento del navegador (`static-api.js`) | La tienda abre desde cualquier lugar, pero cada dispositivo guarda sus propios datos |

## Usar la página publicada

Abre la dirección de GitHub Pages. Si detecta que no hay un servidor de tienda accesible, entra en **modo local** y lo avisa en la cabecera ("Modo local · datos en este dispositivo").

## Usar la versión con base de datos compartida (recomendada para vender)

Requiere Node.js 22 o superior (usa el módulo integrado `node:sqlite`, sin dependencias que instalar).

```bash
node server.js
```

Luego abre `http://localhost:3000`. En la PC de la tienda puedes usar **Iniciar-Tienda.bat** con doble clic. Para vender desde el celular u otro PC de la misma red, usa la dirección IP que muestra la consola (también en **Ajustes → Acceso desde otros equipos**).

Si esa PC está encendida y accesible, la misma página publicada detectará el servidor y cambiará sola a datos compartidos.

## Qué incluye

- **Carrito con descuento inmediato:** al agregar un producto se aparta ("reserva") del inventario, así dos cajas no venden la misma última unidad. Si cierras la pestaña sin cobrar, el stock regresa a los 15 minutos.
- **Multi-caja en tiempo real:** los cambios de una caja se reflejan en las demás (SSE con servidor; sincronización entre pestañas en modo local).
- **Productos y categorías** con íconos SVG propios: suelta tus `.svg` en `assets/icons` y aparecerán en el selector "Íconos".
- **Reabastecer** con historial de movimientos y registro de mermas.
- **Fiado** con abonos y anulación de ventas que devuelve el stock.
- **Reportes por rango de fechas**, gráfico de ventas por día, más vendidos, bajo stock y exportación a CSV.
- **App instalable (PWA)** con avisos del navegador cuando un producto se agota o baja del mínimo.
- **Copia de seguridad:** descarga o restaura toda la tienda en un archivo JSON.

## Estructura

```
index.html            interfaz
styles.css            diseño (claro/oscuro, ventanas de vidrio)
app.js                lógica de la tienda (habla con /api/...)
static-api.js         mismo API, pero sobre localStorage (para GitHub Pages)
server.js             servidor Node + SQLite para datos compartidos
assets/icons/*.svg    íconos de productos y categorías
```

## Licencia

Uso libre para tu tienda.
