ALTER TABLE episodes
  ADD COLUMN IF NOT EXISTS production_notes JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE episodes
  ADD CONSTRAINT episodes_production_notes_shape_check
  CHECK (
    jsonb_typeof(production_notes) = 'array'
    AND jsonb_array_length(production_notes) <= 24
  ) NOT VALID;

ALTER TABLE episodes VALIDATE CONSTRAINT episodes_production_notes_shape_check;
