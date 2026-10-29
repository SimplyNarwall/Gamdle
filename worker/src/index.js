// Gamdle stats server: Cloudflare Worker + D1.
// POST /api/submit  { playerId, day, picks: [{ number, picked, wager, pulled }] } -> { score, stats }
// GET  /api/stats?day=N&player=ID -> { stats }
// The score is recomputed here from the raw picks with the same rules file the browser uses.

import { replay, zonedDateString, dayNumberFor, scoreBin, MIN_BIN, MAX_BIN, QUESTIONS_PER_DAY, POOL_SIZE } from '../../js/rules.js';
import { CONFIG } from '../../js/config.js';

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/api/submit') return json(await handleSubmit(request, env), 200, cors);
      if (request.method === 'GET' && url.pathname === '/api/stats') {
        const day = Number(url.searchParams.get('day'));
        if (!Number.isInteger(day) || day < 1) return json({ error: 'bad day' }, 400, cors);
        return json({ stats: await computeStats(env, day, url.searchParams.get('player') || '') }, 200, cors);
      }
      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      return json({ error: e.message }, status, cors);
    }
  },
};

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    Vary: 'Origin',
  };
}

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } });
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

let cache = { at: 0, days: null };
async function getDay(env, day) {
  const stale = Date.now() - cache.at > 5 * 60_000;
  if (!cache.days || stale || !cache.days[day - 1]) {
    const res = await fetch(env.QUESTIONS_URL, { cf: { cacheTtl: 60 } });
    if (!res.ok) throw new Error(`questions.json fetch failed: ${res.status}`);
    cache = { at: Date.now(), days: await res.json() };
  }
  return cache.days[day - 1];
}

async function handleSubmit(request, env) {
  const body = await request.json().catch(() => { throw bad('invalid JSON'); });
  const { playerId, day, picks } = body;

  if (typeof playerId !== 'string' || playerId.length < 8 || playerId.length > 64) throw bad('bad playerId');
  const today = dayNumberFor(zonedDateString(CONFIG.TIME_ZONE), CONFIG.LAUNCH_DATE);
  if (!Number.isInteger(day) || day < 1 || day > today) throw bad('bad day');
  if (!Array.isArray(picks) || picks.length !== QUESTIONS_PER_DAY) throw bad(`need ${QUESTIONS_PER_DAY} picks`);
  const numbers = new Set();
  for (const p of picks) {
    if (!Number.isInteger(p.number) || p.number < 1 || p.number > POOL_SIZE || numbers.has(p.number)) throw bad('bad question number');
    numbers.add(p.number);
    if (p.picked !== null && !(Number.isInteger(p.picked) && p.picked >= 0 && p.picked <= 3)) throw bad('bad pick');
    if (!Number.isInteger(p.wager) || p.wager < 0) throw bad('bad wager');
    if (typeof p.pulled !== 'boolean') throw bad('bad lever flag');
  }

  const puzzle = await getDay(env, day);
  if (!puzzle) throw bad('no puzzle for that day');
  const result = replay({ playerId, day, questions: puzzle.questions, picks });
  // { questionNumber: pickedIndex or null } for the 5 questions this player spun
  const pickedByNumber = Object.fromEntries(picks.map((p) => [p.number, p.picked]));

  // First result per (day, player) wins. Later submissions are ignored.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO results (day, player_id, score, correct_count, busted, picks, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(day, playerId, result.score, result.correctCount, result.bust ? 1 : 0, JSON.stringify(pickedByNumber), Date.now()).run();

  return { score: result.score, stats: await computeStats(env, day, playerId) };
}

async function computeStats(env, day, playerId) {
  const { results } = await env.DB.prepare('SELECT player_id, score, correct_count, busted, picks FROM results WHERE day = ?').bind(day).all();
  const scoreBins = {};
  for (let k = MIN_BIN; k <= MAX_BIN; k++) scoreBins[k] = 0;
  const accuracy = [0, 0, 0, 0, 0, 0];
  // Per question: counts of A, B, C, D and timeouts, among the players who spun that question
  const options = {};
  for (let n = 1; n <= POOL_SIZE; n++) options[n] = [0, 0, 0, 0, 0];
  let busts = 0;
  let myScore = null;

  for (const r of results) {
    if (r.player_id === playerId) myScore = r.score;
    if (r.busted) busts++;
    const k = scoreBin(r.score);
    if (k !== null) scoreBins[k]++;
    accuracy[r.correct_count]++;
    for (const [n, picked] of Object.entries(JSON.parse(r.picks))) options[n][picked === null ? 4 : picked]++;
  }
  // Percentile: share of all players (busts included) strictly below this player.
  const below = myScore === null ? 0 : results.filter((r) => r.score < myScore).length;
  return { players: results.length, busts, below, scoreBins, accuracy, options };
}
