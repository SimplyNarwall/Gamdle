#!/usr/bin/env node
// Validates questions.json. Run before every push: npm run check
// Exits with code 1 and lists every problem if anything is wrong.

import { readFileSync } from 'node:fs';
import { CONFIG } from '../js/config.js';
import { addDays, zonedDateString, dayNumberFor, POOL_SIZE } from '../js/rules.js';

const file = process.argv[2] ?? new URL('../questions.json', import.meta.url);
const errors = [];
const err = (msg) => errors.push(msg);

let days;
try {
  days = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`✗ Could not read questions.json: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(days)) {
  console.error('✗ questions.json must be an array of days');
  process.exit(1);
}

const norm = (s) => String(s).trim().toLowerCase();
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';

days.forEach((d, i) => {
  const where = `Day #${i + 1} (index ${i})`;
  if (d.day !== i + 1) err(`${where}: "day" is ${d.day}, expected ${i + 1}`);
  const expectedDate = addDays(CONFIG.LAUNCH_DATE, i);
  if (d.date !== expectedDate) err(`${where}: "date" is ${d.date}, expected ${expectedDate}`);
  if (!Array.isArray(d.questions) || d.questions.length !== POOL_SIZE) {
    err(`${where}: must have exactly ${POOL_SIZE} questions (got ${d.questions?.length ?? 0})`);
    return;
  }
  const numbers = d.questions.map((q) => q.number).sort((a, b) => a - b);
  const expected = Array.from({ length: POOL_SIZE }, (_, i) => i + 1);
  if (numbers.join() !== expected.join()) err(`${where}: question numbers must be 1 to ${POOL_SIZE} once each (got ${numbers.join(', ')})`);

  const categories = new Map();
  d.questions.forEach((q, j) => {
    const qw = `${where} Q${q.number ?? `[${j}]`}`;
    if (!nonEmpty(q.category)) err(`${qw}: empty category`);
    if (!nonEmpty(q.prompt)) err(`${qw}: empty prompt`);
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      err(`${qw}: must have exactly 4 options`);
    } else {
      q.options.forEach((o, k) => { if (!nonEmpty(o)) err(`${qw}: option ${'ABCD'[k]} is empty`); });
      const seen = new Set(q.options.map(norm));
      if (seen.size !== 4) err(`${qw}: two options are identical`);
    }
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) err(`${qw}: "correct" must be 0 to 3 (got ${q.correct})`);
    if (nonEmpty(q.category)) {
      const key = norm(q.category);
      if (categories.has(key)) err(`${qw}: category "${q.category}" is also used by Q${categories.get(key)} (the wheel would show it twice)`);
      categories.set(key, q.number);
    }
  });
});

if (errors.length) {
  console.error(`✗ questions.json has ${errors.length} problem${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const today = dayNumberFor(zonedDateString(CONFIG.TIME_ZONE), CONFIG.LAUNCH_DATE);
const left = days.length - today;
console.log(`✓ questions.json OK: ${days.length} days, last one is ${days.at(-1)?.date ?? 'none'}.`);
if (left < 0) console.warn(`! Today is day ${today}, past the end of the file. Players see "No show today".`);
else if (left < 7) console.warn(`! Only ${left} day${left === 1 ? '' : 's'} left after today. Time to write more questions.`);
