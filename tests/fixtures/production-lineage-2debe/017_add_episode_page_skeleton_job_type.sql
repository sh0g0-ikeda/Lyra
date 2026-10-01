-- lyra:migration no-transaction

ALTER TABLE generation_jobs
  DROP CONSTRAINT IF EXISTS generation_jobs_job_type_check;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_job_type_check
  CHECK (job_type IN ('page_generate', 'entity_generate', 'episode_story_autofill', 'episode_page_skeleton')) NOT VALID;

ALTER TABLE generation_jobs VALIDATE CONSTRAINT generation_jobs_job_type_check;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_jobs_active_episode_page_skeleton_resource
  ON generation_jobs ((params->>'episode_id'))
  WHERE job_type = 'episode_page_skeleton'
    AND status IN ('queued', 'processing')
    AND params ? 'episode_id';
