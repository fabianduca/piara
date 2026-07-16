@echo off
chcp 65001 >nul
title Piara - Criaderos porcinos
cd /d "%~dp0"

echo ================================================
echo   PIARA - arrancando la app...
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] No esta instalado Node.js.
  echo     Instalalo desde https://nodejs.org  (version LTS^) y volve a hacer doble clic aca.
  echo.
  pause
  exit /b
)

if not exist node_modules (
  echo Instalando dependencias por primera vez... (tarda un minuto^)
  call npm install
  echo.
)

rem Si existe twilio.bat (con las credenciales de Twilio), se cargan y el
rem WhatsApp pasa de "bandeja de salida" a envio real. Ver docs/ESTADO.md.
if exist twilio.bat call twilio.bat

echo Preparando datos de demostracion...
call node tools\seed.js
echo.

echo Abriendo el navegador...
start "" http://localhost:3000

echo.
echo ================================================
echo   Piara esta corriendo. NO cierres esta ventana.
echo   Para apagar: cerra esta ventana o apreta Ctrl+C.
echo ================================================
echo.
node server.js
pause
