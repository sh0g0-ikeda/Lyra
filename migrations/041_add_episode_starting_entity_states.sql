-- Preserve legacy episodes as default-state stories until a user explicitly
-- chooses starting states. The constraint stays unvalidated for the first
-- rollout so existing rows are not rewritten or locked for a table scan.
ALTER TABLE episodes
  ADD COLUMN IF NOT EXISTS starting_entity_states JSONB DEFAULT '[]'::jsonb;

ALTER TABLE episodes
  ADD CONSTRAINT episodes_starting_entity_states_shape_check
  CHECK (
    starting_entity_states IS NULL
    OR (
      jsonb_typeof(starting_entity_states) = 'array'
      AND jsonb_array_length(starting_entity_states) <= 100
    )
  ) NOT VALID;
