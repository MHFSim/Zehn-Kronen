// Zehn Kronen – Spielregeln der Stadt.
// Dieses Modul läuft auf dem Server (maßgeblich) und im Browser (nur für flüssige Anzeige).
// Alle Werte sind Startwerte aus dem Designdokument und werden im Test angepasst.

export const RES = ['food', 'wood', 'stone', 'ore'];
export const RES_DE = { food: 'Nahrung', wood: 'Holz', stone: 'Stein', ore: 'Erz', gold: 'Gold' };

export const B = {
  rathaus:  { name: 'Rathaus', x: 5, y: 5, w: 3, unlock: 1, base: [200, 250, 150, 0], time: 80,
              desc: 'Herz der Stadt. Seine Stufe begrenzt alle anderen Gebäude und bringt Steuergold.' },
  farm:     { name: 'Farm', x: 1, y: 1, w: 2, unlock: 1, base: [0, 60, 20, 0], time: 8, prod: 'food',
              desc: 'Erzeugt Nahrung für Bau, Ausbildung und Forschung. Truppen kosten keinen Unterhalt.' },
  saege:    { name: 'Sägewerk', x: 1, y: 4, w: 2, unlock: 1, base: [50, 30, 20, 0], time: 8, prod: 'wood',
              desc: 'Erzeugt Holz für Gebäude, Speere, Bögen und Rammen.' },
  stein:    { name: 'Steinbruch', x: 1, y: 7, w: 2, unlock: 2, base: [50, 80, 0, 0], time: 10, prod: 'stone',
              desc: 'Erzeugt Stein für Mauer und späte Gebäude.' },
  mine:     { name: 'Erzmine', x: 1, y: 10, w: 2, unlock: 3, base: [60, 100, 40, 0], time: 12, prod: 'ore',
              desc: 'Erzeugt Erz für Schwerter, Reiterei und Forschung.' },
  lager:    { name: 'Lagerhaus', x: 4, y: 1, w: 2, unlock: 2, base: [0, 120, 80, 0], time: 15,
              desc: 'Erhöht die Lagergrenze und den Anteil, den Plünderer nicht mitnehmen können.' },
  kaserne:  { name: 'Kaserne', x: 7, y: 1, w: 2, unlock: 2, base: [80, 150, 60, 0], time: 20, units: ['speer', 'schwert'],
              desc: 'Bildet Speerträger und Schwertkämpfer aus. Jede Stufe verkürzt die Ausbildung.' },
  schiess:  { name: 'Schießstand', x: 10, y: 1, w: 2, unlock: 4, base: [80, 180, 60, 20], time: 25, units: ['bogen'],
              desc: 'Bildet Bogenschützen aus.' },
  stall:    { name: 'Stall', x: 10, y: 4, w: 2, unlock: 6, base: [200, 200, 100, 150], time: 40, units: ['leicht', 'schwer'],
              desc: 'Bildet Reiterei aus. Schwere Reiterei ab Stall Stufe 5.' },
  lazarett: { name: 'Lazarett', x: 10, y: 7, w: 2, unlock: 3, base: [100, 120, 80, 0], time: 20,
              desc: 'Nimmt verwundete Verteidiger auf, solange Plätze frei sind.' },
  akademie: { name: 'Akademie', x: 10, y: 10, w: 2, unlock: 5, base: [150, 200, 150, 80], time: 40,
              desc: 'Hier erforschst du Verbesserungen für Wirtschaft und Militär. Höhere Stufen erlauben höhere Forschungsstufen.' },
  mauer:    { name: 'Mauer & Tor', x: 6, y: 11, w: 2, unlock: 3, base: [0, 100, 200, 0], time: 20,
              desc: 'Stärkt die Verteidigung deiner Burg und vergrößert die Stadtwache, die sie auch ohne Truppen beschützt.' }
};

