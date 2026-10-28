// Gemeinsame Hilfen für die Tests: Marschbefehle ohne Held bekommen automatisch einen freien Helden (die Oberfläche schickt immer einen mit).
import { HERO_IDS, heroBusy } from '../shared/heroes.js';
export const heroShim = raw => (match, players, player, cmd, now) => {
  if (cmd && cmd.type === 'march' && cmd.from == null && !cmd.hero) {
    const w = match.world, id = HERO_IDS.find(h => !heroBusy(w, player.id, h)); cmd = { ...cmd, hero: id };
  }
  return raw(match, players, player, cmd, now);
};
