// Zehn Kronen – Bündnisse: gründen, einladen, anfragen, beitreten, austreten, Chat.
// Größe: höchstens die Hälfte der Spieler plus eins (bei 10 Spielern also 6). Jeder darf jederzeit austreten,
// ein neues Bündnis gründen oder allein in einem sein.
import { allianceCap, LEAVE_LOCK, MAX_CHAT, byId, allianceOf, removeMember, regroup, note, chron } from './core.js';
import { releaseAll } from './war.js';

const NAME_RE = /^[\p{L}\p{N} _-]{3,20}$/u, TAG_RE = /^[\p{L}\p{N}]{2,4}$/u;
const lower = s => String(s || '').trim().toLowerCase();

function join(ctx, pid, al) {
  const w = ctx.match.world, p = byId(ctx.players, pid);
  al.members.push(pid);
  regroup(w, 'p' + pid, 'a' + al.id);
  w.pending = w.pending.filter(x => x.pid !== pid);
  chron(ctx, p.name + ' ist dem Bündnis „' + al.name + '“ beigetreten.');
  for (const id of al.members) if (id !== pid) note(ctx, id, 'ally', 'Neues Mitglied', p.name + ' ist deinem Bündnis beigetreten.');
}
// Austritt oder Rauswurf: Truppen an fremden Orten gehen nach Hause, früheren Verbündeten darf man 24 Stunden nicht angreifen
function leave(ctx, pid, how) {
  const w = ctx.match.world, a = allianceOf(w, pid), me = byId(ctx.players, pid); if (!a || !me) return;
  releaseAll(ctx, pid);
  for (const id of a.members) if (id !== pid) {
    const o = byId(ctx.players, id); if (!o) continue;
    me.state.exAllies[id] = w.gt + LEAVE_LOCK; o.state.exAllies[pid] = w.gt + LEAVE_LOCK;
  }
  const others = a.members.filter(x => x !== pid);
  removeMember(ctx, pid);
  chron(ctx, me.name + (how === 'kick' ? ' wurde aus dem Bündnis „' + a.name + '“ geworfen.' : ' hat das Bündnis „' + a.name + '“ verlassen.'));
  for (const id of others) note(ctx, id, 'ally', how === 'kick' ? 'Mitglied entfernt' : 'Mitglied ausgetreten', me.name + (how === 'kick' ? ' wurde aus dem Bündnis entfernt.' : ' hat das Bündnis verlassen.'));
  if (how === 'kick') note(ctx, pid, 'ally', 'Aus dem Bündnis entfernt', 'Du wurdest aus „' + a.name + '“ entfernt.');
}
export const leaveAlliance = (ctx, pid, how) => leave(ctx, pid, how);

