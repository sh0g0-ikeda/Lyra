ALTER TABLE entity_states
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS reference_image JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE entity_states
SET updated_at = created_at
WHERE updated_at IS NULL;

ALTER TABLE entity_states
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE entity_states
  ADD CONSTRAINT entity_states_variant_name_description_check CHECK (
    (name IS NULL AND description IS NULL)
    OR (
      name IS NOT NULL AND description IS NOT NULL
      AND
      char_length(btrim(name)) BETWEEN 1 AND 100
      AND char_length(btrim(description)) BETWEEN 1 AND 2000
    )
  );

ALTER TABLE entity_states
  ADD CONSTRAINT entity_states_reference_image_object_check CHECK (
    reference_image IS NULL OR jsonb_typeof(reference_image) = 'object'
  );
