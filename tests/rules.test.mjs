import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../js/rules.js';

test('payout table', () => {
  const S = 5000, W = 1000;
  assert.equal(R.settle(S, W, true, false, null), 6000);
  assert.equal(R.settle(S, W, true, true, true), 7000);
  assert.equal(R.settle(S, W, true, true, false), 5000);
  assert.equal(R.settle(S, W, false, false, null), 4000);
  assert.equal(R.settle(S, W, false, true, true), 5000);
  assert.equal(R.settle(S, W, false, true, false), 3000);
  assert.equal(R.settle(S, S, false, true, false), 0, 'floored at 0');
});

test('wager clamps to [0, S] and rounds', () => {
  assert.equal(R.clampWager(-5, 100), 0);
  assert.equal(R.clampWager(250, 100), 100);
  assert.equal(R.clampWager(10.6, 100), 11);
  assert.equal(R.clampWager('abc', 100), 0);
});

test('lever roll is deterministic and roughly 50/50', () => {
  assert.equal(R.leverWins('p', 3, 2), R.leverWins('p', 3, 2));
  let wins = 0;
  for (let i = 0; i < 10000; i++) if (R.leverWins(`player-${i}`, 1, 1)) wins++;
  assert.ok(wins > 4800 && wins < 5200, `got ${wins} wins out of 10000`);
});

test('max score is 1,215,000', () => {
  let S = R.START_STACK;
  for (let i = 0; i < 5; i++) S = R.settle(S, S, true, true, true);
  assert.equal(S, 1_215_000);
  assert.equal(R.scoreBin(S), 5);
});

test('score bins', () => {
  assert.equal(R.scoreBin(5000), 0);
  assert.equal(R.scoreBin(15000), 1);
  assert.equal(R.scoreBin(8600), 0);
  assert.equal(R.scoreBin(8700), 1);
  assert.equal(R.scoreBin(1), R.MIN_BIN, 'tiny scores land in the lowest bin');
  assert.equal(R.scoreBin(0), null, 'busts are not charted');
});

test('replay recomputes a game, including bust', () => {
  const questions = [1, 2, 3, 4, 5].map((n) => ({ number: n, correct: 0 }));
  const picks = [
    { number: 3, picked: 1, wager: 5000, pulled: false }, // wrong, all in -> bust
    { number: 1, picked: 0, wager: 9999, pulled: true },   // bust: wager forced to 0
    { number: 2, picked: 0, wager: 0, pulled: false },
    { number: 4, picked: null, wager: 0, pulled: false },
    { number: 5, picked: 0, wager: 0, pulled: false },
  ];
  const r = R.replay({ playerId: 'x', day: 1, questions, picks });
  assert.equal(r.score, 0);
  assert.equal(r.bust, true);
  assert.equal(r.correctCount, 3);
  assert.equal(r.rows[1].wager, 0);
  assert.equal(r.rows[1].pulled, false);
});

test('share text is in play order', () => {
  const rows = [
    { number: 2, correct: false, pulled: true, leverWin: true },
    { number: 1, correct: true, pulled: false },
    { number: 5, correct: false, pulled: true, leverWin: false },
    { number: 3, correct: true, pulled: false },
    { number: 4, correct: true, pulled: true, leverWin: true },
  ];
  // played Q2, Q1, Q5, Q3, Q4
  assert.equal(R.shareText(12, rows, 47500), '🎰 Gamdle #12 | ❌✅❌✅✅ | 😮‍💨-💀-🔥 | 47,500');
});

test('questions played after busting get 🪦, not -', () => {
  // play order: Q3 busts, then Q1, Q2, Q4, Q5 are played bust
  const rows = [
    { number: 3, correct: false, pulled: false, stackAfter: 0 },
    { number: 1, correct: true, pulled: false, stackAfter: 0 },
    { number: 5, correct: false, pulled: false, stackAfter: 0 },
    { number: 2, correct: true, pulled: false, stackAfter: 0 },
    { number: 4, correct: false, pulled: false, stackAfter: 0 },
  ];
  assert.equal(R.shareText(7, rows, 0), '🎰 Gamdle #7 | ❌✅❌✅❌ | -🪦🪦🪦🪦 | BUST! (0)');
});

test('share score for millionaires and busts', () => {
  assert.equal(R.shareScore(1_215_000), 'Millionaire! (1,215,000)');
  assert.equal(R.shareScore(999_999), '999,999');
  assert.equal(R.shareScore(0), 'BUST! (0)');
});

test('day numbers and Chicago midnight', () => {
  assert.equal(R.dayNumberFor('2026-10-27', '2026-10-27'), 1);
  assert.equal(R.dayNumberFor('2026-11-08', '2026-10-27'), 13);
  // 2026-10-27 22:00 CDT (UTC-5) -> next midnight is 05:00 UTC on the 28th
  assert.equal(new Date(R.nextMidnight('America/Chicago', new Date('2026-10-28T03:00:00Z'))).toISOString(), '2026-10-28T05:00:00.000Z');
  // After DST ends (Nov 1), Chicago is UTC-6
  assert.equal(new Date(R.nextMidnight('America/Chicago', new Date('2026-11-03T12:00:00Z'))).toISOString(), '2026-11-04T06:00:00.000Z');
  // The night DST ends: midnight on Nov 2 is 06:00 UTC
  assert.equal(new Date(R.nextMidnight('America/Chicago', new Date('2026-11-01T20:00:00Z'))).toISOString(), '2026-11-02T06:00:00.000Z');
});
