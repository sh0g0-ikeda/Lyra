-- lyra:migration no-transaction

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_jobs_active_page_resource
  ON generation_jobs ((params->>'page_id'))
  WHERE job_type = 'page_generate'
    AND status IN ('queued', 'processing')
    AND params ? 'page_id';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_jobs_active_entity_resource
  ON generation_jobs ((params->>'entity_id'))
  WHERE job_type = 'entity_generate'
    AND status IN ('queued', 'processing')
    AND params ? 'entity_id';
