# Assets

The game runs without any files here: every slot has a placeholder (synthesized sound or a CSS drawing). To swap in real art or audio:

1. Drop the file in `assets/sounds/` or `assets/images/`.
2. Set its path in `js/assets.js`, for example `ding: 'assets/sounds/ding.mp3'`.
3. Refresh. Nothing else changes.

Colors, fonts and wheel segment colors live in `css/theme.css`.

## Sounds

Use `.mp3` (plays everywhere). Keep them short and trimmed of silence at the start, since they fire on taps.

| Slot | When it plays | Length guide |
| --- | --- | --- |
| `button` | Any button tap (wager chips, Next, Skip, Share, mute) | very short, subtle |
| `select` | Highlighting an answer option | very short |
| `start` | "Start the show" button, a mini fanfare | under 1 s |
| `tick` | Wheel passes a segment, score count-up | very short click |
| `counterTick` | Token counter ticking up or down (plays rapidly) | very short click |
| `ding` | Wheel lands, count-up finishes | under 0.5 s |
| `clink` | Coin inserted | under 0.3 s |
| `coins` | ALL IN (pile of coins) | under 0.6 s |
| `allIn` | Tapping the ALL IN button: a big hit or riser | under 0.8 s |
| `payout` | Coins spilling out during the coin rain on a double | about 1.5 s |
| `thunk` | Lock In | under 0.3 s |
| `clock` | Question timer, every second. Played louder in the last 5 s | very short |
| `buzzer` | Time's up | under 0.7 s |
| `drumroll` | Before the answer reveal. Cut to the suspense length (1.2 to 2.4 s by default, see `js/tuning.js`), so make it 3 s long | 3 s |
| `lever` | Lever pull: ratchet down, heavy clunk at about 0.24 s (lines up with the screen shake), spring back | under 0.8 s |
| `slotTick` | Slot reels spinning | very short |
| `reelStop` | One reel locking in (plays 3 times) | under 0.3 s |
| `correct` | Event: right answer | about 1 s |
| `wrong` | Event: wrong answer or timeout | about 1 s |
| `win` | Event: Double or Nothing win | about 1 s |
| `lose` | Event: Double or Nothing loss | about 1 s |
| `bust` | Event: stack hits 0 | 1 to 1.5 s |
| `millionaire` | MILLIONAIRE celebration (the biggest one) | up to 4 s |

Event sounds (`correct` to `millionaire`) cut each other off, so a new one never stacks on an old one.

## Images

PNG or SVG with a transparent background. Each is scaled to fit its slot.

| Slot | What it is | Shape guide |
| --- | --- | --- |
| `background` | Page background behind the machine | large, covers the page |
| `logo` | Marquee logo, replaces the GAMDLE text | wide, about 4:1 |
| `cabinet` | Machine body texture behind the screen | tall, stretched to cover |
| `leverKnob` | Ball on top of the lever | square |
| `leverArm` | Lever stick, drawn upright, pivots at the bottom | tall and thin, about 1:14 |
| `leverHub` | Round base the lever pivots on | square |
| `coin` | Coin that drops into the slot | square |
| `coinSlot` | Coin slot plate | about 3:2 |
| `pointer` | Wheel pointer, pointing down | square |
| `wheelRim` | Ring around the wheel. Stays still; the colored segments and category labels spin inside it and are drawn in code. Transparent center; the wheel fills the middle 85% or so (the image is drawn 18% larger than the wheel so the ring overlaps its edge) | square |
| `bulb` | One light bulb, used for every marquee and side light | square, small (about 32x32 px) |

Animations (lever pull, coin drop, wheel spin) move these images, so the art itself can be static.

The `coin` image is used everywhere a coin appears: the token counter, the bet box, the coins funneling in on ALL IN, and the coin rain.

## Lights

The `bulb` slot replaces every bulb, on the marquee and down both sides. Draw it **lit**, in a light or white-ish color. The code handles the rest:

- Blinking, chasing (suspense and lever pull) and dimming are done by changing the bulb's brightness, so one lit image is enough. No "off" version needed.
- The multicolor win mode tints the image by rotating its hue, which is why a light, neutral bulb works best. A strongly colored bulb will still cycle, just starting from its own color.

How many bulbs there are and where they sit is set in `buildBulbs()` in `js/main.js` (12 per marquee row, 9 per side). Their size is `.bulb` and `.side-lights .bulb` in `css/style.css`.

## Adding a brand new image slot

For art that has no slot yet (for example a separate side-light style):

1. Add a name to `IMAGES` in `js/assets.js`, e.g. `sideBulb: 'assets/images/side-bulb.png'`.
2. In `css/style.css`, add a rule that uses it. Every set slot becomes a `--img-<name>` variable and an `img-<name>` class on the page, e.g.
   `.img-sideBulb .side-lights .bulb { background: var(--img-sideBulb) center / contain no-repeat !important; }`
That's it: no other code reads the images.
