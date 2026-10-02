-- Legacy synchronous imports remain unchanged. Only the gated quoted route emits this job.
ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_job_type_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_job_type_check
  CHECK (job_type IN ('page_generate', 'entity_generate', 'episode_story_autofill', 'episode_page_skeleton', 'entity_import_analysis')) NOT VALID;
ALTER TABLE generation_jobs VALIDATE CONSTRAINT generation_jobs_job_type_check;
