// Global settings. Shared by the browser, the question checker and the stats Worker.
export const CONFIG = {
  // Day 1. Changing this after launch renumbers every day, so set it once.
  LAUNCH_DATE: '2026-10-27',
  TIME_ZONE: 'America/Chicago',
  QUESTION_SECONDS: 30,

  // Base URL of the Cloudflare Worker, for example 'https://gamdle-stats.yourname.workers.dev'.
  // Leave null until the Worker is deployed: the results screen then shows "Worldwide stats unavailable".
  STATS_URL: 'https://gamdle-stats.gamdle.workers.dev',
  STATS_TIMEOUT_MS: 5000,
};
