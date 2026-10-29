# Gamdle

A daily trivia game show. Spin for a category, bet your tokens, answer in 30 seconds, then pull the lever for double or nothing. Full design in `gamdle-spec.md`.

Static site for GitHub Pages, no build step. Plain HTML, CSS and JavaScript modules.

## Run it locally

You need a local web server (opening `index.html` straight from disk won't work, since browsers block JS modules on `file://`).

```sh
npm run serve          # or: python3 -m http.server 8000
```

Then open http://localhost:8000. Any static server works (VS Code Live Server, `npx serve`, etc).

### Dev switches (add to the URL)

| URL | What it does |
| --- | --- |
| `?reset` | Wipes today's saved game so you can replay |
| `?day=2` | Plays a specific day from `questions.json` (doesn't touch your stats or the server) |
| `?mockstats` | Fills the results screen with fake worldwide stats, no server needed |
| `?lever=win` / `?lever=lose` | Forces every Double or Nothing pull to win / lose |
| `?showanswer` | Outlines the correct option on each question |
| `?reset&mockstats` | The usual combo while building |
| `?reset&mockstats&lever=win&showanswer` | MILLIONAIRE test: go ALL IN, pick the outlined answer, pull every time |
| `?reset&mockstats&lever=lose` | Bust test: go ALL IN and answer wrong, or pull after a win |

Games with `?day`, `?lever` or `?showanswer` never count toward your personal stats or get sent to the stats server.

Without `?mockstats` and with no stats server configured, results show "Worldwide stats unavailable", which is the intended fallback.

Handy browser tools:
- **Phone layout:** DevTools device toolbar (Ctrl+Shift+M / Cmd+Shift+M). Or open `http://<your-computer's-LAN-IP>:8000` on your phone on the same Wi-Fi.
- **Save and resume:** refresh or close the tab mid-game. You should land on the same step. Leave mid-question past 30 s and it resolves as timed out.
- **Saved state:** DevTools > Application > Local Storage. Keys start with `gamdle.`
- **Reduced motion:** DevTools > Rendering > "Emulate CSS prefers-reduced-motion".

### Checks

```sh
npm test         # rule tests (payouts, lever roll, bins, share text, Chicago midnight) + Worker tests
npm run check    # validates questions.json
npm run hooks    # once: runs the questions check automatically before every git push
```

Node 18+ needed for these (the game itself needs nothing).

## Project layout

```
index.html            the machine
css/theme.css         colors, fonts, wheel colors
css/style.css         layout and placeholder art
js/assets.js          ASSET MANIFEST: every sound and image slot
js/tuning.js          GAME FEEL: suspense length, zoom, slot spin time, screen shake
js/config.js          launch date, time zone, stats server URL
js/rules.js           pure game rules (shared with the Worker)
js/main.js            screens and play loop
js/audio.js           sound playback (files or synth placeholders)
js/storage.js         localStorage: saved game, personal stats
js/stats.js           stats server calls + ?mockstats data
questions.json        all days, appended over time
scripts/              questions.json checker
tests/                rule tests
worker/               Cloudflare Worker + D1 stats server
assets/               drop art and sound files here (see assets/README.md)
```

## Art and sound

Everything has a placeholder so the game is playable now. To slot in real assets, put the file in `assets/` and set its path in `js/assets.js`. Slot list, sizes and timing guidance: `assets/README.md`.

## Adding questions

Each day is a **pool of 8 questions** (numbered 1 to 8, each with a different category). Players spin 5 of them. Append days to the end of `questions.json`, then `npm run check`. Day N must have `"day": N` and a date one day after the previous one, starting from `LAUNCH_DATE` in `js/config.js`. Never edit or reorder days that have already been played.

## Deploying

### 1. The game (GitHub Pages)

1. Set `LAUNCH_DATE` in `js/config.js` to your real day 1, and make sure `questions.json` has days starting from that date (`npm run check`).
2. Push the folder to the root of your GitHub repo.
3. On GitHub: **Settings > Pages > Build and deployment > Deploy from a branch**, branch `main`, folder `/ (root)`, Save.
4. After a minute it's live at `https://<your-username>.github.io/<repo>/`. The `.nojekyll` file makes Pages serve every file as is.

Without the stats server the game is fully playable. Results just show "Worldwide stats unavailable".

### 2. The stats server (Cloudflare Worker)

You need a free Cloudflare account and Node 18 or newer. Run everything from the `worker` folder.

```sh
cd worker
npx wrangler login                       # opens a browser to sign in to Cloudflare
npx wrangler d1 create gamdle            # creates the database and prints its database_id
```

Paste that `database_id` into `worker/wrangler.toml`, replacing `REPLACE_WITH_YOUR_D1_ID`. Also check the two `[vars]`:

- `ALLOWED_ORIGINS`: your site's origin, which is just `https://<your-username>.github.io` (no repo path). Keep `http://localhost:8000` for local testing.
- `QUESTIONS_URL`: the full URL of your live `questions.json`, e.g. `https://<your-username>.github.io/<repo>/questions.json`. The Worker reads the answer key from here, so the site must be deployed first.

Then create the table and deploy:

```sh
npx wrangler d1 execute gamdle --remote --file=schema.sql
npx wrangler deploy                      # prints your Worker URL
```

The deploy prints a URL like `https://gamdle-stats.<your-subdomain>.workers.dev`.

1. **Check it works:** open `<Worker URL>/api/stats?day=1` in a browser. You should see `{"stats":{"players":0,...}}`.
2. **Connect the game:** set `STATS_URL` in `js/config.js` to the Worker URL (no trailing slash), commit and push.
3. **Check it end to end:** play a game on the live site, without dev switches (those games aren't sent). The results should show "Based on 1 player today".

**Redeploy the Worker (`npx wrangler deploy`) whenever you change `js/rules.js` or `js/config.js`** (for example the launch date). The Worker bundles both files, so it would otherwise score games with the old rules. Adding questions does not need a redeploy, since the Worker re-reads `questions.json` every few minutes.

If `wrangler deploy` complains about the `compatibility_date`, set it in `wrangler.toml` to the date it suggests.

### Testing the Worker locally

`npm test` already runs the Worker code against an in-memory database (Node 22.5+; skipped on older Node). To run the real thing locally alongside the game:

```sh
cd worker
npx wrangler d1 execute gamdle --local --file=schema.sql
npx wrangler dev --var QUESTIONS_URL:http://localhost:8000/questions.json
```

Then, with the game running on `npm run serve`, temporarily set `STATS_URL` to `http://localhost:8787` and play a game. Set it back before pushing.
