-- Compatibility checkpoint for page story metadata.
--
-- story_source_scene_ids, story_page_purpose, and story_continuity_note are
-- already persisted in pages.layout_config by the current PageRepository and
-- PageService. Keep that established JSON contract instead of adding duplicate
-- physical columns that would require dual writes and a later cutover.

