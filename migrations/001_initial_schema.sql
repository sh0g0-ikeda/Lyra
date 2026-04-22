CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  stripe_customer_id TEXT UNIQUE,
  plan_code TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_supabase_id ON users(supabase_id);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE credit_balances (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_credits INTEGER NOT NULL DEFAULT 0 CHECK (monthly_credits >= 0),
  purchased_credits INTEGER NOT NULL DEFAULT 0 CHECK (purchased_credits >= 0),
  monthly_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  monthly_after INTEGER NOT NULL CHECK (monthly_after >= 0),
  purchased_after INTEGER NOT NULL CHECK (purchased_after >= 0),
  description TEXT,
  stripe_event_id TEXT,
  job_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_credit_ledger_user ON credit_ledger(user_id, created_at DESC);

CREATE TABLE payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  stripe_checkout_session_id TEXT,
  stripe_invoice_id TEXT,
  kind TEXT NOT NULL,
  amount_jpy INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE processed_stripe_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE works (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  genre TEXT,
  world_setting TEXT,
  theme TEXT,
  main_entity_ids UUID[] DEFAULT '{}',
  starting_point TEXT,
  ending_point TEXT,
  overall_flow TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  edit_history JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_works_user ON works(user_id, created_at DESC);

CREATE TABLE chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  title TEXT,
  purpose TEXT,
  starting_state TEXT,
  ending_state TEXT,
  emotion_curve TEXT,
  entities_involved UUID[] DEFAULT '{}',
  key_beats TEXT[] DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  edit_history JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(work_id, "order")
);

CREATE TABLE episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  title TEXT,
  purpose TEXT,
  introduction TEXT,
  middle TEXT,
  climax TEXT,
  ending_hook TEXT,
  estimated_pages INTEGER DEFAULT 16,
  entities_involved UUID[] DEFAULT '{}',
  page_skeleton_generated BOOLEAN DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  edit_history JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(chapter_id, "order")
);

CREATE TABLE scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  location TEXT,
  time TEXT,
  atmosphere TEXT,
  involved_entity_ids UUID[] DEFAULT '{}',
  entity_states JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(episode_id, "order")
);

CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL DEFAULT 'character' CHECK (entity_type IN ('character', 'nonhuman', 'object')),
  name TEXT NOT NULL,
  free_description TEXT,
  structured_fields JSONB DEFAULT '{}',
  prompt_supplement TEXT,
  speech_profile JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_entities_work ON entities(work_id);

CREATE TABLE reference_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL UNIQUE REFERENCES entities(id) ON DELETE CASCADE,
  reference_images JSONB NOT NULL DEFAULT '[]',
  primary_ref_id TEXT,
  status TEXT NOT NULL DEFAULT 'empty',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE entity_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  scene_id UUID REFERENCES scenes(id) ON DELETE SET NULL,
  costume_note TEXT,
  costume_ref_id TEXT,
  condition_note TEXT,
  hair_note TEXT,
  expression_default TEXT DEFAULT 'neutral',
  extra_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_entity_states_entity ON entity_states(entity_id);

CREATE TABLE pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  scene_id UUID REFERENCES scenes(id),
  page_number INTEGER NOT NULL,
  layout_config JSONB NOT NULL DEFAULT '{}',
  dialogue_mode TEXT NOT NULL DEFAULT 'image_baked',
  page_dialogue_toggle BOOLEAN NOT NULL DEFAULT TRUE,
  generated_image JSONB DEFAULT NULL,
  generation_mode TEXT,
  status TEXT NOT NULL DEFAULT 'designing',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(episode_id, page_number)
);
CREATE INDEX idx_pages_episode ON pages(episode_id, page_number);

CREATE TABLE panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  panel_role TEXT DEFAULT 'action',
  panel_size TEXT DEFAULT 'standard',
  situation_text TEXT,
  entities JSONB NOT NULL DEFAULT '[]',
  composition JSONB NOT NULL DEFAULT '{}',
  dialogue_in_panel BOOLEAN DEFAULT TRUE,
  dialogue JSONB NOT NULL DEFAULT '[]',
  sfx_text TEXT,
  background_note TEXT,
  panel_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(page_id, "order")
);

CREATE TABLE panel_frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  panel_id UUID REFERENCES panels(id),
  vertices JSONB NOT NULL,
  border_style TEXT DEFAULT 'solid',
  border_width INTEGER DEFAULT 3,
  border_color TEXT DEFAULT '#000000',
  z_index INTEGER DEFAULT 1,
  reading_order INTEGER NOT NULL
);

CREATE TABLE balloons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  speaker_entity_id UUID REFERENCES entities(id),
  balloon_type TEXT NOT NULL DEFAULT 'speech',
  writing_mode TEXT DEFAULT 'vertical',
  text TEXT NOT NULL DEFAULT '',
  position JSONB NOT NULL,
  tail JSONB,
  font_size INTEGER DEFAULT 18,
  font_family TEXT DEFAULT 'manga_gothic',
  panel_order_reference INTEGER,
  z_index INTEGER DEFAULT 10
);
CREATE INDEX idx_balloons_page ON balloons(page_id);

CREATE TABLE generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  generation_mode TEXT,
  credit_cost INTEGER NOT NULL CHECK (credit_cost >= 0),
  params JSONB NOT NULL,
  result JSONB,
  sqs_message_id TEXT,
  openai_request_id TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);
CREATE INDEX idx_jobs_user ON generation_jobs(user_id, created_at DESC);
CREATE INDEX idx_jobs_status ON generation_jobs(status);

CREATE TABLE composition_gallery (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  entity_count INTEGER NOT NULL,
  preview_s3_key TEXT NOT NULL,
  preview_cdn_url TEXT NOT NULL,
  composition_prompt TEXT NOT NULL,
  shot_type TEXT NOT NULL,
  angle TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