export const U = {
  speer:   { name: 'Speerträger',      cost: [40, 50, 0, 0],   t: 30, a: 8,  v: 14, l: 30, s: 6,  c: 15, req: 1 },
  schwert: { name: 'Schwertkämpfer',   cost: [50, 0, 0, 40],   t: 40, a: 14, v: 10, l: 35, s: 6,  c: 20, req: 1 },
  bogen:   { name: 'Bogenschützen',    cost: [40, 60, 0, 0],   t: 35, a: 12, v: 8,  l: 22, s: 6,  c: 10, req: 1 },
  leicht:  { name: 'Leichte Reiterei', cost: [80, 0, 0, 60],   t: 60, a: 12, v: 6,  l: 30, s: 12, c: 40, req: 1 },
  schwer:  { name: 'Schwere Reiterei', cost: [120, 0, 0, 120], t: 90, a: 20, v: 14, l: 45, s: 9,  c: 25, req: 5 }
};

// Forschung (Akademie): jede Technik hat 5 Stufen, es wird immer nur eine erforscht.
// per = Wirkung je Stufe, Kosten und Zeit wachsen mit der Stufe, Stufe n braucht Akademie 2n-1.
export const T = {
  ackerbau:    { name: 'Ackerbau',      icon: 'farm',    per: .08, unit: 'Nahrung',   eff: 'food',  base: [60, 120, 80, 0],  time: 50,  desc: 'Mehr Ertrag auf den Feldern: Nahrung' },
  forst:       { name: 'Forstwirtschaft', icon: 'saege', per: .08, unit: 'Holz',      eff: 'wood',  base: [120, 60, 80, 0],  time: 50,  desc: 'Mehr Holz aus dem Sägewerk' },
  steinmetz:   { name: 'Steinmetzkunst', icon: 'stein',  per: .08, unit: 'Stein',     eff: 'stone', base: [100, 120, 60, 0], time: 55,  desc: 'Mehr Stein aus dem Steinbruch' },
  bergbau:     { name: 'Bergbau',        icon: 'mine',   per: .08, unit: 'Erz',       eff: 'ore',   base: [100, 100, 80, 40], time: 60, desc: 'Mehr Erz aus der Mine' },
  handel:      { name: 'Handel',         icon: 'rathaus', per: .10, unit: 'Gold',     eff: 'gold',  base: [150, 100, 100, 60], time: 70, desc: 'Mehr Steuergold' },
  kriegskunst: { name: 'Kriegskunst',    icon: 'kaserne', per: .04, unit: 'Kraft aller Truppen', eff: 'force', base: [200, 150, 100, 150], time: 90, desc: 'Deine Truppen kämpfen stärker, im Angriff und in der Verteidigung' },
  marsch:      { name: 'Marschordnung',  icon: 'stall',  per: .06, unit: 'Marschtempo', eff: 'speed', base: [150, 150, 50, 50], time: 75, desc: 'Deine Heere marschieren schneller' },
  lasten:      { name: 'Tragkraft',      icon: 'lager',  per: .10, unit: 'Traglast',  eff: 'carry', base: [100, 200, 100, 0], time: 65, desc: 'Deine Heere tragen mehr Beute und sammeln mehr' }
};
export const T_MAX = 5;
export const techLv = (S, id) => (S.tech && S.tech[id]) || 0;
export const techMult = (S, eff) => { let m = 1; for (const k in T) if (T[k].eff === eff) m += T[k].per * techLv(S, k); return m; };
export const techReq = lv => Math.max(1, 2 * lv - 1);                       // nötige Akademiestufe für Forschungsstufe lv
export const techCost = (id, lv) => T[id].base.map(c => Math.max(0, Math.round(c * Math.pow(1.7, lv - 1) / 5) * 5));
export const techTime = (id, lv) => T[id].time * 60 * Math.pow(1.7, lv - 1);
export function techBlocker(S, id) {
  const t = T[id]; if (!t) return 'Unbekannte Forschung';
  const lv = techLv(S, id) + 1;
  if (lv > T_MAX) return 'Höchststufe erreicht';
  if (S.lv.akademie < techReq(lv)) return S.lv.akademie ? 'Akademie Stufe ' + techReq(lv) + ' nötig' : 'Erst die Akademie bauen';
  if (S.research) return S.research.id === id ? 'Wird bereits erforscht' : 'Die Akademie forscht schon';
  if (!afford(S, techCost(id, lv))) return 'Nicht genug Ressourcen';
  return '';
}

export const MAX_TRAIN_ORDERS = 3;
export const MAX_TRAIN_COUNT = 1000;

