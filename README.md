# Zehn Kronen

Browser-Strategiespiel für bis zu 10 Spieler auf einer gemeinsamen Weltkarte (200 x 200 Felder). Jeder hat eine Burg, baut sie aus, bildet Truppen aus, sammelt Rohstoffe, besiegt Banditen, schließt Bündnisse, greift andere Spieler an und kämpft um den Thron in der Mitte. Eine Partie dauert 8 bis 12 Wochen.

**Spielregeln in Kürze**

- **Ziel:** Wer (allein oder als Bündnis) den Thron 7 Tage hält, gewinnt. Sonst gewinnt am Ende der Zeit die Gruppe mit den meisten Punkten, oder die letzte, die übrig bleibt.
- **Schutz:** Neue Spieler sind 4 Tage vor Angriffen sicher. Wer selbst angreift, verliert den Schutz sofort.
- **Fall einer Burg:** Das erste Mal wird der Besiegte Vasall (7 Tage, 20 % der Erträge gehen an den Sieger, danach 12 Stunden Schutz). Das zweite Mal scheidet er aus. Der Herr kann seinen Vasallen nicht selbst ausschalten, das können nur andere.
- **Bündnisse:** höchstens die Hälfte der Spieler plus eins (bei 10 Spielern 6). Verbündete gewinnen gemeinsam, können sich nicht angreifen und Truppen in die Burg des anderen legen (60 je Rathausstufe). Jeder darf jederzeit austreten (danach 24 Stunden Angriffssperre gegen die früheren Verbündeten), neu gründen oder allein in einem Bündnis sein.
- **Heiligtümer und Thron:** Vier Heiligtümer geben der haltenden Gruppe +15 % auf einen Rohstoff, der Thron +25 % Gold. Besatzungen bleiben dort, bis sie zurückgerufen werden.
- **Benachrichtigungen:** Auf Wunsch als Push aufs Handy (Angriff, Rückkehr, Bündnis).

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
2. Eine Partie erstellen (Tempo 1 = echte Spielzeiten, für Tests z. B. 100; Länge in Wochen). Sie startet in der **Lobby**.
3. Den Einladungslink kopieren und verschicken. Dort wählt jeder Spieler Name und Passwort.
4. Wenn alle da sind, im Admin **Partie starten**. Ab jetzt läuft die Zeit, und der 4-Tage-Schutz beginnt.
5. Später meldet man sich einfach unter `http://localhost:3000` mit Name und Passwort an.

Im Admin kannst du außerdem pausieren, die Partie beenden, das Tempo oder die Länge ändern, Spieler entfernen, **Passwörter zurücksetzen** und siehst Hinweise auf Mehrfachkonten (gleiche Verbindung). Anleitung für den Dauerbetrieb: [docs/BETRIEB.md](docs/BETRIEB.md).

## Einstellungen

| Variable | Bedeutung | Standard |
| --- | --- | --- |
| `PORT` | Port des Servers | `3000` |
| `ADMIN_PASSWORD` | Admin-Passwort (überschreibt das gespeicherte) | beim ersten Start erzeugt |
| `DATA_DIR` | Ordner für die Datenbank | `./data` |
| `COOKIE_SECURE` | `1` setzen, sobald die Seite über https läuft | aus |
| `TRUST_PROXY` | `1`, wenn ein Proxy (nginx, Caddy) davor steht (echte IP für Mehrfachkonto-Hinweis) | aus |
| `PUSH_SUBJECT` | Kontakt für Push-Dienste, z. B. `mailto:du@example.org` | `mailto:admin@example.com` |

## Aufbau

```
server/index.js    Webserver, Anmeldung, Admin, Live-Verbindung, Push, Datensicherung
server/push.js     Web-Push ohne Zusatzpakete (VAPID + Verschlüsselung nach RFC 8291)
server/db.js       Datenbank (SQLite, in Node.js eingebaut)
shared/rules.js    Stadtregeln – laufen auf dem Server und im Browser
shared/mapgen.js   Kartenerzeugung aus einem Seed und Wegfindung (identisch auf Server und Client)
shared/combat.js   Kampfrechnung, Banditenlager, Stadtwache, Wächter
shared/core.js     Welt, Märsche, Berichte, Meldungen, Chronik, Bündnis-Hilfen
shared/war.js      Angriffe auf Burgen, Vasallen, Ausscheiden, Thron, Heiligtümer, Spähen, Punkte, Spielende
shared/social.js   Bündnisse: gründen, einladen, anfragen, austreten, Chat
shared/world.js    Ablauf der Partie (Zeit, Ereignisse), Befehle, Sicht je Spieler
public/            Oberfläche: game.js (Stadt, Karte, Bündnis, Mehr), map.js (PixiJS-Karte), art.js (Bilder), sw.js (Push)
test/              Regel-, Welt-, Kriegs- und Push-Tests (npm test)
tools/balance.mjs  Marschzeiten und Beispielkämpfe zum Abstimmen
```

Die Karte entsteht aus dem Seed der Partie und ist auf allen Rechnern gleich. Der Nebel des Krieges wird pro Spieler gespeichert.

Der Server ist maßgeblich: Bauaufträge, Ausbildung und Ressourcen werden dort geprüft und gespeichert. Der Browser rechnet mit denselben Regeln nur zur flüssigen Anzeige mit. Alle Abläufe hängen an Zeitstempeln in der Datenbank, deshalb übersteht das Spiel auch einen Neustart des Servers.

## Datensicherung

Der Server legt beim Start und danach täglich eine Sicherung in `data/backups/` ab (die letzten 14 bleiben). Im Admin geht es auch per Knopf. Wiederherstellen: Server anhalten, eine Sicherung als `data/zehn-kronen.sqlite` kopieren, Server starten.

## Impressum und Datenschutz

Unter `/impressum` und `/datenschutz` liegen Vorlagen. Eigene Texte legst du als `data/impressum.html` und `data/datenschutz.html` ab, dann werden diese angezeigt.

## Online stellen

Siehe [docs/BETRIEB.md](docs/BETRIEB.md) (Server, https, Push, Docker).
