// Gamdle: screens and the play loop.
// Phases: start -> spin -> wager -> question -> reveal -> lever -> (spin ...) -> results
// Rule from the spec: decide and save first, then animate. Resuming never replays an animation.

import { CONFIG } from './config.js';
import * as R from './rules.js';
import * as store from './storage.js';
import * as stats from './stats.js';
import { audio, sfx } from './audio.js';
import { IMAGES } from './assets.js';
import { FEEL } from './tuning.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const screen = $('#screen');
const machine = $('#machine');
const lever = $('#lever');
const coinSlot = $('#coinSlot');

const motion = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => motion.matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = R.formatTokens;
const LETTERS = 'ABCD';
// Same coin as the falling/flying coins (swappable via the `coin` slot in js/assets.js)
const COIN = '<span class="coin-icon" aria-hidden="true"></span>';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const signed = (n) => `<span class="${n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero'}">${n < 0 ? '-' : '+'}${fmt(Math.abs(n))}</span>`;

// Dev switches for local testing (see README): ?day=3  ?reset  ?mockstats  ?lever=win|lose  ?showanswer
const params = new URLSearchParams(location.search);
const DEV = {
  day: params.has('day') ? Number(params.get('day')) : null,
  reset: params.has('reset'),
  mock: params.has('mockstats'),
  lever: ['win', 'lose'].includes(params.get('lever')) ? params.get('lever') : null, // force lever results
  showAnswer: params.has('showanswer'), // outline the correct option
};
// Games played with forced results never touch personal stats or the server.
const DEV_RUN = DEV.day !== null || DEV.lever !== null || DEV.showAnswer;

let playerId;
let dayNumber;
let puzzle;
let state;
let disposers = [];

// ---------- Boot ----------

async function boot() {
  applyImages();
  buildBulbs();
  setupMute();
  audio.autoUnlock();
  lever.addEventListener('click', () => { if (lever.classList.contains('armed')) pull(); });
  // Every button gets a tap sound. data-sfx="name" picks a different one, data-sfx="none" skips it
  // (for buttons whose handler already plays its own sound).
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const name = b.dataset.sfx ?? 'button';
    if (name !== 'none') sfx[name]();
  }, true);

  playerId = store.playerId();
  const today = R.dayNumberFor(R.zonedDateString(CONFIG.TIME_ZONE), CONFIG.LAUNCH_DATE);
  dayNumber = DEV.day ?? today;
  stats.retryPending(dayNumber);

  let days;
  try {
    const res = await fetch('questions.json', { cache: 'no-cache' });
    days = await res.json();
  } catch {
    return renderMessage('Lost signal', 'Could not load today\'s show. Check your connection and refresh.');
  }
  puzzle = days[dayNumber - 1];
  if (dayNumber < 1 || !puzzle) {
    return renderMessage('No show today', 'The studio is dark. Come back tomorrow for a new puzzle.');
  }

  if (DEV.reset) store.clearGame(dayNumber);
  if (!DEV.day) store.clearOtherDays(dayNumber);
  state = store.loadGame(dayNumber) ?? newGame();

  // If the day rolls over while the tab sat in the background, start fresh.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || DEV.day) return;
    const now = R.dayNumberFor(R.zonedDateString(CONFIG.TIME_ZONE), CONFIG.LAUNCH_DATE);
    if (now !== dayNumber) location.reload();
    else if (state.phase === 'question') resume(); // re-check the deadline
  });

  resume();
}

function newGame() {
  return { day: dayNumber, phase: 'start', stack: R.START_STACK, bust: false, current: null, completed: [] };
}
const save = () => store.saveGame(state);
const currentQ = () => puzzle.questions.find((q) => q.number === state.current.number);

/** Opens the game at a stable screen for the saved phase. */
function resume() {
  counterValue = displayStack(); // never replay a count on resume
  switch (state.phase) {
    case 'start': return renderStart();
    case 'spin': return renderSpin();
    case 'wager': return state.bust ? startQuestion() : renderWager();
    case 'question':
      if (Date.now() >= state.current.deadline) return timeOut();
      return renderQuestion();
    case 'reveal':
    case 'lever':
      state.phase = 'lever';
      save();
      return renderLever(false);
    case 'results': return renderResults(false);
  }
}

// ---------- Screen helpers ----------

function show(html, cls = '') {
  disposers.forEach((f) => f());
  disposers = [];
  screen.className = `screen ${cls}`;
  screen.innerHTML = html;
  screen.scrollTop = 0;
  updateScrollHint();
  setLeverArmed(false);
  coinSlot.classList.remove('ready');
}
function every(ms, fn) {
  const id = setInterval(fn, ms);
  disposers.push(() => clearInterval(id));
}
function setLeverArmed(on) {
  lever.classList.toggle('armed', on);
  lever.setAttribute('role', on ? 'button' : 'presentation');
  lever.tabIndex = on ? 0 : -1;
}
/** Top bar: question number, an optional middle slot (timer or result banner), tokens. */
function hud(middle = '') {
  const n = Math.min(R.QUESTIONS_PER_DAY, state.completed.length + 1);
  const right = state.bust
    ? '<span class="bust-tag">BUST</span>'
    : `<span class="stack" id="stackPill" aria-label="${fmt(displayStack())} tokens">${COIN}<span class="stack-num">${fmt(counterValue)}</span></span>`;
  return `<div class="hud"><span>Q ${n}/${R.QUESTIONS_PER_DAY}</span><div class="hud-mid">${middle}</div>${right}</div>`;
}
function renderMessage(title, body) {
  show(`<div class="message"><h2>${esc(title)}</h2><p class="muted">${esc(body)}</p></div>`);
}

// ---------- Start ----------

