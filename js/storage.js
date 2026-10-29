// Everything kept in localStorage. All reads and writes survive storage being blocked.

const KEYS = {
  player: 'gamdle.player',
  stats: 'gamdle.stats',
  game: (day) => `gamdle.game.${day}`,
};

export function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: play continues, just without saving */
  }
}

export function playerId() {
  let id = read(KEYS.player, null);
  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    write(KEYS.player, id);
  }
  return id;
}

export const loadGame = (day) => read(KEYS.game(day), null);
export const saveGame = (state) => write(KEYS.game(state.day), state);
export function clearGame(day) {
  try { localStorage.removeItem(KEYS.game(day)); } catch { /* ignore */ }
}

/** Day rollover: games from other days are closed. Unfinished ones are never submitted. */
export function clearOtherDays(day) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('gamdle.game.') && k !== KEYS.game(day)) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

// ---------- Personal stats ----------

const EMPTY_STATS = { played: 0, total: 0, best: null, streak: 0, bestStreak: 0, lastDay: null };

export function loadStats() {
  return { ...EMPTY_STATS, ...read(KEYS.stats, {}) };
}

/** Records a finished game once. Returns whether it set a new personal best. */
export function recordGame(day, score) {
  const s = loadStats();
  if (s.lastDay === day) return { stats: s, newBest: false };
  const prevBest = s.best;
  s.played += 1;
  s.total += score;
  s.streak = s.lastDay === day - 1 ? s.streak + 1 : 1;
  s.bestStreak = Math.max(s.bestStreak, s.streak);
  s.lastDay = day;
  s.best = prevBest == null ? score : Math.max(prevBest, score);
  write(KEYS.stats, s);
  return { stats: s, newBest: prevBest != null && score > prevBest };
}

/** Streak as of today: it is broken if the last finished game is older than yesterday. */
export function currentStreak(stats, today) {
  return stats.lastDay != null && stats.lastDay >= today - 1 ? stats.streak : 0;
}
