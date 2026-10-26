# Betrieb: Zehn Kronen online stellen

Das Spiel braucht nur Node.js 22.13 oder neuer. Keine Datenbank, kein Zusatzpaket. Ein kleiner Linux-Server mit 1 GB Speicher reicht für 10 Spieler.

## 1. Server vorbereiten (Ubuntu/Debian)

```bash
# Node.js 22 installieren (https://nodejs.org oder per NodeSource)
sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
git clone https://github.com/MHFSim/Zehn-Kronen.git /opt/zehn-kronen
```

## 2. Als Dienst starten (systemd)

Datei `/etc/systemd/system/zehn-kronen.service`:

```ini
[Unit]
Description=Zehn Kronen
After=network.target

[Service]
WorkingDirectory=/opt/zehn-kronen
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/index.js
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/zehn-kronen
Environment=ADMIN_PASSWORD=HIER-EIN-LANGES-PASSWORT
Environment=COOKIE_SECURE=1
Environment=TRUST_PROXY=1
Environment=PUSH_SUBJECT=mailto:du@example.org
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/zehn-kronen && sudo chown www-data /var/lib/zehn-kronen
sudo systemctl enable --now zehn-kronen
```

## 3. https einrichten (nötig für Push und sichere Anmeldung)

Am einfachsten mit **Caddy**, das sich das Zertifikat selbst holt. Datei `/etc/caddy/Caddyfile`:

```
spiel.deine-domain.de {
    reverse_proxy localhost:3000
}
```

Die Domain muss auf die IP deines Servers zeigen. Die Live-Verbindung (Server-Sent Events) läuft ohne Zusatzeinstellung durch Caddy. Bei nginx brauchst du für `/api/events` `proxy_buffering off;`.

## 4. Docker (Alternative)

```bash
docker build -t zehn-kronen .
docker run -d --name zehn-kronen -p 3000:3000 -v zk-data:/data -e ADMIN_PASSWORD=... -e COOKIE_SECURE=1 -e TRUST_PROXY=1 zehn-kronen
```

## 5. Partie einrichten

1. `https://spiel.deine-domain.de/admin`, mit `ADMIN_PASSWORD` anmelden.
2. Partie erstellen: Tempo 1, Länge z. B. 10 Wochen.
3. Einladungslink an die Mitspieler schicken. Sie landen in der **Lobby**.
4. Wenn alle da sind: **Partie starten**. Der 4-Tage-Schutz beginnt in diesem Moment.

Während der Partie: pausieren, Tempo/Länge ändern, Spieler entfernen (Verbündete bekommen ihre Truppen zurück), Passwort zurücksetzen (zeigt dir ein neues Passwort, das du dem Spieler gibst), Partie beenden. Gleiche Verbindung bei zwei Konten wird als ⚠ markiert.

## 6. Benachrichtigungen (Push)

- Laufen über den Push-Dienst des Browsers (Google, Apple, Mozilla). Die Schlüssel erzeugt der Server beim ersten Start selbst (Tabelle `settings`, Schlüssel `vapid`). **Nicht löschen**, sonst müssen alle Spieler neu zustimmen.
- Spieler schalten sie unter **Mehr → Einstellungen** ein.
- **iPhone/iPad:** Die Seite muss zuerst über „Teilen → Zum Home-Bildschirm“ installiert und von dort geöffnet werden (ab iOS 16.4).
- Gesendet wird nur, wenn der Spieler gerade nicht live im Spiel ist. Ereignisse werden auch ohne Besucher alle 16 Sekunden verarbeitet.

## 7. Sicherung und Updates

- Sicherungen: täglich automatisch nach `DATA_DIR/backups/`, die letzten 14. Zusätzlich solltest du den Ordner gelegentlich auf einen anderen Rechner kopieren.
- Update: `cd /opt/zehn-kronen && git pull && sudo systemctl restart zehn-kronen`. Laufende Partien werden aus der Datenbank wiederhergestellt.
- Vor einem Update mit geänderter Kartengröße oder neuen Regeln im Admin einmal „Datensicherung jetzt“ drücken.

## 8. Recht (Deutschland)

- Unter `/impressum` und `/datenschutz` liegen Vorlagen. Eigene Texte als `DATA_DIR/impressum.html` und `DATA_DIR/datenschutz.html` ablegen.
- Das Spiel speichert Name, Passwort-Hash, Spielstand, Cookie, einen IP-Hash (Mehrfachkonten) und bei Push die Adresse des Push-Dienstes. Schriftarten (Google Fonts) und PixiJS (cdnjs) lädt der Browser von dort, dabei wird die IP übertragen. Wer das nicht will, legt die Dateien lokal ab.
- Diese Hinweise ersetzen keine Rechtsberatung.

## 9. Abstimmen

`node tools/balance.mjs` zeigt Marschzeiten (Nachbar, gegenüber, Thron) und Beispielkämpfe. Die Konstanten für Schutz, Vasallenzeit, Tribut, Thron-Haltezeit usw. stehen oben in `shared/core.js`, Einheiten und Gebäude in `shared/rules.js`.
