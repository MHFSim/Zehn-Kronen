#!/usr/bin/env python3
"""Baut die Testversion für den Chat: eine einzige HTML-Datei mit nachgebildetem Server (tools/sim.js).
Aufruf: python3 tools/build-test.py [ausgabe.html]"""
import re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / 'zehn-kronen-test.html'
rd = lambda p: (root / p).read_text(encoding='utf-8')

def must_sub(pattern, repl, text, flags=0, count=1):
    new, n = re.subn(pattern, repl, text, count=count, flags=flags)
    if n == 0:
        raise SystemExit('Muster nicht gefunden: ' + pattern[:70])
    return new

def must_rep(old, new, text):
    if old not in text:
        raise SystemExit('Text nicht gefunden: ' + old[:70])
    return text.replace(old, new)

# --- Module: jedes in eigenen Gültigkeitsbereich, Imports/Exports umgeschrieben ---
def wrap(name, src):
    exports = []
    def imp(m):
        mod = re.search(r"/?([\w-]+)\.js$", m.group(2)).group(1)
        return 'const {' + m.group(1) + '} = __M.' + mod + ';'
    src = re.sub(r"import\s*\{(.*?)\}\s*from\s*'([^']+)';", imp, src, flags=re.S)
    def ex(m):
        exports.append(m.group(2))
        if m.group(1) != 'function':
            for e in re.finditer(r",\s*([A-Za-z_]\w*)\s*=\s", re.split(r'[(\[{]|=>', m.group(0).split('\n')[0])[0]):
                exports.append(e.group(1))
        return m.group(0).replace('export ', '', 1)
    src = re.sub(r"^export (const|let|function|class) ([A-Za-z_]\w*)[^\n]*", ex, src, flags=re.M)
    exports = list(dict.fromkeys(exports))
    return f"__M.{name} = (() => {{\n{src}\nreturn {{{', '.join(exports)}}};\n}})();"

import os
mods = []
for name, path in [('mapgen', 'shared/mapgen.js'), ('rules', 'shared/rules.js'), ('heroes', 'shared/heroes.js'), ('combat', 'shared/combat.js'), ('core', 'shared/core.js'), ('outpost', 'shared/outpost.js'), ('war', 'shared/war.js'), ('social', 'shared/social.js'), ('world', 'shared/world.js'), ('cheat', 'shared/cheat.js'),
                   ('art', 'public/art.js'), ('icons', 'public/icons.js'), ('heropics', 'public/heropics.js'), ('heroart', 'public/heroart.js'), ('rockdata', 'public/rockdata.js'), ('vikingdata', 'public/vikingdata.js'), ('riderdata', 'public/riderdata.js'), ('map', 'public/map.js'), ('audiodata', 'public/audiodata.js'), ('sound', 'public/sound.js'), ('city3d', 'public/city3d.js')]:
    if (root / path).exists():
        msrc = rd(path)
        if name == 'sound':   # Musik: die Stücke werden klein umkodiert und eingebettet (die Testdatei ist eine einzelne Seite)
            import subprocess, base64, tempfile
            for tr in re.findall(r"'(/public/audio/[\w.-]+\.mp3)'", msrc):
                tmp = tempfile.mktemp(suffix='.mp3')
                subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(root / tr[1:]), '-vn', '-map_metadata', '-1', '-ac', '1', '-b:a', '56k', tmp], check=True)
                msrc = msrc.replace("'" + tr + "'", "'data:audio/mpeg;base64," + base64.b64encode(open(tmp, 'rb').read()).decode() + "'"); os.remove(tmp)
        mods.append(wrap(name, msrc))
sim = wrap('sim', rd('tools/sim.js'))

# --- Spiel: Anpassungen für die Testversion ---
game = rd('public/game.js')
game = must_rep("const invite = params.get('einladung') || '';", "let invite = window.zkSimInvite();", game)
game = must_rep("  if (joinMode) history.replaceState(null, '', '/');\n", '', game)
game = game.replace("location.href = '/'", 'location.reload()')
game = game.replace("wm = new WorldMap(THREE, $('stage'));", "wm = new WorldMap(THREE, $('stage')); window.__wm = wm; window.__sel = (h, k) => selectMap(h, k); window.__snd = snd;", 1)
game = wrap('game', game)

# --- Admin: Seite und Skript übernehmen ---
adm = rd('public/admin.html')
a_css = re.search(r'<style>(.*?)</style>', adm, re.S).group(1)
a_css = a_css.replace('header{', '.ahead{').replace('header h1{', '.ahead h1{').replace('header span{', '.ahead span{')
a_body = re.search(r'<div class="wrap">(.*?)</div>\n<script>', adm, re.S).group(1)
a_body = a_body.replace('<header>', '<header class="ahead">')
a_body = must_rep('Das Passwort steht beim ersten Serverstart in der Konsole, oder du setzt es mit ADMIN_PASSWORD.',
                  'Testversion: Das Passwort ist „admin“.', a_body)
