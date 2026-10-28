#!/bin/sh
# Startet Zehn Kronen zum Testen. Passwort unten aendern!
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-Bailey}" PORT=3000 COOKIE_SECURE=1 TRUST_PROXY=1
echo "Server startet auf http://localhost:3000  (Admin: /admin)"
echo "Fuer Mitspieler in einem zweiten Fenster:  cloudflared tunnel --url http://localhost:3000"
exec node --disable-warning=ExperimentalWarning server/index.js
