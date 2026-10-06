-- Forward repair for production databases that recorded the earlier
-- layout-config preservation migration without adding these normalized columns.
ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS story_source_scene_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN IF NOT EXISTS story_page_purpose TEXT,
  ADD COLUMN IF NOT EXISTS story_continuity_note TEXT;

UPDATE pages
SET story_source_scene_ids = CASE
      WHEN cardinality(story_source_scene_ids) = 0 THEN COALESCE(
        ARRAY(
          SELECT value::UUID
          FROM jsonb_array_elements_text(COALESCE(layout_config->'story_source_scene_ids', '[]'::jsonb)) AS source(value)
          WHERE value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ),
        ARRAY[]::UUID[]
      )
      ELSE story_source_scene_ids
    END,
    story_page_purpose = COALESCE(story_page_purpose, NULLIF(BTRIM(layout_config->>'story_page_purpose'), '')),
    story_continuity_note = COALESCE(story_continuity_note, NULLIF(BTRIM(layout_config->>'story_continuity_note'), ''));