export function freshState(now) {
  const lv = {}; for (const k in B) lv[k] = 0;
  lv.rathaus = 1; lv.farm = 1; lv.saege = 1;
  const troops = {}; for (const k in U) troops[k] = 0;
  return { res: { food: 600, wood: 600, stone: 400, ore: 250, gold: 100 }, lv, queue: [], train: {}, troops, away: {}, wounded: {}, reports: [], nextRep: 1, explored: '', slot: -1, pos: [0, 0], at: now, stationed: {}, protUntil: 0, vassalOf: 0, vassalUntil: 0, out: false, exAllies: {}, feed: [], nextFeed: 1, stats: { attacks: 0, wins: 0, conquests: 0, kills: 0, lost: 0 }, bonus: {}, tech: {}, research: null, items: {}, tpAt: -1e9 };
}

const round5 = n => Math.max(0, Math.round(n / 5) * 5);
export const costOf = (id, t) => B[id].base.map(c => round5(c * Math.pow(1.5, t - 1)));
export const timeOf = (id, t) => B[id].time * Math.pow(1.6, t - 1);
export const capFor = l => Math.round(1500 * Math.pow(1.6, l));
export const cap = S => capFor(S.lv.lager);
export const protectedPct = S => S.lv.lager ? Math.min(40, 20 + S.lv.lager) : 20;
export const prodAt = (id, l) => l <= 0 ? 0 : Math.round(120 * l * Math.pow(1.15, l - 1));
export const homeTroops = S => Object.values(S.troops).reduce((a, b) => a + b, 0);
export const awayTroops = S => Object.values(S.away || {}).reduce((a, b) => a + b, 0);
export const troopCount = S => homeTroops(S) + awayTroops(S);
export const woundedCount = S => Object.values(S.wounded || {}).reduce((a, b) => a + b, 0);
export const lazarettCap = S => 200 * S.lv.lazarett;
export const armySlots = S => 2 + (S.lv.rathaus >= 8 ? 1 : 0) + (S.lv.rathaus >= 14 ? 1 : 0);
export const queuedTroops = S => Object.values(S.train).flat().reduce((a, o) => a + o.count, 0);
export const maxQueues = S => S.lv.rathaus >= 10 ? 2 : 1;
export const inQueue = (S, id) => S.queue.find(q => q.id === id);
export const afford = (S, c) => c.every((v, i) => S.res[RES[i]] >= v);
export const unitTime = (S, u, bid) => U[u].t * Math.pow(0.95, Math.max(0, S.lv[bid] - 1));

// Boni (S.bonus) kommen von gehaltenen Heiligtümern und vom Thron und werden von der Welt gesetzt
export const bonusOf = (S, r) => 1 + ((S.bonus && S.bonus[r]) || 0);
export function rate(S, r) {
  if (r === 'gold') return (5 + 10 * S.lv.rathaus) * bonusOf(S, 'gold') * techMult(S, 'gold');
  const id = Object.keys(B).find(k => B[k].prod === r);
  return (15 + prodAt(id, S.lv[id])) * bonusOf(S, r) * techMult(S, r);
}

export function blocker(S, id) {
  const b = B[id], t = S.lv[id] + 1;
  if (S.lv.rathaus < b.unlock) return 'Freigeschaltet ab Rathaus Stufe ' + b.unlock;
  if (id === 'rathaus' && t > 20) return 'Höchststufe erreicht';
  if (id !== 'rathaus' && t > S.lv.rathaus) return 'Erst das Rathaus auf Stufe ' + t + ' ausbauen';
  if (inQueue(S, id)) return 'Wird bereits gebaut';
  if (S.queue.length >= maxQueues(S)) return 'Alle Bauschleifen belegt';
  if (!afford(S, costOf(id, t))) return 'Nicht genug Ressourcen';
  return '';
}