function renderStart() {
  show(`
    <div class="start">
      <p class="eyebrow">Show #${dayNumber}</p>
      <h2 class="start-title">The Daily<br>Game Show</h2>
      <ul class="howto">
        <li>📅 Every day: ${R.QUESTIONS_PER_DAY} random questions pulled from a pool of ${R.POOL_SIZE}.</li>
        <li>🎡 Spin the wheel to pick a category.</li>
        <li>${COIN} Bet any of your tokens, then answer within ${CONFIG.QUESTION_SECONDS} seconds.</li>
        <li>✅ Right: win your bet. ❌ Wrong: lose it.</li>
        <li>🎰 Pull the lever to go double or nothing.</li>
      </ul>
      <p class="start-stack">You start with <b>${fmt(R.START_STACK)}</b> tokens. Can <b>YOU</b> become a <b>millionaire</b>?</p>
      <button class="btn big" id="play" data-sfx="start">Start the show</button>
    </div>`, 'is-start');
  $('#play').onclick = () => {
    shake(FEEL.shake.start);
    flashBulbs(700);
    state.phase = 'spin';
    save();
    renderSpin();
  };
}

// ---------- Wheel ----------

function remainingQuestions() {
  const done = new Set(state.completed.map((c) => c.number));
  return puzzle.questions.filter((q) => !done.has(q.number));
}

function renderSpin() {
  const remaining = remainingQuestions();
  show(`${hud()}
    <div class="spin">
      <p class="spin-label pulse" id="spinLabel">Tap the wheel to spin</p>
      <div class="wheel-wrap">
        <div class="pointer"></div>
        <div class="wheel-rim" aria-hidden="true"></div>
        <button class="wheel-btn" id="wheelBtn" data-sfx="none" aria-label="Spin the wheel">${wheelSvg(remaining)}</button>
      </div>
    </div>`, 'is-spin');

  const btn = $('#wheelBtn');
  btn.onclick = async () => {
    btn.disabled = true;
    const idx = Math.floor(Math.random() * remaining.length);
    const q = remaining[idx];
    state.current = { number: q.number, wager: 0, selected: null, deadline: null };
    state.phase = 'wager';
    save(); // decided before the animation starts
    const label = $('#spinLabel');
    label.classList.remove('pulse');
    label.textContent = '';
    await spinWheel($('#wheel'), remaining.length, idx);
    label.textContent = q.category;
    await wait(reduced() ? 200 : 600);
    state.bust ? startQuestion() : renderWager();
  };
}

function wheelSvg(items) {
  const n = items.length;
  const seg = 360 / n;
  const r = 150;
  const pt = (deg) => {
    const a = (deg * Math.PI) / 180;
    return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
  };
  let body = '';
  items.forEach((q, i) => {
    const fill = `var(--wheel-${(i % 5) + 1})`;
    body += n === 1
      ? `<circle r="${r}" fill="${fill}"/>`
      : `<path d="M0 0 L${pt(i * seg - seg / 2)} A${r} ${r} 0 ${seg > 180 ? 1 : 0} 1 ${pt(i * seg + seg / 2)} Z" fill="${fill}" stroke="rgba(0,0,0,.35)" stroke-width="2"/>`;
    const max = n > 5 ? 11 : 13;
    const label = q.category.length > max ? `${q.category.slice(0, max - 1)}…` : q.category;
    const textTransform = n <= 2 ? `rotate(${i * seg}) translate(0 ${-r * 0.5})` : `rotate(${i * seg}) translate(0 ${-r * (n > 5 ? 0.54 : 0.56)}) rotate(-90)`;
    body += `<text transform="${textTransform}" text-anchor="middle" dominant-baseline="middle" font-size="${n <= 2 ? 20 : n <= 5 ? 15 : Math.min(17, 100 / (label.length * 0.62)).toFixed(1)}" font-weight="${n > 5 ? 700 : 400}">${esc(label)}</text>`;
  });
  body += `<circle r="18" fill="var(--bezel)" stroke="var(--gold)" stroke-width="4"/>`;
  return `<svg id="wheel" viewBox="-150 -150 300 300" aria-hidden="true">${body}</svg>`;
}

function spinWheel(el, n, idx) {
  const seg = 360 / n;
  const jitter = n === 1 ? 0 : (Math.random() - 0.5) * seg * 0.6;
  const target = (((-idx * seg + jitter) % 360) + 360) % 360; // lands segment idx under the pointer
  const end = 360 * (reduced() ? 1 : 4) + target;
  const dur = reduced() ? 400 : FEEL.wheelSpinMs;
  return new Promise((resolve) => {
    const t0 = performance.now();
    let lastSeg = null;
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const rot = end * (1 - (1 - t) ** 3);
      el.style.transform = `rotate(${rot}deg)`;
      const s = Math.floor((rot + seg / 2) / seg);
      if (lastSeg !== null && s !== lastSeg) sfx.tick();
      lastSeg = s;
      if (t < 1) requestAnimationFrame(frame);
      else { sfx.ding(); resolve(); }
    };
    requestAnimationFrame(frame);
  });
}

// ---------- Wager ----------

const QUICK = [['+10%', 0.1], ['+25%', 0.25], ['+50%', 0.5], ['-10%', -0.1], ['-25%', -0.25], ['-50%', -0.5]];

function renderWager() {
  const q = currentQ();
  const cur = state.current;
  const S = state.stack;
  show(`${hud()}
    <div class="wager">
      <p class="eyebrow">Category</p>
      <h2 class="category">${esc(q.category)}</h2>
      <label class="wager-label" for="wagerInput">Your bet</label>
      <div class="wager-row">
        ${COIN}
        <input id="wagerInput" type="text" inputmode="numeric" autocomplete="off" value="${fmt(cur.wager)}">
      </div>
      <p class="wager-of">of ${fmt(S)} tokens</p>
      <div class="quick">
        ${QUICK.map(([label, p]) => `<button class="chip" data-p="${p}">${label}</button>`).join('')}
        <button class="chip allin" data-all data-sfx="none">ALL IN</button>
      </div>
    </div>
    <div class="actions"><button class="btn big" id="confirm" data-sfx="none"></button></div>`, 'is-wager');
  coinSlot.classList.add('ready');

  const input = $('#wagerInput');
  const confirm = $('#confirm');
  const update = () => {
    const W = cur.wager;
    confirm.textContent = W === 0 ? 'Play for nothing' : W === S ? 'ALL IN!' : `Bet ${fmt(W)}`;
  };
  const setWager = (w, reformat = true) => {
    const clamped = R.clampWager(w, S);
    const wasAllIn = cur.wager === S;
    cur.wager = clamped;
    if (clamped === S && S > 0 && !wasAllIn) allInHit(); // however they got there: button, +%, or typing
    if (reformat || String(clamped) !== String(w)) input.value = fmt(clamped);
    save(); // drafts are kept
    update();
  };
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '');
    setWager(digits === '' ? 0 : digits, false);
    if (digits === '') input.value = '';
  });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', () => { input.value = fmt(cur.wager); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm.click(); });
  $$('.chip[data-p]').forEach((b) => { b.onclick = () => setWager(cur.wager + Math.round(S * Number(b.dataset.p))); });
  $('.chip[data-all]').onclick = () => setWager(S);
  confirm.onclick = insertCoins;
  update();
}

