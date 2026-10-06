ALTER TABLE generation_jobs
  DROP CONSTRAINT IF EXISTS generation_jobs_job_type_check;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_job_type_check
  CHECK (job_type IN ('page_generate', 'entity_generate', 'episode_story_autofill')) NOT VALID;

ALTER TABLE generation_jobs VALIDATE CONSTRAINT generation_jobs_job_type_check;
