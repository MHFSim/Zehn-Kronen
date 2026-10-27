@echo off
rem Startet Zehn Kronen zum Testen. Passwort unten aendern!
set ADMIN_PASSWORD=aendere-mich-bitte
set PORT=3000
set COOKIE_SECURE=1
set TRUST_PROXY=1
echo Server startet auf http://localhost:3000  (Admin: /admin)
echo Fuer Mitspieler in einem zweiten Fenster:  cloudflared tunnel --url http://localhost:3000
node --disable-warning=ExperimentalWarning server/index.js
pause