// Shop: Gegenstände werden mit Gold gekauft und liegen im Beutel (S.items)
export const ITEMS = {
  teleport: { name: 'Teleporter', icon: '🌀', price: 800, desc: 'Versetzt deine Burg an einen freien Ort in eurem Bündnisgebiet. Danach 12 Stunden Pause.' },
  sp5:   { name: 'Beschleuniger 5 Min.', icon: '⚡', price: 15, sec: 300, desc: 'Verkürzt Bau, Ausbildung oder Forschung um 5 Minuten.' },
  sp60:  { name: 'Beschleuniger 1 Std.', icon: '⚡', price: 150, sec: 3600, desc: 'Verkürzt Bau, Ausbildung oder Forschung um 1 Stunde.' },
  sp480: { name: 'Beschleuniger 8 Std.', icon: '⚡', price: 1000, sec: 8 * 3600, desc: 'Verkürzt Bau, Ausbildung oder Forschung um 8 Stunden.' }
};
export const TELEPORT_COOLDOWN = 12 * 3600;
// Zeit eines laufenden Auftrags (Bau, Ausbildung, Forschung) um sec Spielsekunden kürzen
export function speedUp(S, kind, ref, sec) {
  if (kind === 'build') {
    const q = B[ref] && inQueue(S, ref); if (!q) return 'Dieses Gebäude wird nicht gebaut.';
    q.left -= sec; if (q.left <= 0) { S.lv[q.id] = q.target; S.queue = S.queue.filter(x => x !== q); }
    return '';
  }
  if (kind === 'research') {
    const r = S.research; if (!r) return 'Es wird nichts erforscht.';
    r.left -= sec; if (r.left <= 0) { S.tech = S.tech || {}; S.tech[r.id] = r.target; S.research = null; }
    return '';
  }
  if (kind === 'train') {
    const list = S.train[ref]; if (!list || !list.length) return 'Dort wird nichts ausgebildet.';
    let rem = sec;
    while (list.length && rem > 0) {
      const o = list[0];
      if (o.left > rem) { o.left -= rem; rem = 0; break; }
      rem -= o.left; S.troops[o.unit]++; o.count--; o.left = o.per;
      if (o.count <= 0) list.shift();
    }
    if (!list.length) delete S.train[ref];
    return '';
  }
  return 'Das kann man nicht beschleunigen.';
}

// g = vergangene Spielsekunden
function step(S, g) {
  const c = cap(S);
  for (const r of RES) { // über der Lagergrenze wächst nichts mehr; Verbrauch zieht immer ab
    const v = S.res[r], delta = rate(S, r) / 3600 * g;
    if (delta >= 0) { if (v < c) S.res[r] = Math.min(c, v + delta); }
    else S.res[r] = Math.max(0, v + delta);
  }
  S.res.gold += rate(S, 'gold') / 3600 * g;
  for (const q of S.queue) q.left -= g;
  for (const q of S.queue.filter(q => q.left <= 0)) S.lv[q.id] = q.target;
  S.queue = S.queue.filter(q => q.left > 0);
  if (S.research) {
    S.research.left -= g;
    if (S.research.left <= 0) { S.tech = S.tech || {}; S.tech[S.research.id] = S.research.target; S.research = null; }
  }
  for (const bid of Object.keys(S.train)) {
    const list = S.train[bid]; let rem = g;
    while (list.length && rem > 0) {
      const o = list[0];
      if (o.left > rem) { o.left -= rem; rem = 0; break; }
      rem -= o.left; S.troops[o.unit]++; o.count--; o.left = o.per;
      if (o.count <= 0) list.shift();
    }
    if (!list.length) delete S.train[bid];
  }
}

// Bringt den Zustand auf den Zeitpunkt `now` (ms). speed = Spieltempo der Partie.
export function advanceTo(S, now, speed) {
  let gap = Math.min(Math.max(0, now - S.at) / 1000, 60 * 86400) * speed;
  while (gap > 0) {
    const st = Math.min(gap, Math.max(60, gap / 4000));
    step(S, st); gap -= st;
  }
  S.at = now;
  return S;
}

