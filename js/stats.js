// The only network code that runs after load: submitting a finished game and reading worldwide stats.

import { CONFIG } from './config.js';
import { read, write } from './storage.js';
import { settle, scoreBin, MIN_BIN, MAX_BIN, START_STACK, QUESTIONS_PER_DAY } from './rules.js';

const PENDING_KEY = 'gamdle.pending';

async function request(path, init = {}) {
  if (!CONFIG.STATS_URL) throw new Error('No stats server configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.STATS_TIMEOUT_MS);
  try {
    const res = await fetch(CONFIG.STATS_URL + path, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`Stats server ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Pending submissions (kept until the server accepts them) ----------

const pendingList = () => read(PENDING_KEY, []);
export const getPending = (day) => pendingList().find((p) => p.day === day) || null;
export function queuePending(sub) {
  write(PENDING_KEY, [...pendingList().filter((p) => p.day !== sub.day), sub]);
}
export function removePending(day) {
  write(PENDING_KEY, pendingList().filter((p) => p.day !== day));
}

/** Submits and returns worldwide stats for that day. */
export async function submit(sub) {
  const data = await request('/api/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sub),
  });
  removePending(sub.day);
  return data.stats;
}

export async function fetchStats(day, playerId) {
  const data = await request(`/api/stats?day=${day}&player=${encodeURIComponent(playerId)}`);
  return data.stats;
}

/** On load: quietly resend results from earlier days that never reached the server. */
export function retryPending(exceptDay) {
  for (const sub of pendingList()) {
    if (sub.day !== exceptDay) submit(sub).catch(() => {});
  }
}

// ---------- Fake stats for local testing (?mockstats) ----------

export function mockStats(state, puzzle, playerCount = 240) {
  const scoreBins = {};
  for (let k = MIN_BIN; k <= MAX_BIN; k++) scoreBins[k] = 0;
  const accuracy = [0, 0, 0, 0, 0, 0];
  const options = {};
  for (const q of puzzle.questions) options[q.number] = [0, 0, 0, 0, 0];
  const scores = [];

  const addPlayer = (score, rows) => {
    scores.push(score);
    const k = scoreBin(score);
    if (k !== null) scoreBins[k]++;
    accuracy[rows.filter((r) => r.correct).length]++;
    for (const r of rows) options[r.number][r.picked === null ? 4 : r.picked]++;
  };

  for (let i = 0; i < playerCount; i++) {
    let stack = START_STACK;
    const rows = [];
    // each fake player spins a random 5 of the pool
    const drawn = [...puzzle.questions].sort(() => Math.random() - 0.5).slice(0, QUESTIONS_PER_DAY);
    for (const q of drawn) {
      const bust = stack === 0;
      const frac = [0, 0.1, 0.25, 0.5, 0.5, 1][Math.floor(Math.random() * 6)];
      const wager = bust ? 0 : Math.round(stack * frac);
      const timeout = Math.random() < 0.04;
      const correct = !timeout && Math.random() < 0.62;
      const others = [0, 1, 2, 3].filter((x) => x !== q.correct);
      const picked = timeout ? null : correct ? q.correct : others[Math.floor(Math.random() * 3)];
      const pulled = wager > 0 && Math.random() < 0.35;
      stack = settle(stack, wager, correct, pulled, pulled ? Math.random() < 0.5 : null);
      rows.push({ number: q.number, picked, correct });
    }
    addPlayer(stack, rows);
  }
  addPlayer(state.stack, state.completed);

  return {
    players: scores.length,
    busts: scores.filter((s) => s === 0).length,
    below: scores.filter((s) => s < state.stack).length,
    scoreBins,
    accuracy,
    options,
  };
}
