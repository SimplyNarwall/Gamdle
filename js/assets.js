// ASSET MANIFEST
// Every sound and image the game uses is a named slot here.
// null = use the built-in placeholder (synthesized sound or CSS drawing).
// To slot in a real asset: put the file under assets/ and set the path, e.g.
//   ding: 'assets/sounds/ding.mp3',
//   leverKnob: 'assets/images/lever-knob.png',
// No other code changes are needed. See assets/README.md for what each slot is.

export const SOUNDS = {
  // Interface sounds (short, subtle)
  button: null,      // generic button tap (wager chips, Next, Skip, Share...)
  select: null,      // highlighting an answer option
  start: null,       // "Start the show" (a bit bigger than a normal tap)
  tick: null,        // wheel passes a segment / score count-up
  counterTick: null, // token counter ticking up or down (played rapidly, slightly higher pitch going up)
  ding: null,        // wheel lands
  clink: null,       // single coin inserted
  coins: null,       // ALL IN pile of coins
  allIn: null,       // tapping ALL IN: a big hit / riser
  payout: null,      // coin rain on a Double or Nothing double (coins spilling out)
  thunk: null,       // Lock In "final answer"
  clock: null,       // question timer, once per second (played louder in the last 5 s)
  buzzer: null,      // time's up
  drumroll: null,    // anticipation before the answer reveal (cut to the suspense length, see js/tuning.js)
  lever: null,       // lever pull: chunky ratchet down, heavy clunk, spring back
  slotTick: null,    // slot reels spinning
  reelStop: null,    // one reel locking in place

  // Event feedback (bigger reactions after a result)
  correct: null,
  wrong: null,
  win: null,         // Double or Nothing win
  lose: null,        // Double or Nothing loss
  bust: null,
  millionaire: null, // the biggest one
};

export const IMAGES = {
  background: null,  // page background behind the machine
  logo: null,        // marquee logo (replaces the GAMDLE text)
  cabinet: null,     // machine body texture
  leverKnob: null,   // ball on top of the lever
  leverArm: null,    // lever stick (drawn vertically, pivots at the bottom)
  leverHub: null,    // round base the lever pivots on
  coin: null,        // coin dropped into the slot
  coinSlot: null,    // coin slot panel
  pointer: null,     // wheel pointer (points down)
  wheelRim: null,    // ring around the wheel; stays still while the segments spin inside it
  bulb: null,        // one light bulb, used for the marquee and side lights (see assets/README.md)
};
