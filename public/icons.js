// Zehn Kronen – Symbolsatz im Stil des Helden-Menüs (Linien + goldener Schein) und Kopfbilder für Menüs.
// Ersetzt Emojis automatisch durch gezeichnete SVG-Symbole (ein Beobachter, kein Umbau jeder Stelle nötig).
const F = ' class="f"';
const I = {
  castle: `<path${F} d="M4 21V9h3V6h2v3h6V6h2v3h3v12z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4M4 9l1.5-2M20 9l-1.5-2"/>`,
  food: `<path d="M12 22V8"/><path${F} d="M12 8C9.5 7 8.5 5 8.5 2.5 11 3 12 5 12 8zM12 8c2.5-1 3.5-3 3.5-5.5C13 3 12 5 12 8zM12 14c-2.5-1-3.5-3-3.5-5.5C11 9 12 11 12 14zM12 14c2.500-1 3.500-3 3.500-5.500C13 9 12 11 12 14zM12 20c-2.500-1-3.500-3-3.500-5.500C11 15 12 17 12 20zM12 20c2.500-1 3.500-3 3.500-5.500C13 15 12 17 12 20z"/>`,
  wood: `<path${F} d="M6 8h12a4 4 0 0 1 0 8H6z"/><ellipse${F} cx="6" cy="12" rx="2.600" ry="4"/><ellipse cx="6" cy="12" rx="1" ry="1.700"/><path d="M12 10.500h4M11 13.500h6"/>`,
  stone: `<path${F} d="M3 18l3-8 5-4 6 2 4 6-2 5H6z"/><path d="M6 10l5 3 6-5M11 13v8"/>`,
  ore: `<path d="M6 21L15 12"/><path${F} d="M7.500 6C12 3.500 18 5 21 10c-3-2.500-6-3-9-2.500z"/>`,
  coin: `<circle${F} cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.500"/><path d="M12 8.500l3 3.500-3 3.500-3-3.500z"/>`,
  shield: `<path${F} d="M12 3l7.500 3v6c0 5-3.200 8-7.500 9.500C7.700 20 4.500 17 4.500 12V6z"/><path d="M12 7v10M8 11h8"/>`,
  swords: `<path d="M5 4l10 10M19 4L9 14M13 17l4-4M11 17l-4-4M15 14l4 5M9 14l-4 5M3.500 20.500l2-2M20.500 20.500l-2-2"/>`,
  scroll: `<path${F} d="M8 4h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 0 2-2V6a2 2 0 0 0-1-2z"/><path d="M8 4a2 2 0 0 0-2 2v1h3M12 9h4M12 13h4"/>`,
  crown: `<path${F} d="M3 19h18l-1.500-11-4.500 4-3-7-3 7-4.500-4z"/><path d="M3 19v2h18v-2"/>`,
  hands: `<path d="M2 11l5-4 4 1.500 4-1.500 5 4M2 11l3 3M22 11l-3 3"/><path${F} d="M5 14l4 4a1.500 1.500 0 0 0 2-2M9 18l2 2a1.500 1.500 0 0 0 2-2M12 14l-1.500 1.500M13 18l1.500 1.500a1.500 1.500 0 0 0 2-2L13 14"/>`,
  gift: `<rect${F} x="4" y="11" width="16" height="10" rx="1"/><rect${F} x="3" y="7" width="18" height="4" rx="1"/><path d="M12 7v14M12 7C9 2 5 4.500 8.500 7M12 7c3-5 7-2.500 3.500 0"/>`,
  trophy: `<path${F} d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8M9 18h6"/>`,
  sparkle: `<path${F} d="M12 3l2 6 6 3-6 3-2 6-2-6-6-3 6-3z"/>`,
  spiral: `<path d="M12 21a9 9 0 1 1 9-9M12 17a5 5 0 1 1 5-5M12 13a1 1 0 1 1 1-1"/>`,
  clock: `<circle${F} cx="12" cy="12" r="9"/><path d="M12 7v5l3.500 2"/>`,
  hourglass: `<path${F} d="M6 3h12v4l-5 5 5 5v4H6v-4l5-5-5-5z"/><path d="M6 3h12M6 21h12"/>`,
  bolt: `<path${F} d="M13 2L5 13.500h6L10 22l8-11.500h-6z"/>`,
  hammer: `<path d="M4 20l8-8"/><path${F} d="M10 6l3-3 8 8-3 3z"/>`,
  cart: `<path d="M3 4h3l2.500 11h10l2-8H7"/><circle cx="9.500" cy="19.500" r="1.300"/><circle cx="17" cy="19.500" r="1.300"/>`,
  wind: `<path d="M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h7"/>`,
  compass: `<circle${F} cx="12" cy="12" r="9"/><path${F} d="M15.500 8.500l-2 5-5 2 2-5z"/>`,
  bow: `<path d="M6 3c11 3 11 15 0 18M6 3v18M6 12h14M16 8.500l4 3.500-4 3.500"/>`,
  horse: `<path${F} d="M7 21V10a5 5 0 0 1 10 0v11h-3.500V10a1.500 1.500 0 0 0-3 0v11z"/>`,
  calendar: `<rect${F} x="3.500" y="5" width="17" height="16" rx="2"/><path d="M3.500 10h17M8 3v4M16 3v4M8 14h2M12 14h2M8 17.500h2"/>`,
  flag: `<path d="M6 21V3"/><path${F} d="M6 4h12l-3.500 4.500L18 13H6z"/>`,
  helm: `<path${F} d="M5 21V11a7 7 0 0 1 14 0v10z"/><path d="M5 12.500h14M12 12.500V18M9 21v-4M15 21v-4"/>`,
  helmet: `<path${F} d="M4 15a8 8 0 0 1 16 0v1H4z"/><path d="M4 16h16M12 7v9M8 16v4h2.500v-4M16 16v4h-2.500v-4"/>`,
  flame: `<path${F} d="M12 2.500c.5 4 5.500 5.500 5.500 11a5.500 5.500 0 0 1-11 0c0-3.500 2.500-5 3.500-7.500 1 2.500 2 2 2-3.500z"/>`,
  pillars: `<path${F} d="M3 9l9-5.500L21 9z"/><path d="M5.500 9v10M10 9v10M14 9v10M18.500 9v10M3 21h18"/>`,
  house: `<path${F} d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-5h4v5"/>`,
  warn: `<path${F} d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>`,
  book: `<path${F} d="M4 5.500A3 3 0 0 1 7 4h5v16H7a3 3 0 0 0-3 1.500zM20 5.500A3 3 0 0 0 17 4h-5v16h5a3 3 0 0 1 3 1.500z"/>`,
  bell: `<path${F} d="M6 17v-6a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21a2 2 0 0 0 4 0"/>`,
  cog: `<circle${F} cx="12" cy="12" r="3.500"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>`,
  menu: `<path d="M4 6.500h16M4 12h16M4 17.500h16"/>`,
  lock: `<rect${F} x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`,
  cap: `<path${F} d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.500V16c3 3 9 3 12 0v-4.500M22 9v6"/>`,
  leaf: `<path${F} d="M5 19C5 9 11 4 20 4c0 9-5 15-15 15z"/><path d="M5 19l8-8"/>`,
  dagger: `<path${F} d="M12 2l2.500 11h-5z"/><path d="M8 13h8M12 13v7M10 21h4"/>`,
  tower: `<path${F} d="M7 21V9H5V4h3v2h2V4h4v2h2V4h3v5h-2v12z"/><path d="M11 21v-4h2v4"/>`,
  skull: `<path${F} d="M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14z"/><circle cx="9" cy="12" r="1.200"/><circle cx="15" cy="12" r="1.200"/><path d="M10 20v-2M14 20v-2"/>`,
  steps: `<ellipse${F} cx="8" cy="9" rx="2.500" ry="4.500"/><ellipse${F} cx="16" cy="15" rx="2.500" ry="4.500"/>`,
  medal: `<path d="M8 3l4 7 4-7"/><circle${F} cx="12" cy="15.500" r="5"/><path d="M12 13l1 2h2l-1.500 1.500.5 2-2-1-2 1 .5-2L9 15h2z"/>`,
  fist: `<path${F} d="M6 11V7a2 2 0 0 1 4 0 2 2 0 0 1 4 0 2 2 0 0 1 4 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-5-5z"/><path d="M10 7v5M14 7v5"/>`,
  crate: `<path${F} d="M3 8l9-4 9 4v9l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v9"/>`,
  bandage: `<rect${F} x="2.500" y="8.500" width="19" height="7" rx="3.500" transform="rotate(-35 12 12)"/><path d="M10 10.500h.01M14 13.500h.01"/>`,
  bricks: `<rect${F} x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9.500h18M3 14.500h18M9 5v4.500M15 9.500v5M9 14.500V19"/>`,
  pawn: `<circle${F} cx="12" cy="6.500" r="3"/><path${F} d="M10 10l-2 9h8l-2-9z"/><path d="M6 21h12"/>`,
  dove: `<path${F} d="M3 15c5 0 7-3 9-9 1 3 2 4.500 4 5.500 2 1 4 1 5 1-2 5-6 8-12 7z"/>`,
  bag: `<path${F} d="M7 10a5 5 0 0 1 10 0v11H7z"/><path d="M9 6V4h6v2M9 21v-5h6v5"/>`,
  basket: `<path${F} d="M4 10h16l-2 11H6z"/><path d="M8 10l3-6M16 10l-3-6"/>`,
  hand: `<path${F} d="M7 12V6.500a1 1 0 0 1 2 0V11V4a1 1 0 0 1 2 0v7V5a1 1 0 0 1 2 0v6V7a1 1 0 0 1 2 0v8a6 6 0 0 1-6 6 5 5 0 0 1-4-2l-3-4a1.400 1.400 0 0 1 2-2z"/>`,
  pin: `<path${F} d="M12 21s-7-6.500-7-12a7 7 0 0 1 14 0c0 5.500-7 12-7 12z"/><circle cx="12" cy="9" r="2.500"/>`,
  tent: `<path${F} d="M2 20L12 4l10 16z"/><path d="M12 20v-6"/>`,
  search: `<circle${F} cx="10.500" cy="10.500" r="6.500"/><path d="M15.500 15.500L21 21"/>`,
  up: `<path d="M12 20V5M6 11l6-6 6 6"/>`,
  axe: `<path d="M5 21L15 11"/><path${F} d="M12 6c3-3 7-2.500 8.500.500-1 3.500-4 5-7.500 4.500z"/>`,
  sound: `<path${F} d="M4 9.500h4l5-4v13l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.500 6.500a8 8 0 0 1 0 11"/>`,
  note: `<path d="M9 18V5l11-2v13"/><circle${F} cx="6.500" cy="18" r="2.500"/><circle${F} cx="17.500" cy="16" r="2.500"/>`,
  chat: `<path${F} d="M4 5h16v11H10l-5 4v-4H4z"/>`,
  map: `<path${F} d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>`,
  target: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle${F} cx="12" cy="12" r="1.500"/>`,
  rocket: `<path${F} d="M12 2c4 3 5 8 3 14H9c-2-6-1-11 3-14z"/><circle cx="12" cy="9" r="1.500"/><path d="M9 16l-3 3M15 16l3 3M10 21h4"/>`,
  tools: `<path d="M4 20l8-8"/><path${F} d="M10 6l3-3 8 8-3 3z"/><path d="M14 20l6-6"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18"/>`,
  check: `<path d="M5 12.500l4.500 4.500L19 7"/>`
};
// Emoji → Symbol (ohne Variantenwähler U+FE0F)
const MAP = {
  '🌾': 'food', '🪵': 'wood', '🪨': 'stone', '⛏': 'ore', '🪙': 'coin', '💰': 'coin', '🛡': 'shield', '⚔': 'swords', '📜': 'scroll', '🏰': 'castle',
  '👑': 'crown', '🤝': 'hands', '🎁': 'gift', '🏆': 'trophy', '✨': 'sparkle', '🌀': 'spiral', '⏱': 'clock', '⏳': 'hourglass', '⚡': 'bolt',
  '🔨': 'hammer', '🛠': 'tools', '🔧': 'tools', '🏗': 'hammer', '🛒': 'cart', '💨': 'wind', '🧭': 'compass', '🏹': 'bow', '🐎': 'horse', '📅': 'calendar',
  '🏁': 'flag', '🚩': 'flag', '⚑': 'flag', '🦸': 'helm', '🪖': 'helmet', '🔥': 'flame', '🏛': 'pillars', '🏠': 'house', '⚠': 'warn', '📖': 'book',
  '🔔': 'bell', '⚙': 'cog', '☰': 'menu', '🔒': 'lock', '🎓': 'cap', '🍃': 'leaf', '🗡': 'dagger', '🗼': 'tower', '☠': 'skull', '💀': 'skull',
  '🚶': 'steps', '👣': 'steps', '🏅': 'medal', '💪': 'fist', '📦': 'crate', '🩹': 'bandage', '🧱': 'bricks', '♟': 'pawn', '🕊': 'dove', '🚚': 'cart',
  '🎒': 'bag', '🧺': 'basket', '✋': 'hand', '📍': 'pin', '🏕': 'tent', '🔍': 'search', '⬆': 'up', '🪓': 'axe', '🔊': 'sound', '🎵': 'note', '💬': 'chat',
  '🗺': 'map', '🎯': 'target', '🚀': 'rocket'
};
const CLS = { food: 'c-food', wood: 'c-wood', stone: 'c-stone', ore: 'c-ore', coin: 'c-coin', bolt: 'c-bolt', flame: 'c-flame', skull: 'c-skull' };
export const icon = (name, cls = '') => `<svg class="ic ${CLS[name] || ''} ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[name] || I.sparkle}</svg>`;
export const hasIcon = n => !!I[n];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'OPTION', 'SVG', 'TITLE']);
const RX = new RegExp('(' + Object.keys(MAP).map(k => k).join('|') + ')\\uFE0F?', 'g');
const HAS = new RegExp(Object.keys(MAP).join('|'));
function swapText(node) {
  const t = node.nodeValue; if (!t || !HAS.test(t)) return;
  const frag = document.createDocumentFragment(); let last = 0, m; RX.lastIndex = 0;
  while ((m = RX.exec(t))) {
    if (m.index > last) frag.appendChild(document.createTextNode(t.slice(last, m.index)));
    const sp = document.createElement('span'); sp.className = 'ico'; sp.innerHTML = icon(MAP[m[1]]); frag.appendChild(sp); last = m.index + m[0].length;
  }
  if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));
  node.parentNode.replaceChild(frag, node);
}
export function swapIcons(root) {
  if (!root) return;
  if (root.nodeType === 3) { if (root.parentNode && !SKIP.has(root.parentNode.nodeName.toUpperCase())) swapText(root); return; }
  if (root.nodeType !== 1 || SKIP.has(root.nodeName.toUpperCase())) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentNode && !SKIP.has(n.parentNode.nodeName.toUpperCase()) && HAS.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
  const list = []; while (w.nextNode()) list.push(w.currentNode);
  list.forEach(swapText);
}
// Rohstoff-Symbole für CSS (Maske), damit auch ::before-Symbole gezeichnet sind
const maskUrl = name => { const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${I[name].replace(/ class="f"/g, ' fill="#000" fill-opacity=".35"')}</svg>`; return 'url("data:image/svg+xml,' + encodeURIComponent(s) + '")'; };
export function installIcons() {
  if (document.getElementById('icoStyle')) return;
  const st = document.createElement('style'); st.id = 'icoStyle';
  st.textContent = ['food', 'wood', 'stone', 'ore', 'gold'].map(r => `.r-${r}::before{content:'';display:inline-block;width:1.25em;height:1.25em;vertical-align:-.28em;-webkit-mask:${maskUrl(r === 'gold' ? 'coin' : r)} center/contain no-repeat;mask:${maskUrl(r === 'gold' ? 'coin' : r)} center/contain no-repeat}`).join('\n');
  document.head.appendChild(st);
  swapIcons(document.body);
  new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') swapIcons(m.target); else m.addedNodes.forEach(n => swapIcons(n)); } })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
}

// Kopfbilder: gemalte Szenen (SVG) für Menüs – dunkel, mit goldenem Schein
const SCENES = {
  city: `<path d="M0 86 L0 60 L18 60 L18 44 L24 44 L24 36 L30 44 L30 60 L52 60 L52 50 L66 50 L66 34 L72 26 L78 34 L78 50 L96 50 L96 62 L120 62 L120 46 L132 46 L132 62 L170 62 L170 54 L180 54 L180 40 L186 32 L192 40 L192 54 L230 54 L230 64 L260 64 L260 48 L270 48 L270 64 L320 64 L320 86Z"/>`,
  academy: `<path d="M0 86V58h40l10-18 10 18h30V48l20-12 20 12v10h50l8-22 8 22h40V50h20l12-10 12 10v10h50v26z"/><circle cx="262" cy="22" r="9" opacity=".6"/>`,
  train: `<path d="M0 86V64l20-6 12 10 16-24 14 16 22-8 18 20 30-18 22 14 26-22 20 24 40-8 30 10 30-10v28z"/><path d="M40 32v26M44 32l12 5-12 5" fill="none" stroke="currentColor" stroke-width="2" opacity=".7"/>`,
  ally: `<path d="M0 86V62h30l8-12 8 12h24l10-18 10 18h40l10-26 10 26h46l8-14 8 14h36l10-22 10 22h50v24z"/>`,
  more: `<path d="M0 86V66c40-16 80-16 120-4s90 14 130-6 50-6 70 0v30z"/><circle cx="256" cy="30" r="12" opacity=".5"/>`,
  units: `<path d="M0 86V62l30-8 30 8 30-14 30 14 30-8 30 8 30-14 30 14 40-10 30 8v26z"/>`,
  heroes: `<path d="M0 86V60c60-20 120-20 160-6s100 10 160-8v40z"/>`,
  reports: `<path d="M0 86V64h40V50h30v14h50V44h26v20h60V54h40v10h74v22z"/>`
};
export function banner(kind = 'city') {
  return `<svg class="pscene" viewBox="0 0 320 86" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><g fill="currentColor">${SCENES[kind] || SCENES.city}</g></svg>`;
}