async function insertCoins() {
  const cur = state.current;
  const allIn = cur.wager === state.stack && cur.wager > 0;
  const share = state.stack > 0 ? cur.wager / state.stack : 0;
  const coinMs = reduced() ? 200 : FEEL.coinMs;
  state.phase = 'question';
  cur.deadline = Date.now() + coinMs + CONFIG.QUESTION_SECONDS * 1000; // timer starts when the question shows
  save();
  $$('button', screen).forEach((b) => { b.disabled = true; });
  allIn ? sfx.coins() : sfx.clink();
  bumpCounter(); // -bet
  if (allIn) {
    shake(FEEL.shake.allInConfirm); // instant
    flashBulbs(coinMs + 200, 'rush');
    funnelCoins(FEEL.allInCoins, coinMs);
    setTimeout(() => shake(FEEL.shake.coinMax), coinMs * 0.85); // and again as the pile lands
  } else {
    dropCoins(1);
    setTimeout(() => shake(lerp(FEEL.shake.coinMin, FEEL.shake.coinMax, share)), coinMs * 0.6);
  }
  await wait(coinMs);
  renderQuestion();
}

function dropCoins(count) {
  for (let i = 0; i < count; i++) {
    const coin = document.createElement('div');
    coin.className = 'coin';
    coin.style.animationDelay = `${i * 70}ms`;
    coinSlot.appendChild(coin);
    setTimeout(() => coin.remove(), 900 + i * 70);
  }
}

/** Bust players skip the wager. */
function startQuestion() {
  state.current.wager = 0;
  state.current.deadline = Date.now() + CONFIG.QUESTION_SECONDS * 1000;
  state.phase = 'question';
  save();
  renderQuestion();
}

// ---------- Question ----------

