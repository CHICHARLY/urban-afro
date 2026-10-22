# Licorería & Estanco real

Este proyecto es una versión realista de un sistema administrativo para licorería y estanco, con backend en Node.js + Express y persistencia en archivo JSON.

## Requisitos

- Node.js 18+
- npm

## Instalación

```bash
npm install
```

## Ejecutar

```bash
npm start
```

Luego abre:

```text
http://localhost:3000
```

## Usuario demo

- Usuario: root
- Contraseña: 1234

## Qué incluye

- Login de administrador ROOT
- Dashboard con estadísticas
- CRUD de productos y licores
- Registro de ventas
- CRUD de estancos/sucursales
- Persistencia real en archivo JSON del servidor

## Nota importante

Este es un sistema funcional en backend local, pero no reemplaza una base de datos relacional ni autenticación JWT para producción. Para producción real se recomienda migrar a PostgreSQL/MySQL y agregar sesiones seguras con JWT o Passport.
