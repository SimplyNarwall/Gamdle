// Sound playback. Each sound plays its file from js/assets.js if one is set,
// otherwise a synthesized placeholder. Callers only ever use sfx.<name>().

import { SOUNDS } from './assets.js';

const MUTE_KEY = 'gamdle.muted';
const MASTER_VOLUME = 0.6;

let ctx = null;
let master = null;
let eventBus = null;
const buffers = {}; // name -> AudioBuffer once a file has loaded
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } })();

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(ctx.destination);
    loadFiles();
  }
  return ctx;
}

async function loadFiles() {
  for (const [name, url] of Object.entries(SOUNDS)) {
    if (!url) continue;
    try {
      const res = await fetch(url);
      buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch (e) {
      console.warn(`[gamdle] sound "${name}" failed to load from ${url}, using placeholder`, e);
    }
  }
}

const ready = () => ctx && ctx.state === 'running';

/** Plays a loaded file. maxDur cuts it short (used for the drumroll). Returns true if it played. */
function playFile(name, { vol = 1, bus = null, maxDur = null } = {}) {
  const buf = buffers[name];
  if (!buf) return false;
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = buf;
  g.gain.value = vol;
  src.connect(g).connect(bus || master);
  src.start();
  if (maxDur) {
    g.gain.setTargetAtTime(0, ctx.currentTime + Math.max(0, maxDur - 0.05), 0.02);
    src.stop(ctx.currentTime + maxDur + 0.1);
  }
  return true;
}

// ---------- Placeholder synth ----------

function tone(freq, { dur = 0.12, type = 'square', vol = 0.25, at = 0, slideTo = null, bus = null } = {}) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus || master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

let noiseBuf = null;
function noise({ dur = 0.1, vol = 0.2, at = 0, freq = 1000, type = 'bandpass', bus = null } = {}) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  src.buffer = noiseBuf;
  f.type = type;
  f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(bus || master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

const arp = (notes, step, opts) => notes.forEach((f, i) => tone(f, { ...opts, at: i * step }));

const SYNTH = {
  button: () => { tone(620, { dur: 0.05, type: 'square', vol: 0.07, slideTo: 420 }); noise({ dur: 0.03, freq: 2500, vol: 0.05 }); },
  select: () => { tone(880, { dur: 0.06, type: 'triangle', vol: 0.12 }); tone(1320, { at: 0.03, dur: 0.05, type: 'triangle', vol: 0.06 }); },
  start: () => {
    tone(90, { dur: 0.25, type: 'sine', vol: 0.5, slideTo: 50 });          // thump
    noise({ dur: 0.15, freq: 300, type: 'lowpass', vol: 0.35 });
    arp([392, 523, 659, 784, 1047], 0.06, { dur: 0.22, vol: 0.12, type: 'square' });
    tone(1047, { at: 0.3, dur: 0.6, type: 'triangle', vol: 0.12 });
    noise({ at: 0.05, dur: 0.9, freq: 3000, vol: 0.06 });                  // crowd-ish shimmer
  },
  tick: () => tone(1800, { dur: 0.03, vol: 0.06 }),
  counterTick: ({ up }) => tone(up ? 2300 + Math.random() * 300 : 1100 + Math.random() * 150, { dur: 0.035, type: 'triangle', vol: 0.07 }),
  ding: () => { tone(1320, { dur: 0.5, type: 'sine', vol: 0.25 }); tone(1980, { dur: 0.4, type: 'sine', vol: 0.08 }); },
  clink: () => { tone(2400, { dur: 0.12, type: 'triangle', vol: 0.2 }); tone(3200, { at: 0.04, dur: 0.15, type: 'triangle', vol: 0.12 }); },
  coins: () => {
    for (let i = 0; i < 12; i++) tone(1800 + Math.random() * 1800, { at: i * 0.035, dur: 0.1, type: 'triangle', vol: 0.14 });
    noise({ dur: 0.45, freq: 5000, vol: 0.08 });
  },
  allIn: ({ bus }) => {
    tone(70, { dur: 0.45, type: 'sine', vol: 0.75, slideTo: 35, bus });
    noise({ dur: 0.35, freq: 250, type: 'lowpass', vol: 0.5, bus });
    tone(220, { dur: 0.5, type: 'sawtooth', vol: 0.1, slideTo: 880, bus });
    tone(330, { at: 0.08, dur: 0.45, type: 'square', vol: 0.06, slideTo: 990, bus });
    noise({ at: 0.05, dur: 0.5, freq: 6000, vol: 0.07, bus });
  },
  payout: () => {
    // Coins spilling out of a machine for about 1.5 s
    for (let i = 0; i < 34; i++) {
      const at = i * 0.045 + Math.random() * 0.02;
      tone(2200 + Math.random() * 2200, { at, dur: 0.09, type: 'triangle', vol: 0.09 * (1 - i / 40) });
    }
    arp([1047, 1319, 1568, 2093], 0.09, { dur: 0.3, type: 'square', vol: 0.06 });
  },
  thunk: () => {
    tone(120, { dur: 0.25, type: 'sine', vol: 0.6, slideTo: 45 });
    tone(240, { dur: 0.08, type: 'square', vol: 0.12, slideTo: 120 });
    noise({ dur: 0.08, freq: 500, type: 'lowpass', vol: 0.45 });
  },
  clock: ({ loud }) => tone(loud ? 1400 : 1000, { dur: 0.04, vol: loud ? 0.2 : 0.05 }),
  buzzer: () => { tone(140, { dur: 0.6, type: 'sawtooth', vol: 0.22 }); tone(147, { dur: 0.6, type: 'sawtooth', vol: 0.18 }); },
  drumroll: ({ dur }) => {
    // Snare roll that speeds up and swells toward the reveal
    for (let t = 0; t < dur;) {
      const p = t / dur;
      noise({ at: t, dur: 0.05, freq: 220 + 200 * p, type: 'lowpass', vol: 0.12 + 0.3 * p });
      noise({ at: t, dur: 0.03, freq: 2500, vol: 0.03 + 0.06 * p });
      t += 0.06 - 0.03 * p;
    }
  },
  lever: () => {
    // Ratchet clicks on the way down, a heavy clunk at the bottom, then a spring back
    for (let i = 0; i < 6; i++) {
      noise({ at: i * 0.035, dur: 0.025, freq: 1800 + i * 250, vol: 0.18 });
      tone(300 + i * 40, { at: i * 0.035, dur: 0.02, type: 'square', vol: 0.05 });
    }
    tone(95, { at: 0.24, dur: 0.35, type: 'sine', vol: 0.7, slideTo: 38 });
    tone(190, { at: 0.24, dur: 0.12, type: 'square', vol: 0.15, slideTo: 80 });
    noise({ at: 0.24, dur: 0.18, freq: 350, type: 'lowpass', vol: 0.55 });
    noise({ at: 0.24, dur: 0.05, freq: 4000, vol: 0.15 });
    tone(260, { at: 0.42, dur: 0.22, type: 'triangle', vol: 0.12, slideTo: 720 });
    tone(720, { at: 0.62, dur: 0.08, type: 'triangle', vol: 0.06, slideTo: 600 });
  },
  slotTick: () => tone(900 + Math.random() * 400, { dur: 0.03, vol: 0.06 }),
  reelStop: () => {
    tone(150, { dur: 0.15, type: 'sine', vol: 0.45, slideTo: 60 });
    noise({ dur: 0.06, freq: 600, type: 'lowpass', vol: 0.35 });
    tone(1400, { dur: 0.07, type: 'triangle', vol: 0.08 });
  },

  correct: ({ bus }) => arp([523, 659, 784, 1047], 0.07, { dur: 0.18, vol: 0.14, bus }),
  wrong: ({ bus }) => { tone(330, { dur: 0.25, type: 'sawtooth', slideTo: 220, vol: 0.16, bus }); tone(220, { at: 0.2, dur: 0.4, type: 'sawtooth', slideTo: 140, vol: 0.16, bus }); },
  win: ({ bus }) => arp([784, 988, 1175, 1568, 2093], 0.05, { dur: 0.2, vol: 0.13, bus }),
  lose: ({ bus }) => arp([392, 330, 262, 196], 0.12, { dur: 0.22, type: 'triangle', vol: 0.2, bus }),
  bust: ({ bus }) => { tone(300, { dur: 0.9, type: 'sawtooth', slideTo: 45, vol: 0.22, bus }); noise({ dur: 0.6, freq: 150, type: 'lowpass', vol: 0.3, bus }); },
  millionaire: ({ bus }) => {
    arp([523, 659, 784, 1047, 784, 1047, 1319, 1568], 0.12, { dur: 0.3, vol: 0.13, bus });
    arp([262, 330, 392, 523], 0.24, { dur: 0.5, type: 'triangle', vol: 0.12, bus });
    for (let i = 0; i < 20; i++) tone(2000 + Math.random() * 2000, { at: 1 + i * 0.05, dur: 0.1, type: 'triangle', vol: 0.08, bus });
  },
};

const EVENT_SOUNDS = new Set(['correct', 'wrong', 'win', 'lose', 'bust', 'millionaire', 'allIn']);

function play(name, opts = {}) {
  if (ctx && ctx.state === 'suspended') {
    // The first tap is still waking audio up: play as soon as it's ready instead of dropping it.
    ctx.resume().then(() => play(name, opts), () => {});
    return;
  }
  if (!ready()) return;
  let bus = null;
  if (EVENT_SOUNDS.has(name)) {
    // A newer event cuts off an older one so feedback never piles up.
    if (eventBus) {
      const old = eventBus;
      old.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      setTimeout(() => old.disconnect(), 400);
    }
    eventBus = ctx.createGain();
    eventBus.connect(master);
    bus = eventBus;
  }
  const vol = name === 'clock' ? (opts.loud ? 1 : 0.35) : 1;
  if (playFile(name, { vol, bus, maxDur: opts.dur ?? null })) return;
  SYNTH[name]?.({ ...opts, bus });
}

export const sfx = new Proxy({}, { get: (_, name) => (opts) => play(name, opts) });

export const audio = {
  /** Browsers block audio until a tap. Any tap unlocks it. */
  autoUnlock() {
    const unlock = () => {
      const c = ensure();
      if (c && c.state === 'suspended') c.resume();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  },
  get muted() { return muted; },
  setMuted(m) {
    muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* ignore */ }
    if (master) master.gain.value = m ? 0 : MASTER_VOLUME;
  },
};