function questionHtml(q, cur, mode) {
  // mode: 'live' (selectable), 'locked' (waiting for reveal), 'reveal'
  const optClass = (i) => {
    if (mode === 'reveal') {
      if (i === q.correct) return 'correct';
      return i === cur.picked ? 'wrong' : 'dim';
    }
    const dev = DEV.showAnswer && i === q.correct ? ' dev-correct' : '';
    return (i === cur.selected ? 'selected' : '') + dev;
  };
  const stake = cur.wager > 0 ? ` · Bet ${COIN} ${fmt(cur.wager)}` : '';
  return `
    <div class="question">
      <p class="eyebrow">${esc(q.category)}${stake}</p>
      <h2 class="prompt">${esc(q.prompt)}</h2>
      <div class="options">
        ${q.options.map((o, i) => `
          <button class="option ${optClass(i)}" data-i="${i}" data-sfx="select" ${mode === 'live' ? '' : 'disabled'}>
            <span class="letter">${LETTERS[i]}</span><span>${esc(o)}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

function renderQuestion() {
  const q = currentQ();
  const cur = state.current;
  show(`${hud(`
    <div class="timer" id="timer">
      <div class="timer-bar"><div class="timer-fill" id="timerFill"></div></div>
      <span class="timer-num" id="timerNum">${CONFIG.QUESTION_SECONDS}</span>
    </div>`)}
    ${questionHtml(q, cur, 'live')}
    <div class="actions"><button class="btn big" id="lock" data-sfx="none" ${cur.selected == null ? 'disabled' : ''}>Lock In</button></div>`, 'is-question');

  const lock = $('#lock');
  $$('.option', screen).forEach((btn) => {
    btn.onclick = () => {
      cur.selected = Number(btn.dataset.i);
      save();
      $$('.option', screen).forEach((b) => b.classList.toggle('selected', b === btn));
      lock.disabled = false;
    };
  });
  lock.onclick = lockIn;

  const timer = $('#timer');
  const fill = $('#timerFill');
  const num = $('#timerNum');
  let lastSec = null;
  const tick = () => {
    const rem = cur.deadline - Date.now();
    if (rem <= 0) return timeOut();
    const sec = Math.min(CONFIG.QUESTION_SECONDS, Math.ceil(rem / 1000));
    fill.style.transform = `scaleX(${Math.min(1, rem / (CONFIG.QUESTION_SECONDS * 1000))})`;
    if (sec !== lastSec) {
      lastSec = sec;
      num.textContent = sec;
      timer.classList.toggle('danger', sec <= 5);
      sfx.clock({ loud: sec <= 5 });
    }
  };
  tick();
  every(100, tick);
}

async function lockIn() {
  const q = currentQ();
  const cur = state.current;
  if (cur.selected == null) return;
  cur.picked = cur.selected;
  cur.correct = cur.picked === q.correct;
  cur.timedOut = false;
  state.phase = 'reveal';
  save(); // result is decided before the drumroll
  sfx.thunk();
  shake(FEEL.shake.lockIn);

  show(`${hud()}${questionHtml(q, cur, 'locked')}<div class="actions"><p class="locked-note">Final answer…</p></div>`, 'is-question');

  const S = state.stack;
  const W = cur.wager;
  if (W > 0 && !state.bust) {
    // Suspense scales with the share of the stack at stake: longer wait, deeper zoom, more tension.
    const share = W / S;
    const ms = lerp(FEEL.revealMin, FEEL.revealMax, share);
    sfx.drumroll({ dur: ms / 1000 });
    machine.classList.add('chasing');
    const zoom = W === S ? FEEL.zoomAllIn : lerp(FEEL.zoomMin, FEEL.zoomMax, share);
    suspenseZoom(zoom, ms);
    await wait(ms);
    machine.classList.remove('chasing');
    releaseZoom();
  }
  state.phase = 'lever';
  save();
  renderLever(true);
}

function timeOut() {
  const cur = state.current;
  cur.picked = null; // a highlighted but un-locked option does not count
  cur.correct = false;
  cur.timedOut = true;
  state.phase = 'lever';
  save();
  sfx.buzzer();
  renderLever(true);
}

// ---------- Reveal + Double or Nothing ----------

function renderLever(fresh) {
  const q = currentQ();
  const cur = state.current;
  const banner = cur.timedOut
    ? '<span class="banner bad">⏰ Time\'s up</span>'
    : cur.correct ? '<span class="banner good">Correct!</span>' : '<span class="banner bad">Wrong</span>';
  show(`${hud(banner)}${questionHtml(q, cur, 'reveal')}<div class="actions" id="leverArea"></div>`, 'is-lever');
  if (fresh) {
    fireEvent(cur.correct ? 'correct' : 'wrong', cur.timedOut ? { text: 'TIME\'S UP' } : {});
    bumpCounter(); // a correct answer pays back the bet plus the win
  }
  drawLeverArea();
  fitReveal();
}

/**
 * Keeps the reveal on one screen: if it would need scrolling, first make the options compact,
 * and only if that's not enough, hide the options that were neither picked nor correct.
 */
function fitReveal() {
  const overflows = () => screen.scrollHeight > screen.clientHeight;
  screen.classList.remove('snug', 'tight');
  if (overflows()) screen.classList.add('snug');
  if (overflows()) screen.classList.add('tight');
  updateScrollHint();
}

function drawLeverArea() {
  const area = $('#leverArea');
  const cur = state.current;
  const S = state.stack;
  const W = cur.wager;

  if (cur.pulled) {
    const final = R.settle(S, W, cur.correct, true, cur.leverWin);
    area.innerHTML = `
      <div class="lever-result ${cur.leverWin ? 'win' : 'loss'}"><span>${cur.leverWin ? 'WIN' : 'LOSE'}</span>${signed(final - S)}</div>
      <button class="btn big" id="next">Next</button>`;
    $('#next').onclick = commit;
    return;
  }

  const keep = R.settle(S, W, cur.correct, false, null) - S;
  if (W === 0 || state.bust) {
    area.innerHTML = `<p class="delta">${W ? signed(keep) : '<span class="zero">Nothing at stake</span>'}</p><button class="btn big" id="next">Next</button>`;
    $('#next').onclick = commit;
    return;
  }

  const win = R.settle(S, W, cur.correct, true, true) - S;
  const lose = R.settle(S, W, cur.correct, true, false) - S;

  // About to go bust anyway: the lever is a free 50/50 bailout, so there's no point offering Keep.
  if (S + keep === 0) {
    area.innerHTML = `
      <div class="don">
        <button class="don-box bailout" id="pullHint" data-sfx="none">
          <span class="don-title">🚨 You're about to go bust!</span>
          <span class="don-note">Pull the lever for a 50/50 bailout. Win and you keep your ${fmt(S)} tokens. Lose and you're out.</span>
          <span class="don-pull">Pull the lever <span class="arrow">➜</span></span>
        </button>
      </div>`;
    setLeverArmed(true);
    $('#pullHint').onclick = pull;
    return;
  }

  area.innerHTML = `
    <div class="don">
      <button class="don-box" id="pullHint" data-sfx="none">
        <span class="don-title">🎰 Double or nothing?</span>
        <span class="don-odds"><span>Win ${signed(win)}</span><span>Lose ${signed(lose)}</span></span>
        <span class="don-pull">Pull the lever <span class="arrow">➜</span></span>
      </button>
      <div class="don-or"><span>or</span></div>
      <button class="btn ghost" id="skip">Keep ${signed(keep)} and move on</button>
    </div>`;
  setLeverArmed(true);
  $('#pullHint').onclick = pull;
  $('#skip').onclick = commit;
}

async function pull() {
  const cur = state.current;
  if (!cur || cur.pulled || state.phase !== 'lever') return;
  setLeverArmed(false);
  const S = state.stack;
  cur.pulled = true;
  cur.leverWin = DEV.lever ? DEV.lever === 'win' : R.leverWins(playerId, dayNumber, cur.number);
  const busts = !state.bust && R.settle(S, cur.wager, cur.correct, true, cur.leverWin) === 0;
  if (busts) cur.bustFired = true;
  save(); // the roll is decided and saved before the reel spins

  lever.classList.remove('pulling');
  void lever.offsetWidth;
  lever.classList.add('pulling');
  sfx.lever();
  machine.classList.add('rush'); // lights chase faster while the reels spin
  setTimeout(() => shake(FEEL.shake.lever), reduced() ? 0 : FEEL.leverClunkMs);
  await wait(reduced() ? 100 : FEEL.leverClunkMs + 150);
  await slotReels($('#leverArea'), cur.leverWin);
  lever.classList.remove('pulling');

  drawLeverArea();
  bumpCounter(); // double up, or lose the winnings
  machine.classList.remove('rush');
  if (cur.leverWin) {
    fireEvent('leverWin', cur.correct ? {} : { text: 'SAVED!' });
    flashBulbs(FEEL.partyMs, 'party'); // multicolor lights
    if (cur.correct) {
      coinRain(FEEL.coinRain);          // the big casino payout for a real double
      sfx.payout();
    }
  } else fireEvent('leverLoss');
  if (busts) setTimeout(() => fireEvent('bust'), 900);
}

/** Three reels. Win = three of a kind. Loss = a near miss on the last reel. */
const SYMBOLS = ['🔥', '💀', '💰', '🍒', '7️⃣', '💎'];
function slotReels(area, win) {
  area.innerHTML = `<div class="reels" id="reels">${'<div class="reel spinning"><span>🎰</span></div>'.repeat(3)}</div>`;
  const box = $('#reels');
  const reels = $$('.reel', box);
  const hit = ['💰', '💎', '7️⃣'][Math.floor(Math.random() * 3)];
  const miss = SYMBOLS.filter((x) => x !== hit)[Math.floor(Math.random() * 5)];
  const finals = win ? [hit, hit, hit] : [hit, hit, miss];
  const dur = reduced() ? 400 : FEEL.slotSpinMs;
  const stops = [0.55, 0.78, 1].map((f) => f * dur);
  return new Promise((resolve) => {
    const t0 = performance.now();
    let stopped = 0;
    const step = () => {
      const elapsed = performance.now() - t0;
      while (stopped < 3 && elapsed >= stops[stopped]) {
        const r = reels[stopped];
        r.classList.remove('spinning');
        r.classList.add('stopped');
        r.innerHTML = `<span>${finals[stopped]}</span>`;
        sfx.reelStop();
        shake(FEEL.shake.reelStop * (stopped === 2 ? 1.6 : 1));
        stopped++;
      }
      if (stopped === 3) {
        box.classList.add(win ? 'win' : 'loss');
        return setTimeout(resolve, reduced() ? 150 : 450);
      }
      reels.forEach((r, i) => { if (i >= stopped) r.firstChild.textContent = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]; });
      sfx.slotTick();
      const p = elapsed / dur;
      setTimeout(step, 45 + 110 * p * p); // ticks slow down as the reels wind down
    };
    step();
  });
}

