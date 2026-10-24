@echo off
title Mi Tienda de Mecatos (SQLite)
cd /d "%~dp0"
echo Iniciando tienda... No cierres esta ventana mientras vendas.
echo Si el puerto 3000 esta ocupado, prueba: server.bat 8080
start "" http://localhost:3000
node server.js %1
pause
