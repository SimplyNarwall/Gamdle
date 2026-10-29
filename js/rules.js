// Pure game rules: no DOM, no storage, no network.
// The stats Worker imports this same file, so client and server always agree on scoring.

export const START_STACK = 5000;
export const QUESTIONS_PER_DAY = 5; // questions each player spins and plays
export const POOL_SIZE = 8;         // questions written per day; the wheel draws 5 of them
export const MILLIONAIRE = 1_000_000;
export const MIN_BIN = -4;
export const MAX_BIN = 5;

/** Wager is a whole number of tokens in [0, stack]. */
export function clampWager(value, stack) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(stack, Math.max(0, n));
}

/** Stack after a question, from the stack S before wagering. See the payout table in the spec. */
export function settle(S, W, correct, pulled, leverWin) {
  if (correct) {
    if (!pulled) return S + W;
    return leverWin ? S + 2 * W : S;
  }
  if (!pulled) return S - W;
  return leverWin ? S : Math.max(0, S - 2 * W);
}

/** 32-bit FNV-1a followed by a murmur3 finalizer, so the low bit is well mixed. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic 50/50 Double or Nothing roll for this player, day and question. */
export function leverWins(playerId, day, number) {
  return (hash32(`${playerId}|${day}|${number}`) & 1) === 1;
}

/** 🪦 = already bust (no choice), - = chose not to pull or bet 0. */
export function leverEmoji(row) {
  if (row.wasBust) return '🪦';
  if (!row.pulled) return '-';
  if (row.correct) return row.leverWin ? '🔥' : '🚫';
  return row.leverWin ? '😮‍💨' : '💀';
}

/**
 * Replays a finished game from the raw inputs. Used by the Worker to recompute scores.
 * picks: in play order, each { number, picked (0-3 or null), wager, pulled }.
 */
export function replay({ playerId, day, questions, picks }) {
  let stack = START_STACK;
  let bust = false;
  const rows = [];
  for (const p of picks) {
    const q = questions.find((x) => x.number === p.number);
    if (!q) throw new Error(`Unknown question ${p.number}`);
    const wager = bust ? 0 : clampWager(p.wager, stack);
    const correct = p.picked !== null && p.picked === q.correct;
    const pulled = !bust && wager > 0 && Boolean(p.pulled);
    const leverWin = pulled ? leverWins(playerId, day, p.number) : null;
    stack = settle(stack, wager, correct, pulled, leverWin);
    rows.push({ number: p.number, picked: p.picked, wager, correct, pulled, leverWin, stackAfter: stack });
    if (stack === 0) bust = true;
  }
  return { score: stack, bust, rows, correctCount: rows.filter((r) => r.correct).length };
}

export const formatTokens = (n) => Math.round(n).toLocaleString('en-US');

/**
 * Marks rows played after the stack hit 0. rows must be in play order (as saved, or from replay).
 */
export function markBusted(rows) {
  let busted = false;
  return rows.map((r) => {
    const marked = { ...r, wasBust: busted };
    if (r.stackAfter === 0) busted = true;
    return marked;
  });
}

/** Share text. rows are in play order, and the emoji stay in that order so the share tells the story of the run. */
export function shareText(day, rows, score) {
  const ordered = markBusted(rows);
  const answers = ordered.map((r) => (r.correct ? '✅' : '❌')).join('');
  const levers = ordered.map(leverEmoji).join('');
  return `🎰 Gamdle #${day} | ${answers} | ${levers} | ${shareScore(score)}`;
}

/** Score segment: "47,500", "Millionaire! (1,215,000)" or "BUST! (0)". */
export function shareScore(score) {
  if (score <= 0) return 'BUST! (0)';
  if (score >= MILLIONAIRE) return `Millionaire! (${formatTokens(score)})`;
  return formatTokens(score);
}

/** Score chart bin: log base 3 around 5,000. Returns null for busts (not charted). */
export function scoreBin(score) {
  if (score <= 0) return null;
  const k = Math.round(Math.log(score / 5000) / Math.log(3));
  return Math.min(MAX_BIN, Math.max(MIN_BIN, k));
}
export const binCenter = (k) => 5000 * 3 ** k;

// ---------- Dates (one global day, in CONFIG.TIME_ZONE) ----------

function zonedParts(timeZone, date) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return { year: +o.year, month: +o.month, day: +o.day, hour: +o.hour % 24, minute: +o.minute, second: +o.second };
}

/** 'YYYY-MM-DD' for the given instant in the given zone. */
export function zonedDateString(timeZone, date = new Date()) {
  const p = zonedParts(timeZone, date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function dayNumberFor(dateStr, launchDate) {
  const [a, b, c] = dateStr.split('-').map(Number);
  const [x, y, z] = launchDate.split('-').map(Number);
  return Math.round((Date.UTC(a, b - 1, c) - Date.UTC(x, y - 1, z)) / 86_400_000) + 1;
}

export function addDays(dateStr, n) {
  const [a, b, c] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(a, b - 1, c + n)).toISOString().slice(0, 10);
}

/** Epoch ms of the next midnight in the zone. Handles daylight saving. */
export function nextMidnight(timeZone, now = new Date()) {
  const p = zonedParts(timeZone, now);
  const wall = Date.UTC(p.year, p.month - 1, p.day + 1); // tomorrow 00:00, written as if it were UTC
  let t = wall;
  for (let i = 0; i < 2; i++) {
    const q = zonedParts(timeZone, new Date(t));
    const offset = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) - Math.floor(t / 1000) * 1000;
    t = wall - offset;
  }
  return t;
}