/** Locks the question's outcome into the completed list and moves on. */
function commit() {
  const cur = state.current;
  const S = state.stack;
  const pulled = Boolean(cur.pulled);
  const final = R.settle(S, cur.wager, cur.correct, pulled, pulled ? cur.leverWin : null);
  state.completed.push({
    number: cur.number, wager: cur.wager, picked: cur.picked, correct: cur.correct,
    pulled, leverWin: pulled ? cur.leverWin : null, stackAfter: final,
  });
  state.stack = final;
  state.current = null;
  if (!counterAnim) counterValue = final;
  let bustNow = false;
  if (final === 0 && !state.bust) {
    state.bust = true;
    bustNow = !cur.bustFired;
  }
  const finished = state.completed.length >= R.QUESTIONS_PER_DAY;
  state.phase = finished ? 'results' : 'spin';
  if (finished) finishGame();
  save();

  if (bustNow) fireEvent('bust');
  if (!finished) return renderSpin();
  if (state.stack >= R.MILLIONAIRE) millionaire().then(() => renderResults(true));
  else renderResults(true);
}

// ---------- Event feedback (plays over the screen, never blocks input) ----------

const EVENTS = {
  correct: { text: 'CORRECT!', sound: 'correct', cls: 'good' },
  wrong: { text: 'WRONG!', sound: 'wrong', cls: 'bad' },
  leverWin: { text: 'DOUBLE!', sound: 'win', cls: 'gold' },
  leverLoss: { text: 'NOTHING!', sound: 'lose', cls: 'bad' },
  bust: { text: 'BUST!', sound: 'bust', cls: 'bust' },
  allIn: { text: 'ALL IN!', sound: 'allIn', cls: 'gold' },
};
let fxTimer = null;
function fireEvent(type, opts = {}) {
  const ev = EVENTS[type];
  const fx = $('#fx');
  sfx[ev.sound]();
  clearTimeout(fxTimer);
  fx.className = 'fx';
  machine.classList.remove('fx-good', 'fx-bad', 'fx-gold', 'fx-bust');
  void fx.offsetWidth; // restart the animation if one is already running
  fx.textContent = opts.text || ev.text;
  fx.className = `fx show ${ev.cls}`;
  machine.classList.add(`fx-${ev.cls}`);
  shake(FEEL.shake[type] ?? 0);
  fxTimer = setTimeout(() => {
    fx.className = 'fx';
    machine.classList.remove(`fx-${ev.cls}`);
  }, 1300);
}

function millionaire() {
  return new Promise((resolve) => {
    const ov = $('#overlay');
    const confetti = Array.from({ length: 36 }, () => {
      const e = ['🪙', '💰', '💎', '✨'][Math.floor(Math.random() * 4)];
      return `<span class="confetti" style="left:${Math.random() * 100}%;animation-duration:${2 + Math.random() * 2}s;animation-delay:${Math.random()}s">${e}</span>`;
    }).join('');
    ov.innerHTML = `${confetti}<div><h2 class="mil-title">MILLIONAIRE</h2><p class="mil-score">${fmt(state.stack)} tokens</p><p class="mil-tap muted">Tap to continue</p></div>`;
    ov.hidden = false;
    sfx.millionaire();
    shake(FEEL.shake.millionaire);
    flashBulbs(4500, 'party');
    coinRain(FEEL.coinRain * 2.5, 3500);
    let timer;
    const done = () => {
      clearTimeout(timer);
      ov.hidden = true;
      ov.innerHTML = '';
      ov.onclick = null;
      resolve();
    };
    ov.onclick = done;
    timer = setTimeout(done, reduced() ? 1800 : 4500);
  });
}

// ---------- Results ----------

function finishGame() {
  if (state.recorded) return;
  state.recorded = true;
  state.newBest = false;
  if (DEV_RUN) return; // dev/test games don't touch personal stats or the server
  state.newBest = store.recordGame(dayNumber, state.stack).newBest;
  stats.queuePending({
    playerId,
    day: dayNumber,
    picks: state.completed.map((c) => ({ number: c.number, picked: c.picked, wager: c.wager, pulled: c.pulled })),
  });
}

async function loadWorld() {
  if (DEV.mock) {
    await wait(500);
    return stats.mockStats(state, puzzle);
  }
  const pending = stats.getPending(dayNumber);
  if (pending) return stats.submit(pending); // stays queued if this fails
  return stats.fetchStats(dayNumber, playerId);
}

