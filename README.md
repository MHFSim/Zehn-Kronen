# Zehn Kronen

Browser-Strategiespiel für bis zu 10 Spieler. Stand: Schritt 2 des Entwicklungsplans – eigener Stadt-Ausbau mit Server, Anmeldung, Admin-Bereich und Einladungslink.

## Was du brauchst

- **Node.js 22.13 oder neuer** (empfohlen: die aktuelle LTS-Version von nodejs.org).
- Sonst nichts: Der Server nutzt nur Bordmittel von Node.js, es gibt keine Pakete zu installieren. Die Datenbank ist eine einzelne Datei im Ordner `data/`.

## Starten (auf deinem Rechner zum Ausprobieren)

```bash
cd zehn-kronen
npm start
```

Beim ersten Start steht das **Admin-Passwort** in der Konsole. Notier es dir, es wird nur einmal angezeigt. Du kannst stattdessen auch ein eigenes festlegen:

```bash
ADMIN_PASSWORD=mein-geheimes-passwort npm start
```

(Unter Windows in der PowerShell: `$env:ADMIN_PASSWORD="mein-geheimes-passwort"; npm start`)

Dann im Browser:

1. `http://localhost:3000/admin` öffnen und mit dem Admin-Passwort anmelden.
2. Eine Partie erstellen. Tempo 1 = echte Spielzeiten, für Tests z. B. 100.
3. Den Einladungslink kopieren und öffnen (oder verschicken). Dort wählt jeder Spieler Name und Passwort.
4. Später meldet man sich einfach unter `http://localhost:3000` mit Name und Passwort an.

## Einstellungen

| Variable | Bedeutung | Standard |
| --- | --- | --- |
| `PORT` | Port des Servers | `3000` |
| `ADMIN_PASSWORD` | Admin-Passwort (überschreibt das gespeicherte) | beim ersten Start erzeugt |
| `DATA_DIR` | Ordner für die Datenbank | `./data` |
| `COOKIE_SECURE` | `1` setzen, sobald die Seite über https läuft | aus |

## Aufbau

```
server/index.js    Webserver, Anmeldung, Admin, Live-Verbindung
server/db.js       Datenbank (SQLite, in Node.js eingebaut)
shared/rules.js    Spielregeln – laufen auf dem Server und im Browser
public/            Spielseite, Admin-Seite, Aussehen
test/              Regeltests (npm test)
```

Der Server ist maßgeblich: Bauaufträge, Ausbildung und Ressourcen werden dort geprüft und gespeichert. Der Browser rechnet mit denselben Regeln nur zur flüssigen Anzeige mit. Alle Abläufe hängen an Zeitstempeln in der Datenbank, deshalb übersteht das Spiel auch einen Neustart des Servers.

## Datensicherung

Alles steckt in `data/zehn-kronen.sqlite`. Server kurz anhalten und die Datei kopieren reicht als Sicherung.

## Online stellen (für die Testpartie)

Kommt in einem eigenen Schritt mit Anleitung: kleiner Linux-Server, Node.js installieren, Spiel als Dienst starten, https einrichten.
