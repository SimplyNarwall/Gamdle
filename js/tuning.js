// GAME FEEL: every timing, zoom and shake strength in one place. Tweak freely.
// Times are in milliseconds. Shake values are roughly pixels of movement.
// Reduced-motion players get no shake or zoom, and quick versions of the long animations.

export const FEEL = {
  // Suspense before the answer reveal, scaled by how much of the stack is bet.
  // A tiny bet waits revealMin, all in waits revealMax. A 0 bet (or bust) reveals instantly.
  revealMin: 1200,
  revealMax: 2400,

  // Whole-view zoom toward the screen during that suspense, scaled the same way.
  // It punches in fast (zoomPunchMs), creeps a little further while you wait, then snaps back on the reveal.
  zoomMin: 1.02,
  zoomMax: 1.05,
  zoomAllIn: 1.08,    // extra push for ALL IN
  zoomPunchMs: 420,   // ease-in time to the zoom (higher = smoother, slower)
  zoomCreep: 0.008,
  zoomReleaseMs: 140,

  allInCoins: 16,     // coins that funnel into the slot on an ALL IN
  partyMs: 2400,      // multicolor marquee lights after a Double or Nothing win
  coinRain: 40,       // coins raining down on a double (MILLIONAIRE gets 2.5x)
  coinRainMs: 1900,

  coinMs: 650,        // coin-insert animation before the question shows
  counterMinMs: 500,  // token counter tick: small changes take this long...
  counterMaxMs: 1100, // ...and big ones up to this
  wheelSpinMs: 2200,  // wheel spin
  slotSpinMs: 2600,   // Double or Nothing reels (the 3 reels stop at 55%, 78% and 100% of this)
  leverClunkMs: 240,  // when the lever hits bottom in its pull animation (shake + clunk land here)

  // Screen shake strength per moment. 0 turns one off.
  shake: {
    start: 6,
    allIn: 9,         // tapping the ALL IN button
    allInConfirm: 10, // confirming an ALL IN bet
    lockIn: 4,
    coinMin: 2,       // coin insert, tiny bet
    coinMax: 7,       // coin insert, all in
    lever: 7,         // lever hits bottom
    reelStop: 3,      // each reel locking in
    correct: 3,
    wrong: 7,
    leverWin: 6,
    leverLoss: 9,
    bust: 16,
    millionaire: 12,
  },
};
