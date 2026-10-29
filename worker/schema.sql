CREATE TABLE IF NOT EXISTS results (
  day INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  busted INTEGER NOT NULL,
  picks TEXT NOT NULL,          -- JSON object { questionNumber: pickedIndex } for the 5 questions spun (null = timeout)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (day, player_id)
);
CREATE INDEX IF NOT EXISTS idx_results_day ON results (day);