// Befehle des Spielers. Gibt '' bei Erfolg zurück, sonst eine Fehlermeldung.
export function applyCommand(S, cmd) {
  if (!cmd || typeof cmd !== 'object') return 'Ungültiger Befehl';
  const id = cmd.id;
  if (cmd.type === 'upgrade') {
    if (!B[id]) return 'Unbekanntes Gebäude';
    const why = blocker(S, id); if (why) return why;
    const t = S.lv[id] + 1, tm = timeOf(id, t);
    costOf(id, t).forEach((v, i) => S.res[RES[i]] -= v);
    S.queue.push({ id, target: t, left: tm, total: tm });
    return '';
  }
  if (cmd.type === 'cancel') {
    const q = B[id] && inQueue(S, id); if (!q) return 'Kein Bauauftrag';
    costOf(id, q.target).forEach((v, i) => S.res[RES[i]] += v);
    S.queue = S.queue.filter(x => x !== q);
    return '';
  }
  if (cmd.type === 'buy') {
    const it = ITEMS[cmd.item], n = Math.floor(Number(cmd.n) || 1); if (!it) return 'Diesen Gegenstand gibt es nicht';
    if (!(n >= 1 && n <= 99)) return 'Ungültige Anzahl';
    if (S.res.gold < it.price * n) return 'Nicht genug Gold';
    S.res.gold -= it.price * n; S.items = S.items || {}; S.items[cmd.item] = (S.items[cmd.item] || 0) + n; return '';
  }
  if (cmd.type === 'useSpeed') {
    const it = ITEMS[cmd.item]; if (!it || !it.sec) return 'Das ist kein Beschleuniger';
    if (!((S.items || {})[cmd.item] > 0)) return 'Du hast keinen solchen Beschleuniger';
    const why = speedUp(S, String(cmd.kind), String(cmd.ref), it.sec); if (why) return why;
    S.items[cmd.item]--; return '';
  }
  if (cmd.type === 'research') {
    const why = techBlocker(S, cmd.tech); if (why) return why;
    const lv = techLv(S, cmd.tech) + 1, tm = techTime(cmd.tech, lv);
    techCost(cmd.tech, lv).forEach((v, i) => S.res[RES[i]] -= v);
    S.research = { id: cmd.tech, target: lv, left: tm, total: tm };
    return '';
  }
  if (cmd.type === 'cancelResearch') {
    if (!S.research) return 'Es wird nichts erforscht';
    techCost(S.research.id, S.research.target).forEach((v, i) => S.res[RES[i]] += v);
    S.research = null; return '';
  }
  if (cmd.type === 'train') {
    const b = B[id], u = cmd.unit, n = Math.floor(Number(cmd.count));
    if (!b || !b.units || !b.units.includes(u)) return 'Diese Einheit wird hier nicht ausgebildet';
    if (!(n >= 1 && n <= MAX_TRAIN_COUNT)) return 'Ungültige Anzahl';
    if (S.lv[id] < 1) return 'Gebäude noch nicht gebaut';
    if (S.lv[id] < U[u].req) return 'Erst ' + b.name + ' auf Stufe ' + U[u].req + ' ausbauen';
    const list = S.train[id] || [];
    if (list.length >= MAX_TRAIN_ORDERS) return 'Ausbildungsschleife voll';
    const total = U[u].cost.map(c => c * n);
    if (!afford(S, total)) return 'Nicht genug Ressourcen';
    total.forEach((v, i) => S.res[RES[i]] -= v);
    const per = unitTime(S, u, id);
    list.push({ unit: u, count: n, per, left: per });
    S.train[id] = list;
    return '';
  }
  if (cmd.type === 'heal') {
    const u = cmd.unit, n = Math.floor(Number(cmd.count));
    if (!U[u]) return 'Unbekannte Einheit';
    if (S.lv.lazarett < 1) return 'Erst das Lazarett bauen';
    if (!(n >= 1) || n > (S.wounded[u] || 0)) return 'So viele Verwundete gibt es nicht';
    const list = S.train.lazarett || [];
    if (list.length >= MAX_TRAIN_ORDERS) return 'Heilschleife voll';
    const total = U[u].cost.map(c => Math.ceil(c * n * 0.3));
    if (!afford(S, total)) return 'Nicht genug Ressourcen';
    total.forEach((v, i) => S.res[RES[i]] -= v);
    S.wounded[u] -= n; if (!S.wounded[u]) delete S.wounded[u];
    const per = U[u].t * 0.25;
    list.push({ unit: u, count: n, per, left: per, heal: true });
    S.train.lazarett = list;
    return '';
  }
  return 'Unbekannter Befehl';
}