function renderResults(fresh) {
  const score = state.stack;
  const share = R.shareText(dayNumber, state.completed, score);
  const ps = store.loadStats();
  const avg = ps.played ? Math.round(ps.total / ps.played) : 0;

  show(`
    <div class="results">
      <p class="eyebrow">Gamdle #${dayNumber} · Final score</p>
      <div class="final ${state.bust ? 'bust' : ''}">
        <span class="final-score" id="finalScore">${fresh ? '0' : fmt(score)}</span>
        ${state.newBest ? '<span class="pb">New personal best!</span>' : ''}
      </div>
      <div class="world" id="world" ${fresh ? 'hidden' : ''}>
        <p class="headline loading" id="headline">Tallying the studio audience…</p>
        <div id="worldBody"></div>
      </div>
      <div class="share-row"><button class="btn big" id="share">Share</button></div>
      <p class="share-preview">${esc(share)}</p>
      <p class="countdown" id="countdownRow">Next show in <b id="countdown">--:--:--</b></p>
      <section class="card">
        <h3>Your stats</h3>
        <div class="stats-grid">
          <div><b>${ps.played}</b><span>Played</span></div>
          <div><b>${store.currentStreak(ps, dayNumber)}</b><span>Streak</span></div>
          <div><b>${ps.bestStreak}</b><span>Best streak</span></div>
          <div><b>${compact(avg)}</b><span>Average</span></div>
          <div><b>${ps.best == null ? '-' : compact(ps.best)}</b><span>Best</span></div>
        </div>
      </section>
      <section class="card" id="accuracyCard" hidden>
        <h3>Questions right, worldwide</h3>
        <div id="accuracy"></div>
      </section>
      <section class="card">
        <h3>Question breakdown</h3>
        <div id="breakdown">${breakdownHtml(null)}</div>
      </section>
    </div>`, 'is-results');

  $('#share').onclick = () => doShare(share);
  startCountdown();

  const world = loadWorld();
  const counted = fresh ? countUp($('#finalScore'), score) : Promise.resolve();
  counted.then(() => { $('#world').hidden = false; });
  world.then(fillWorld, worldUnavailable);
}

function countUp(el, target) {
  return new Promise((resolve) => {
    if (reduced() || target === 0) {
      el.textContent = fmt(target);
      return resolve();
    }
    const dur = Math.min(2400, 900 + Math.log10(target + 1) * 250);
    const t0 = performance.now();
    let done = false;
    let lastTick = 0;
    const finish = () => {
      if (done) return;
      done = true;
      el.textContent = fmt(target);
      sfx.ding();
      resolve();
    };
    screen.addEventListener('pointerdown', finish, { once: true }); // tap to finish instantly
    disposers.push(() => screen.removeEventListener('pointerdown', finish));
    const frame = (now) => {
      if (done) return;
      const t = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(target * (1 - (1 - t) ** 3));
      if (now - lastTick > 70) { sfx.tick(); lastTick = now; }
      if (t < 1) requestAnimationFrame(frame);
      else finish();
    };
    requestAnimationFrame(frame);
  });
}

const compact = (n) => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
};
const pct = (part, total) => (total ? Math.round((100 * part) / total) : 0);

function fillWorld(w) {
  if (!w || !$('#worldBody')) return;
  const score = state.stack;
  const bustPct = pct(w.busts, w.players);
  const headline = $('#headline');
  headline.classList.remove('loading');
  headline.innerHTML = state.bust
    ? `You and ${bustPct}% of players went bust`
    : `You beat ${pct(w.below, w.players)}% of players${score >= R.MILLIONAIRE ? '<span class="mil">MILLIONAIRE</span>' : ''}`;

  const myBin = R.scoreBin(score);
  const bins = [];
  for (let k = R.MIN_BIN; k <= R.MAX_BIN; k++) bins.push(k);
  const max = Math.max(1, ...bins.map((k) => w.scoreBins[k] || 0));
  $('#worldBody').innerHTML = `
    <p class="based">Based on ${fmt(w.players)} player${w.players === 1 ? '' : 's'} today</p>
    <div class="world-row">
      <div class="chart-box">
        <div class="chart">${bins.map((k) => `<div class="bar ${k === myBin ? 'you' : ''}" style="height:${(100 * (w.scoreBins[k] || 0)) / max}%" title="${fmt(w.scoreBins[k] || 0)} players"></div>`).join('')}</div>
        <div class="chart-labels">${bins.map((k) => `<span class="${k === 0 ? 'center' : ''}">${compact(R.binCenter(k))}</span>`).join('')}</div>
      </div>
      <div class="bust-stat ${state.bust ? 'yours' : ''}"><b>${bustPct}%</b>went bust${state.bust ? '<br>(you too)' : ''}</div>
    </div>`;

  const right = state.completed.filter((r) => r.correct).length;
  const accMax = Math.max(1, ...w.accuracy);
  $('#accuracy').innerHTML = `
    <div class="acc">${w.accuracy.map((c, i) => `<div class="bar ${i === right ? 'you' : ''}" style="height:${(100 * c) / accMax}%" title="${fmt(c)} players"></div>`).join('')}</div>
    <div class="acc-labels">${w.accuracy.map((_, i) => `<span>${i}/5</span>`).join('')}</div>`;
  $('#accuracyCard').hidden = false;
  $('#breakdown').innerHTML = breakdownHtml(w);
}

function worldUnavailable() {
  const body = $('#world');
  if (!body) return;
  body.innerHTML = '<p class="muted">Worldwide stats unavailable</p>';
}

