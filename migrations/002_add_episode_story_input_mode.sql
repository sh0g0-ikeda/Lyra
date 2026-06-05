ALTER TABLE episodes
  ADD COLUMN story_input_mode TEXT NOT NULL DEFAULT 'structured',
  ADD COLUMN story_full_draft TEXT;

UPDATE episodes
SET story_input_mode = 'structured'
WHERE story_input_mode IS NULL;

ALTER TABLE episodes
  ADD CONSTRAINT episodes_story_input_mode_check
  CHECK (story_input_mode IN ('structured', 'full'));