// Gibt '' bei Erfolg zurück, sonst die Fehlermeldung
export function socialCommand(ctx, me, cmd) {
  const w = ctx.match.world, { players } = ctx, gt = w.gt, mine = allianceOf(w, me.id), cap = allianceCap(players.length);
  switch (cmd.type) {
    case 'allyCreate': {
      if (mine) return 'Du bist schon in einem Bündnis. Tritt zuerst aus.';
      const name = String(cmd.name || '').replace(/\s+/g, ' ').trim(), tag = String(cmd.tag || '').trim().toUpperCase();
      if (!NAME_RE.test(name)) return 'Name: 3 bis 20 Zeichen (Buchstaben, Ziffern, Leerzeichen, _ und -).';
      if (!TAG_RE.test(tag)) return 'Kürzel: 2 bis 4 Buchstaben oder Ziffern.';
      for (const id in w.alliances) { const a = w.alliances[id]; if (lower(a.name) === lower(name)) return 'Diesen Bündnisnamen gibt es schon.'; if (a.tag === tag) return 'Dieses Kürzel ist schon vergeben.'; }
      const id = w.nextAl++;
      w.alliances[id] = { id, name, tag, leader: me.id, members: [me.id], chat: [], nextMsg: 1, created: gt };
      regroup(w, 'p' + me.id, 'a' + id);
      w.pending = w.pending.filter(x => x.pid !== me.id);
      chron(ctx, me.name + ' hat das Bündnis „' + name + '“ gegründet.');
      return '';
    }
    case 'allyInvite': {
      if (!mine) return 'Du bist in keinem Bündnis.';
      const t = players.find(p => lower(p.name) === lower(cmd.name));
      if (!t) return 'Diesen Spieler gibt es nicht.';
      if (t.id === me.id || mine.members.includes(t.id)) return 'Dieser Spieler ist schon in deinem Bündnis.';
      if (t.state.out) return 'Dieser Spieler ist ausgeschieden.';
      if (mine.members.length >= cap) return 'Dein Bündnis ist voll (höchstens ' + cap + ' Mitglieder).';
      if (w.pending.some(x => x.al === mine.id && x.pid === t.id && x.kind === 'invite')) return 'Dieser Spieler ist schon eingeladen.';
      w.pending.push({ id: w.nextPend++, al: mine.id, pid: t.id, kind: 'invite', by: me.id, t: gt });
      note(ctx, t.id, 'ally', 'Einladung in ein Bündnis', me.name + ' lädt dich in das Bündnis „' + mine.name + '“ ein.');
      return '';
    }
    case 'allyRequest': {
      if (mine) return 'Du bist schon in einem Bündnis.';
      const a = w.alliances[Number(cmd.al)]; if (!a) return 'Dieses Bündnis gibt es nicht.';
      if (a.members.length >= cap) return 'Dieses Bündnis ist voll (höchstens ' + cap + ' Mitglieder).';
      if (w.pending.some(x => x.al === a.id && x.pid === me.id && x.kind === 'request')) return 'Du hast schon angefragt.';
      w.pending.push({ id: w.nextPend++, al: a.id, pid: me.id, kind: 'request', by: me.id, t: gt });
      for (const id of a.members) note(ctx, id, 'ally', 'Beitrittsanfrage', me.name + ' möchte deinem Bündnis „' + a.name + '“ beitreten.');
      return '';
    }
    case 'allyAnswer': {
      const pen = w.pending.find(x => x.id === Number(cmd.id)); if (!pen) return 'Diese Anfrage gibt es nicht mehr.';
      const a = w.alliances[pen.al]; if (!a) { w.pending = w.pending.filter(x => x !== pen); return 'Dieses Bündnis gibt es nicht mehr.'; }
      const allowed = pen.kind === 'invite' ? pen.pid === me.id : a.members.includes(me.id);
      if (!allowed) return 'Das kannst du nicht beantworten.';
      if (!cmd.accept) { w.pending = w.pending.filter(x => x !== pen); return ''; }
      const j = byId(players, pen.pid); if (!j || j.state.out) { w.pending = w.pending.filter(x => x !== pen); return 'Dieser Spieler ist nicht mehr dabei.'; }
      if (allianceOf(w, j.id)) { w.pending = w.pending.filter(x => x !== pen); return pen.kind === 'invite' ? 'Du bist schon in einem Bündnis. Tritt zuerst aus.' : j.name + ' ist schon in einem Bündnis.'; }
      if (a.members.length >= cap) return 'Das Bündnis ist voll (höchstens ' + cap + ' Mitglieder).';
      join(ctx, j.id, a);
      if (pen.kind === 'request') note(ctx, j.id, 'ally', 'Aufgenommen', 'Du bist jetzt im Bündnis „' + a.name + '“.');
      return '';
    }
    case 'allyLeave': {
      if (!mine) return 'Du bist in keinem Bündnis.';
      leave(ctx, me.id, 'leave'); return '';
    }
    case 'allyKick': {
      if (!mine || mine.leader !== me.id) return 'Nur der Anführer kann Mitglieder entfernen.';
      const id = Number(cmd.pid); if (id === me.id || !mine.members.includes(id)) return 'Dieses Mitglied gibt es nicht.';
      leave(ctx, id, 'kick'); return '';
    }
    case 'allyColor': {
      if (!mine || mine.leader !== me.id) return 'Nur der Anführer kann die Farbe wählen.';
      const c = String(cmd.color || '').toLowerCase(); if (!/^#[0-9a-f]{6}$/.test(c)) return 'Ungültige Farbe.';
      mine.color = c; return '';
    }
    case 'allyLead': {
      if (!mine || mine.leader !== me.id) return 'Nur der Anführer kann die Führung abgeben.';
      const id = Number(cmd.pid); if (id === me.id || !mine.members.includes(id)) return 'Dieses Mitglied gibt es nicht.';
      mine.leader = id; note(ctx, id, 'ally', 'Du führst das Bündnis', me.name + ' hat dir die Führung von „' + mine.name + '“ übergeben.'); return '';
    }
    case 'allyChat': {
      if (!mine) return 'Du bist in keinem Bündnis.';
      const text = String(cmd.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!text) return 'Leere Nachricht.';
      const nowT = Math.round(ctx.realT || ctx.now || Date.now()), last = [...mine.chat].reverse().find(m => m.pid === me.id);
      if (last && nowT - last.t < 800) return 'Bitte etwas langsamer.';
      mine.chat.push({ id: mine.nextMsg++, t: nowT, pid: me.id, name: me.name, text });
      if (mine.chat.length > MAX_CHAT) mine.chat.splice(0, mine.chat.length - MAX_CHAT);
      return '';
    }
    default: return 'Unbekannter Befehl';
  }
}