/** Played questions in spin order (matching the share text), then the ones the wheel never landed on. */
function breakdownHtml(w) {
  const rows = R.markBusted(state.completed);
  const played = rows.map((row) => ({ q: puzzle.questions.find((x) => x.number === row.number), row }));
  const skipped = puzzle.questions.filter((q) => !rows.some((r) => r.number === q.number)).map((q) => ({ q, row: null }));

  const card = ({ q, row }, i) => {
    const picks = w?.options?.[q.number];
    const total = picks ? picks.reduce((a, b) => a + b, 0) : 0;
    const bar = (count) => (picks ? `<span class="pct">${pct(count, total)}%</span><span class="pctbar" style="width:${pct(count, total)}%"></span>` : '');
    const picked = row ? row.picked : undefined;
    const opts = q.options.map((o, k) => `
      <li class="${k === q.correct ? 'is-correct' : ''} ${k === picked ? 'is-picked' : ''}">
        <span class="letter">${LETTERS[k]}</span><span>${esc(o)}</span>${bar(picks?.[k] ?? 0)}
      </li>`).join('');
    const timeout = (picks && picks[4]) || picked === null
      ? `<li class="${picked === null ? 'is-picked' : ''}"><span class="letter">⏰</span><span>Time's up</span>${bar(picks?.[4] ?? 0)}</li>`
      : '';
    if (!row) {
      return `
        <div class="bd skipped">
          <div class="bd-head"><span class="bd-cat">${esc(q.category)}</span><span class="skip-tag">Didn't spin</span></div>
          <p class="bd-prompt">${esc(q.prompt)}</p>
          <ul class="bd-opts">${opts}${timeout}</ul>
        </div>`;
    }
    return `
      <div class="bd">
        <div class="bd-head">
          <span>Spin ${i + 1}</span><span class="bd-cat">${esc(q.category)}</span>
          <span>${row.correct ? '✅' : '❌'}</span><span>${R.leverEmoji(row)}</span>
        </div>
        <p class="bd-prompt">${esc(q.prompt)}</p>
        <p class="bd-bet">Bet ${fmt(row.wager)}, stack after: ${fmt(row.stackAfter)}</p>
        <ul class="bd-opts">${opts}${timeout}</ul>
      </div>`;
  };

  const skippedHtml = skipped.length
    ? `<p class="bd-divider">Skipped by the wheel</p>${skipped.map(card).join('')}`
    : '';
  return played.map(card).join('') + skippedHtml;
}

function startCountdown() {
  const el = $('#countdown');
  const tick = () => {
    const ms = R.nextMidnight(CONFIG.TIME_ZONE) - Date.now();
    if (ms <= 0) {
      $('#countdownRow').innerHTML = 'A new show is ready! <button class="btn" onclick="location.reload()">Play</button>';
      return;
    }
    const s = Math.floor(ms / 1000);
    const pad = (n) => String(n).padStart(2, '0');
    el.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  };
  tick();
  every(1000, tick);
}

async function doShare(text) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copied!');
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

const frame = $('.screen-frame');
function updateScrollHint() {
  frame.classList.toggle('more', screen.scrollTop + screen.clientHeight < screen.scrollHeight - 4);
}
screen.addEventListener('scroll', updateScrollHint, { passive: true });
window.addEventListener('resize', updateScrollHint);
new ResizeObserver(updateScrollHint).observe(screen);
new MutationObserver(updateScrollHint).observe(screen, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });

// ---------- Running token counter ----------
// The counter shows where your tokens stand mid-question: the bet comes off when you insert coins,
// then the answer and the lever add or remove from there. It always lands on the real total.

let counterValue = 0;
let counterAnim = null;

/** What the counter should show right now, from the saved state. */
function displayStack() {
  const c = state.current;
  const S = state.stack;
  if (!c) return S;
  if (state.phase === 'question' || state.phase === 'reveal') return S - c.wager;
  if (state.phase === 'lever') return R.settle(S, c.wager, c.correct, Boolean(c.pulled), c.pulled ? c.leverWin : null);
  return S;
}

/** Ticks the counter to the current total, with a floating +/- amount under it. */
function bumpCounter() {
  const target = displayStack();
  const from = counterValue;
  const delta = target - from;
  if (!delta) return;
  floatDelta(delta);
  cancelAnimationFrame(counterAnim);
  const dur = reduced() ? 250 : Math.min(FEEL.counterMaxMs, FEEL.counterMinMs + Math.log10(Math.abs(delta) + 1) * 120);
  const t0 = performance.now();
  let lastTick = 0;
  const dir = delta > 0 ? 'up' : 'down';
  const frame = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    counterValue = t < 1 ? Math.round(from + delta * (1 - (1 - t) ** 3)) : target;
    const num = $('.hud .stack-num');
    const pill = $('#stackPill');
    if (num) num.textContent = fmt(counterValue);
    if (pill) {
      pill.classList.toggle(dir, t < 1);
      pill.setAttribute('aria-label', `${fmt(target)} tokens`);
    }
    if (t < 1 && now - lastTick > 55) {
      sfx.counterTick({ up: delta > 0 });
      lastTick = now;
    }
    counterAnim = t < 1 ? requestAnimationFrame(frame) : null;
  };
  counterAnim = requestAnimationFrame(frame);
}

function floatDelta(delta) {
  const pill = $('#stackPill');
  if (!pill) return;
  // Lives inside the screen frame (which survives screen re-renders), so it zooms, shakes and
  // moves with the machine. Rects are on-screen (zoomed) sizes, so convert back to layout pixels.
  const fr = frame.getBoundingClientRect();
  const r = pill.getBoundingClientRect();
  const scale = fr.width / frame.offsetWidth || 1;
  const el = document.createElement('div');
  el.className = `stack-delta ${delta > 0 ? 'pos' : 'neg'}`;
  el.textContent = `${delta > 0 ? '+' : '-'}${fmt(Math.abs(delta))}`;
  el.style.right = `${(fr.right - r.right) / scale - frame.clientLeft}px`;
  el.style.top = `${(r.bottom - fr.top) / scale - frame.clientTop + 4}px`;
  frame.appendChild(el);
  el.animate([
    { transform: 'translateY(-6px) scale(.8)', opacity: 0 },
    { transform: 'translateY(0) scale(1.1)', opacity: 1, offset: 0.12 },
    { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.7 },
    { transform: 'translateY(14px) scale(1)', opacity: 0 },
  ], { duration: reduced() ? 1000 : 1500, easing: 'ease-out' }).finished.then(() => el.remove());
}

