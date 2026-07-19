CREATE TABLE IF NOT EXISTS analytics_daily (
  day TEXT NOT NULL,
  path TEXT NOT NULL CHECK (path = '/'),
  referrer_host TEXT NOT NULL DEFAULT '' CHECK (referrer_host IN ('', 'Direct', 'GitHub', 'Google', 'Other')),
  event_type TEXT NOT NULL CHECK (event_type IN ('page_view', 'project_click')),
  project_id TEXT NOT NULL DEFAULT '',
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  CHECK (
    (event_type = 'page_view' AND project_id = '' AND referrer_host <> '') OR
    (event_type = 'project_click' AND project_id <> '' AND referrer_host = '')
  ),
  PRIMARY KEY (day, path, referrer_host, event_type, project_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_analytics_daily_event_day
  ON analytics_daily (event_type, day DESC);

CREATE TRIGGER IF NOT EXISTS prune_analytics_daily_after_insert
AFTER INSERT ON analytics_daily
BEGIN
  DELETE FROM analytics_daily WHERE day < date('now', '-179 day');
END;