a_js = re.search(r'<script>(.*?)</script>', adm, re.S).group(1)
a_js = must_rep("const link = location.origin + '/?einladung=' + m.invite;", "const link = m.invite;", a_js)
a_js = must_rep('<code>${esc(link)}</code><button class="btn small" data-act="copy" data-link="${esc(link)}" type="button">Kopieren</button>',
                '<code>Einladung: ${esc(link)}</code><button class="btn small" data-act="open" data-link="${esc(link)}" type="button">Als neuer Spieler beitreten</button>', a_js)
a_js = must_sub(r"if \(act === 'copy'\) \{.*?return;\n  \}", "if (act === 'open') { window.zkSwap('game', el.dataset.link); return; }", a_js, flags=re.S)
a_js = a_js.replace("\nload();\nsetInterval", "\nwindow.zkAdminLoad = load;\nload();\nsetInterval")

# --- Spiel-Seite (index.html): Stil und Auth-Block ---
idx = rd('public/index.html')
g_css = '\n'.join(re.findall(r'<style>(.*?)</style>', idx, re.S))
auth_html = re.search(r'(<main class="auth".*?</main>)', idx, re.S).group(1)
auth_html = must_rep('<p class="note" id="authNote">', '<p class="note" id="simNote">Testversion im Chat: Der Server wird in deinem Browser nachgebildet. Mit „Admin“ unten rechts erstellst du Partien und lädst weitere Spieler ein.</p>\n    <p class="note" id="authNote">', auth_html)
auth_html = re.sub(r'<p class="note legal">.*?</p>\n\s*', '', auth_html, flags=re.S)
game_html = re.search(r'(<div id="game" hidden>.*?</nav>\n</div>)', idx, re.S).group(1)

base_css = rd('public/style.css')

page = f'''<title>Zehn Kronen Testversion</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IM+Fell+English+SC&family=Alegreya+Sans:wght@400;500;700&display=swap">
<style>
{base_css}
{g_css}
/* Testversion: Umschalter und Admin-Ebene */
.hud{{right:max(112px,env(safe-area-inset-right,0px))}}
.swap{{position:fixed;z-index:30;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(var(--nav) + 12px);background:var(--panel-2);border:1px solid var(--brass);color:var(--ink);border-radius:999px;padding:7px 14px;font-weight:700;font-size:13px}}
body:not(.admin-on) .swap{{display:none}}
#zkTools{{display:none}}
body.dev-tools #zkTools{{display:block}}
#adminView .wrap{{padding-bottom:88px}}
#adminView .invite code{{flex:1 1 100%}}
#adminView th,#adminView td{{padding:6px 6px}}
#adminView td:last-child{{white-space:nowrap}}
#adminView{{position:fixed;inset:0;z-index:20;overflow:auto;background:var(--bg);touch-action:pan-y;-webkit-user-select:text;user-select:text;padding-top:env(safe-area-inset-top,0px)}}
{a_css}
</style>

{auth_html}

{game_html}

<div id="adminView" hidden>
<div class="wrap">{a_body}
  <section class="block" id="wipeBox"><h3>Testdaten</h3><p class="note">Löscht alle Partien und Spieler dieser Testversion und beginnt neu.</p><div class="row"><button class="btn ghost" id="wipe" type="button">Alles zurücksetzen</button></div></section>
</div>
</div>
<button class="swap" id="swap" type="button">Admin</button>

<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script type="module">
const __M = {{}};
{chr(10).join(mods)}

/* ===== Nachbildung des Node.js-Servers (nur Testversion) ===== */
{sim}

/* ===== Spiel ===== */
{game}

/* ===== Admin ===== */
(function () {{
{a_js}
const wipe = document.getElementById('wipe'); let armedWipe = false;
wipe.addEventListener('click', () => {{
  if (!armedWipe) {{ armedWipe = true; wipe.textContent = 'Wirklich alles löschen'; wipe.className = 'btn danger'; setTimeout(() => {{ armedWipe = false; wipe.textContent = 'Alles zurücksetzen'; wipe.className = 'btn ghost'; }}, 4000); return; }}
  window.zkWipe();
}});
}})();

/* ===== Umschalter Spiel / Admin ===== */
window.zkShow = v => {{
  document.getElementById('adminView').hidden = v !== 'admin';
  document.body.classList.toggle('admin-on', v === 'admin');
  document.getElementById('swap').textContent = v === 'admin' ? 'Zum Spiel' : 'Admin';
  if (v === 'admin' && window.zkAdminLoad) window.zkAdminLoad();
}};
document.getElementById('swap').addEventListener('click', () => window.zkSwap(document.getElementById('adminView').hidden ? 'admin' : 'game'));
window.zkShow(window.zkViewPref());
</script>
'''
out.write_text(page, encoding='utf-8')
print('geschrieben:', out, len(page) // 1024, 'KB')