// ---------- Juice ----------

const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));

/** Screen shake that decays. px = strength from js/tuning.js. Off with reduced motion. */
let shakeAnim = null;
function shake(px) {
  if (!px || reduced() || !machine.animate) return;
  shakeAnim?.cancel();
  const frames = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const decay = 1 - i / n;
    const a = px * decay;
    frames.push({ transform: i === n ? 'none' : `translate(${(Math.random() * 2 - 1) * a}px, ${(Math.random() * 2 - 1) * a * 0.6}px) rotate(${(Math.random() * 2 - 1) * a * 0.03}deg)` });
  }
  shakeAnim = machine.animate(frames, { duration: 220 + px * 18, easing: 'ease-out' });
}

const bulbTimers = {};
/** Marquee light modes: 'chasing' (suspense), 'rush' (lever, faster), 'party' (multicolor win). */
function flashBulbs(ms, mode = 'chasing') {
  machine.classList.add(mode);
  clearTimeout(bulbTimers[mode]);
  bulbTimers[mode] = setTimeout(() => machine.classList.remove(mode), ms);
}

function allInHit() {
  fireEvent('allIn');
  flashBulbs(600, 'rush');
}

/** Quick punch-in on the whole view toward the machine's screen, then a slow creep while waiting. */
const stage = $('.stage');
let zoomAnim = null;
function suspenseZoom(scale, ms) {
  if (reduced() || !stage.animate) return;
  const s = screen.getBoundingClientRect();
  const st = stage.getBoundingClientRect();
  stage.style.transformOrigin = `${s.left - st.left + s.width / 2}px ${s.top - st.top + s.height * 0.45}px`;
  const punch = Math.min(0.4, FEEL.zoomPunchMs / ms);
  zoomAnim = stage.animate([
    { transform: 'scale(1)', easing: 'cubic-bezier(.4, 0, .2, 1)' },
    { transform: `scale(${scale})`, offset: punch },
    { transform: `scale(${scale + FEEL.zoomCreep})` },
  ], { duration: ms, fill: 'forwards' });
  document.body.classList.add('suspense');
}
function releaseZoom() {
  document.body.classList.remove('suspense');
  if (!zoomAnim) return;
  const current = getComputedStyle(stage).transform;
  zoomAnim.cancel();
  zoomAnim = null;
  stage.animate([{ transform: current }, { transform: 'none' }], { duration: FEEL.zoomReleaseMs, easing: 'ease-out' });
}

function fxCoin(cls = 'coin-fx') {
  const c = document.createElement('div');
  c.className = cls;
  document.body.appendChild(c);
  return c;
}

/** ALL IN: coins fly into the slot from all around it. */
function funnelCoins(count, ms) {
  const slot = coinSlot.getBoundingClientRect();
  const tx = slot.left + slot.width / 2;
  const ty = slot.top + slot.height / 2;
  for (let i = 0; i < count; i++) {
    const c = fxCoin();
    const angle = (-170 + (160 * i) / (count - 1) + (Math.random() * 16 - 8)) * (Math.PI / 180);
    const dist = 140 + Math.random() * 140;
    const sx = tx + Math.cos(angle) * dist;
    const sy = ty + Math.sin(angle) * dist;
    const delay = Math.random() * ms * 0.35;
    const dur = reduced() ? 200 : ms * 0.6;
    c.style.left = `${tx}px`;
    c.style.top = `${ty}px`;
    c.animate([
      { transform: `translate(${sx - tx}px, ${sy - ty}px) scale(1.1)`, opacity: 0 },
      { opacity: 1, offset: 0.15 },
      { transform: 'translate(0, 0) scale(.35)', opacity: 1, offset: 0.9 },
      { transform: 'translate(0, 4px) scale(.2)', opacity: 0 },
    ], { duration: dur, delay, easing: 'cubic-bezier(.5, 0, .9, .6)', fill: 'both' }).finished.then(() => c.remove());
  }
}

/** Casino payout: coins rain down over the page, then fade. */
function coinRain(count, ms = FEEL.coinRainMs) {
  if (reduced()) return;
  for (let i = 0; i < count; i++) {
    const c = fxCoin('coin-fx rain');
    c.style.left = `${Math.random() * 100}vw`;
    c.style.top = '-40px';
    const fall = innerHeight + 80;
    const dur = ms * (0.55 + Math.random() * 0.45);
    const delay = Math.random() * ms * 0.45;
    const drift = Math.random() * 60 - 30;
    c.animate([
      { transform: 'translate(0, 0) scaleX(1)', opacity: 1 },
      { transform: `translate(${drift / 2}px, ${fall * 0.5}px) scaleX(-1)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${drift}px, ${fall}px) scaleX(1)`, opacity: 0 },
    ], { duration: dur, delay, easing: 'cubic-bezier(.4, 0, .9, .7)', fill: 'both' }).finished.then(() => c.remove());
  }
}

// ---------- Machine chrome ----------

function applyImages() {
  const root = document.documentElement;
  for (const [name, url] of Object.entries(IMAGES)) {
    if (!url) continue;
    // Resolve against the page, not the stylesheet (CSS would otherwise look under css/)
    const abs = new URL(url, document.baseURI).href;
    root.style.setProperty(`--img-${name}`, `url("${abs}")`);
    root.classList.add(`img-${name}`);
  }
}

function buildBulbs() {
  $$('.bulbs').forEach((row) => { row.innerHTML = '<span class="bulb"></span>'.repeat(12); });
  $$('.side-lights').forEach((col) => { col.innerHTML = '<span class="bulb"></span>'.repeat(9); });
}

function setupMute() {
  const btn = $('#mute');
  const paint = () => {
    btn.textContent = audio.muted ? '🔇' : '🔊';
    btn.classList.toggle('is-muted', audio.muted);
    btn.setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound');
  };
  btn.onclick = () => { audio.setMuted(!audio.muted); paint(); };
  paint();
}

boot();
