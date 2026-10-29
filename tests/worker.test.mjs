// Runs the real stats Worker (worker/src/index.js) against a real SQLite database,
// using a small adapter that behaves like Cloudflare D1. Needs Node 22.5+ (node:sqlite);
// on older Node the tests are skipped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../js/rules.js';
import { CONFIG } from '../js/config.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* skipped below */ }
const skip = DatabaseSync ? false : 'node:sqlite not available (needs Node 22.5+)';

const ORIGIN = 'http://localhost:8000';
const QUESTIONS_URL = 'https://example.test/questions.json';
const days = JSON.parse(readFileSync(new URL('../questions.json', import.meta.url), 'utf8'));
const today = R.dayNumberFor(R.zonedDateString(CONFIG.TIME_ZONE), CONFIG.LAUNCH_DATE);

/** Minimal D1 lookalike: prepare(sql).bind(...).run() / .all() */
function makeEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const bound = (args) => ({
        async run() { const info = stmt.run(...args); return { success: true, meta: { changes: info.changes } }; },
        async all() { return { results: stmt.all(...args) }; },
      });
      return { bind: (...args) => bound(args), ...bound([]) };
    },
  };
  return { DB, ALLOWED_ORIGINS: `https://simplynarwall.github.io,${ORIGIN}`, QUESTIONS_URL };
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === QUESTIONS_URL) return new Response(JSON.stringify(days), { headers: { 'content-type': 'application/json' } });
  return realFetch(url, init);
};
const { default: worker } = await import('../worker/src/index.js');

const submit = (env, body) => worker.fetch(new Request('https://w.test/api/submit', {
  method: 'POST', headers: { Origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body),
}), env);
const stats = (env, day, player) => worker.fetch(new Request(`https://w.test/api/stats?day=${day}&player=${player}`, { headers: { Origin: ORIGIN } }), env);

// Spins questions 7, 2, 5, 1, 8 (three from the pool are never spun)
const q = Object.fromEntries(days[0].questions.map((x) => [x.number, x]));
const gameA = {
  playerId: 'player-aaaaaaaa',
  day: 1,
  picks: [
    { number: 7, picked: q[7].correct, wager: 1000, pulled: false },
    { number: 2, picked: (q[2].correct + 1) % 4, wager: 500, pulled: true },
    { number: 5, picked: null, wager: 0, pulled: false },
    { number: 1, picked: q[1].correct, wager: 2000, pulled: true },
    { number: 8, picked: q[8].correct, wager: 99999, pulled: false }, // over the stack: server clamps it
  ],
};

test('submit recomputes the score on the server and returns stats', { skip: skip || (today < 1 && 'before launch') }, async () => {
  const env = makeEnv();
  const res = await submit(env, gameA);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const body = await res.json();
  const expected = R.replay({ playerId: gameA.playerId, day: 1, questions: days[0].questions, picks: gameA.picks });
  assert.equal(body.score, expected.score);
  assert.equal(body.stats.players, 1);
  assert.equal(body.stats.accuracy[expected.correctCount], 1);
  // only the 5 spun questions have picks; the 3 skipped ones are empty
  assert.equal(body.stats.options[7][q[7].correct], 1);
  assert.equal(body.stats.options[5][4], 1, 'timeout counted separately');
  for (const n of [3, 4, 6]) assert.deepEqual(body.stats.options[n], [0, 0, 0, 0, 0]);
});

test('only the first result per player and day counts', { skip: skip || (today < 1 && 'before launch') }, async () => {
  const env = makeEnv();
  const first = await (await submit(env, gameA)).json();
  const again = { ...gameA, picks: gameA.picks.map((p) => ({ ...p, picked: q[p.number].correct, wager: 0 })) };
  await submit(env, again);
  const s = await (await stats(env, 1, gameA.playerId)).json();
  assert.equal(s.stats.players, 1);
  assert.equal(s.stats.accuracy[first.stats.accuracy.findIndex((c) => c === 1)], 1);
});

test('percentile counts players strictly below, busts included', { skip: skip || (today < 1 && 'before launch') }, async () => {
  const env = makeEnv();
  await submit(env, gameA);
  const bust = {
    playerId: 'player-bbbbbbbb', day: 1,
    picks: [
      { number: 3, picked: (q[3].correct + 1) % 4, wager: 5000, pulled: false },
      { number: 4, picked: null, wager: 0, pulled: false },
      { number: 6, picked: q[6].correct, wager: 0, pulled: false },
      { number: 1, picked: q[1].correct, wager: 0, pulled: false },
      { number: 2, picked: q[2].correct, wager: 0, pulled: false },
    ],
  };
  const res = await (await submit(env, bust)).json();
  assert.equal(res.score, 0);
  assert.equal(res.stats.busts, 1);
  assert.equal(res.stats.below, 0, 'nobody is below a bust');
  const a = await (await stats(env, 1, gameA.playerId)).json();
  assert.equal(a.stats.players, 2);
  assert.equal(a.stats.below, 1, 'player A beat the bust player');
});

test('rejects bad submissions', { skip: skip || (today < 1 && 'before launch') }, async () => {
  const env = makeEnv();
  const cases = [
    { ...gameA, picks: gameA.picks.slice(0, 4) },                                                   // 4 picks
    { ...gameA, picks: gameA.picks.map((p, i) => (i === 0 ? { ...p, number: R.POOL_SIZE + 1 } : p)) }, // number 9
    { ...gameA, picks: gameA.picks.map((p, i) => (i === 1 ? { ...p, number: 7 } : p)) },             // duplicate
    { ...gameA, day: today + 1 },                                                                    // future day
    { ...gameA, playerId: 'x' },                                                                     // bad id
  ];
  for (const c of cases) assert.equal((await submit(env, c)).status, 400, JSON.stringify(c).slice(0, 80));
});

test('CORS preflight and unknown origins', { skip }, async () => {
  const env = makeEnv();
  const pre = await worker.fetch(new Request('https://w.test/api/submit', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const other = await worker.fetch(new Request('https://w.test/api/stats?day=1', { headers: { Origin: 'https://evil.test' } }), env);
  assert.notEqual(other.headers.get('Access-Control-Allow-Origin'), 'https://evil.test');
});
