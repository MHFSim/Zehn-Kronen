# Zehn Kronen

Browser-Strategiespiel für bis zu 10 Spieler auf einer gemeinsamen Weltkarte (280 x 280 Felder). Jeder hat eine Burg, baut sie aus, bildet Truppen aus, sammelt Rohstoffe, besiegt Banditen, schließt Bündnisse, greift andere Spieler an und kämpft um den Thron in der Mitte. Eine Partie dauert 8 bis 12 Wochen.

**Spielregeln in Kürze**

- **Ziel:** Wer (allein oder als Bündnis) den Thron 2 Tage hält, gewinnt, oder wer zuerst alle Feinde ausgeschaltet hat. Es gibt kein Zeitlimit.
- **Schutz:** Neue Spieler sind 4 Tage vor Angriffen sicher. Wer selbst angreift, verliert den Schutz sofort.
- **Belagerung:** Greift ein Heer eine Burg oder einen Außenposten an, steht es nach der Ankunft vor dem Ziel: 1:30 Stunden bei einer Burg, 2 Stunden bei einem Außenposten (Spielzeit). Erst danach wird gekämpft. In dieser Zeit bekommen Verteidiger und Bündnis eine Warnung (Banner, Meldung, Push) und können Truppen heimholen oder Verstärkung schicken. **Belagerungshilfe:** Während der Belagerung können weitere Truppen nachrücken – Angreifer samt Verbündeten und Fremde (auch aus anderen Bündnissen) können beiden Seiten helfen („Angreifern helfen“ / „Verteidigern helfen“ im Burg- bzw. Außenpostenmenü). Wer zu spät kommt, wird abgewiesen; Helfer kämpfen mit und ziehen danach heim.
- **Fall einer Burg:** Das erste Mal wird der Besiegte Vasall (7 Tage, 20 % der Erträge gehen an den Sieger, danach 12 Stunden Schutz). Das zweite Mal scheidet er aus. Der Herr kann seinen Vasallen nicht selbst ausschalten, das können nur andere.
- **Bündnisse:** höchstens die Hälfte der Spieler plus eins (bei 10 Spielern 6). Verbündete gewinnen gemeinsam, können sich nicht angreifen und Truppen in die Burg des anderen legen (60 je Rathausstufe). Jeder darf jederzeit austreten (danach 24 Stunden Angriffssperre gegen die früheren Verbündeten), neu gründen oder allein in einem Bündnis sein.
- **Heiligtümer und Thron:** Vier Heiligtümer geben der haltenden Gruppe +15 % auf einen Rohstoff, der Thron +25 % Gold. Sie werden nicht besetzt: Wer mit einem Außenposten am weißen Viereck andockt, hält sie.
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
2. Eine Partie erstellen (Tempo 1 = echte Spielzeiten, für Tests z. B. 100). Sie startet in der **Lobby**.
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
public/            Oberfläche: game.js (Stadt, Karte, Bündnis, Mehr), map.js (3D-Karte mit Three.js, Modelle im Code), city3d.js (3D-Stadt: Mauern, Gebäude, Blasen), art.js (Bilder für Gebäudekarten), sw.js (Push)
test/              Regel-, Welt-, Kriegs- und Push-Tests (npm test)
tools/balance.mjs  Marschzeiten und Beispielkämpfe zum Abstimmen
```

Die Karte entsteht aus dem Seed der Partie und ist auf allen Rechnern gleich. Der Nebel des Krieges wird pro Spieler gespeichert.

Der Server ist maßgeblich: Bauaufträge, Ausbildung und Ressourcen werden dort geprüft und gespeichert. Der Browser rechnet mit denselben Regeln nur zur flüssigen Anzeige mit. Alle Abläufe hängen an Zeitstempeln in der Datenbank, deshalb übersteht das Spiel auch einen Neustart des Servers.

## Forschung
In der Akademie laufen acht Forschungen (Ackerbau, Forstwirtschaft, Steinmetzkunst, Bergbau, Handel, Kriegskunst, Marschordnung, Lasten) mit je fünf Stufen. Es läuft immer nur eine; Stufe n braucht Akademie 2n−1. Sie steigern Erträge, Gold, Kampfkraft, Marschtempo und Beutekapazität. Die Stadtansicht (Holz und Pergament) hat Reiter Wirtschaft, Militär, Verwaltung, Forschung.

## Revier, Außenposten und Bündnislager
Ohne Bündnis gibt es kein Revier. Die Burg hat kein eigenes Revier; den **ersten Außenposten baut der Gründer** an einem der zehn Türme am Kartenrand (Viereck muss das weiße Feld um den Turm berühren). Die Farbe des Reviers wählt der Anführer im Bündnis-Menü (Verwaltung). Gebaut wird nur über den Button „Außenposten“ auf der Karte, die Burg versetzt man nur über „Teleportieren“ (darunter), nicht durch Antippen. **Außenposten gehören immer dem Bündnis** und haben nur eine Stufe (13×13 Felder). Man baut sie nur an das Revier des eigenen Bündnisses, bezahlt aus dem **Bündnislager** (400 Nahrung, 1000 Holz, 1200 Stein, 200 Erz) und schickt mindestens 50 Truppen als Bautrupp, der als Besatzung bleibt. Bündnisse halten höchstens 3 + 2 × Mitglieder Außenposten.

- **Wachen:** Jedes Mitglied kann Truppen in Außenposten des Bündnisses stellen, jederzeit abziehen oder zu einem anderen Außenposten schicken.
- **Lager:** Wer im Bündnisgebiet Felder, Wälder oder Brüche abbaut, füllt das Lager zusätzlich um 25 % der Beute (dem Spieler wird nichts abgezogen). Eigene Rohstoffe kann man jederzeit einzahlen (Bündnis → Revier & Lager).
- **Angriff:** Einen feindlichen Außenposten kann nur angreifen, wer einen eigenen, fertigen Außenposten direkt daneben gebaut hat. Gewinnt der Angreifer, verschwindet der Posten samt Revier.
- **Heiligtümer und Thron** gehören der Gruppe, deren Viereck das weiße Andockfeld berührt (keine Besatzung nötig).
- **Wege:** Mit den Außenposten entstehen Wege (Burg des Gründers → erster Außenposten, dann jeweils zum nächsten bestehenden Punkt). Auf Wegen sind Heere 30 % schneller (`ROAD_SPEED` in `shared/mapgen.js`).
- **Platzieren:** Der Button „Außenposten“ auf der Karte zeigt oben, wie viele Felder, Wälder und Steinbrüche im Viereck liegen. Jedes Feld im fertigen Revier bringt dem Bündnislager automatisch 50 pro Stunde.
- **Shop** (Mehr → Shop, bezahlt mit Gold): *Teleporter* (800 Gold, versetzt die Burg an einen freien Ort im Bündnisgebiet, danach 12 Stunden Pause, mit Lichteffekt) und *Beschleuniger* (5 Min. 15 Gold, 1 Std. 150, 8 Std. 1000), die Bau, Ausbildung oder Forschung verkürzen (⚡ beim jeweiligen Auftrag).

Die Regeln stehen in `shared/outpost.js` und `shared/rules.js` (ITEMS), die Zahlen oben in diesen Dateien.

## Cheats (Admin)
Im Admin-Bereich hat jede Partie einen Block „🛠 Cheats“ (`shared/cheat.js`): Rohstoffe und Gold geben, Lager füllen, Truppen geben, alle Gebäude auf eine Stufe setzen, Bau/Ausbildung/Forschung fertigstellen, Bündnislager füllen, Außenposten sofort fertigbauen, Teleporter und Beschleuniger geben, Schutz aufheben oder setzen, Karte aufdecken, Lager und Vorkommen erneuern und die Zeit vorspulen. Jeder Cheat gilt für einen Spieler oder alle.

## Datensicherung

Der Server legt beim Start und danach täglich eine Sicherung in `data/backups/` ab (die letzten 14 bleiben). Im Admin geht es auch per Knopf. Wiederherstellen: Server anhalten, eine Sicherung als `data/zehn-kronen.sqlite` kopieren, Server starten.

## Impressum und Datenschutz

Unter `/impressum` und `/datenschutz` liegen Vorlagen. Eigene Texte legst du als `data/impressum.html` und `data/datenschutz.html` ab, dann werden diese angezeigt.

## Online stellen

Siehe [docs/BETRIEB.md](docs/BETRIEB.md) (Server, https, Push, Docker).
