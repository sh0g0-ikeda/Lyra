ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_job_type_check
  CHECK (job_type IN ('page_generate', 'entity_generate')) NOT VALID;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_status_check
  CHECK (status IN ('queued', 'processing', 'completed', 'failed')) NOT VALID;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_generation_mode_check
  CHECK (generation_mode IS NULL OR generation_mode IN ('standard', 'thinking')) NOT VALID;

ALTER TABLE generation_jobs VALIDATE CONSTRAINT generation_jobs_job_type_check;
ALTER TABLE generation_jobs VALIDATE CONSTRAINT generation_jobs_status_check;
ALTER TABLE generation_jobs VALIDATE CONSTRAINT generation_jobs_generation_mode_check;
