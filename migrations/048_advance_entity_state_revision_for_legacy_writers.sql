-- Spec 11 C0: legacy writers update the same row without knowing updated_at.
-- Preserve every durable field; only advance the pending-confirmation revision.
-- No cross-table writes/locks and no rewrite of existing rows or saved images.
CREATE FUNCTION lyra_advance_entity_state_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;
  NEW.updated_at := GREATEST(
    date_trunc('milliseconds', clock_timestamp()),
    date_trunc('milliseconds', COALESCE(OLD.updated_at, OLD.created_at)) + INTERVAL '1 millisecond',
    date_trunc('milliseconds', NEW.updated_at)
  );
  RETURN NEW;
END
$$;

CREATE TRIGGER entity_states_monotonic_revision
BEFORE UPDATE ON entity_states
FOR EACH ROW EXECUTE FUNCTION lyra_advance_entity_state_revision();
