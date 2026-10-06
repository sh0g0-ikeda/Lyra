ALTER TABLE works
  ADD CONSTRAINT works_status_check
  CHECK (status IN ('draft', 'reviewing', 'ready')) NOT VALID;

ALTER TABLE chapters
  ADD CONSTRAINT chapters_status_check
  CHECK (status IN ('draft', 'reviewing', 'ready')) NOT VALID;

ALTER TABLE episodes
  ADD CONSTRAINT episodes_status_check
  CHECK (status IN ('draft', 'reviewing', 'ready')) NOT VALID;

ALTER TABLE scenes
  ADD CONSTRAINT scenes_status_check
  CHECK (status IN ('draft', 'reviewing', 'ready')) NOT VALID;

ALTER TABLE entities
  ADD CONSTRAINT entities_status_check
  CHECK (status IN ('draft', 'ready')) NOT VALID;

ALTER TABLE reference_sets
  ADD CONSTRAINT reference_sets_status_check
  CHECK (status IN ('empty', 'partial', 'ready')) NOT VALID;

ALTER TABLE pages
  ADD CONSTRAINT pages_status_check
  CHECK (status IN ('designing', 'generating', 'generated', 'editing', 'confirmed')) NOT VALID;

ALTER TABLE pages
  ADD CONSTRAINT pages_dialogue_mode_check
  CHECK (dialogue_mode IN ('image_baked', 'balloon_only', 'mixed')) NOT VALID;

ALTER TABLE pages
  ADD CONSTRAINT pages_generation_mode_check
  CHECK (generation_mode IS NULL OR generation_mode IN ('standard', 'thinking')) NOT VALID;

ALTER TABLE panels
  ADD CONSTRAINT panels_panel_role_check
  CHECK (panel_role IS NULL OR panel_role IN ('establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact')) NOT VALID;

ALTER TABLE panels
  ADD CONSTRAINT panels_panel_size_check
  CHECK (panel_size IS NULL OR panel_size IN ('standard', 'large', 'wide', 'narrow', 'splash')) NOT VALID;

ALTER TABLE panel_frames
  ADD CONSTRAINT panel_frames_border_style_check
  CHECK (border_style IS NULL OR border_style IN ('solid', 'dashed', 'none')) NOT VALID;

ALTER TABLE balloons
  ADD CONSTRAINT balloons_balloon_type_check
  CHECK (balloon_type IN ('speech', 'thought', 'narration', 'shout', 'whisper', 'sfx', 'caption')) NOT VALID;

ALTER TABLE balloons
  ADD CONSTRAINT balloons_writing_mode_check
  CHECK (writing_mode IS NULL OR writing_mode IN ('vertical', 'horizontal')) NOT VALID;

ALTER TABLE balloons
  ADD CONSTRAINT balloons_font_family_check
  CHECK (font_family IS NULL OR font_family IN ('manga_gothic', 'mincho', 'rounded', 'bold')) NOT VALID;

ALTER TABLE works VALIDATE CONSTRAINT works_status_check;
ALTER TABLE chapters VALIDATE CONSTRAINT chapters_status_check;
ALTER TABLE episodes VALIDATE CONSTRAINT episodes_status_check;
ALTER TABLE scenes VALIDATE CONSTRAINT scenes_status_check;
ALTER TABLE entities VALIDATE CONSTRAINT entities_status_check;
ALTER TABLE reference_sets VALIDATE CONSTRAINT reference_sets_status_check;
ALTER TABLE pages VALIDATE CONSTRAINT pages_status_check;
ALTER TABLE pages VALIDATE CONSTRAINT pages_dialogue_mode_check;
ALTER TABLE pages VALIDATE CONSTRAINT pages_generation_mode_check;
ALTER TABLE panels VALIDATE CONSTRAINT panels_panel_role_check;
ALTER TABLE panels VALIDATE CONSTRAINT panels_panel_size_check;
ALTER TABLE panel_frames VALIDATE CONSTRAINT panel_frames_border_style_check;
ALTER TABLE balloons VALIDATE CONSTRAINT balloons_balloon_type_check;
ALTER TABLE balloons VALIDATE CONSTRAINT balloons_writing_mode_check;
ALTER TABLE balloons VALIDATE CONSTRAINT balloons_font_family_check;
