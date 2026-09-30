ALTER TABLE episodes
  ADD COLUMN starting_entity_states JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE episodes
  ADD CONSTRAINT episodes_starting_entity_states_shape_check CHECK (
    jsonb_typeof(starting_entity_states) = 'array'
    AND jsonb_array_length(starting_entity_states) <= 100
  );
