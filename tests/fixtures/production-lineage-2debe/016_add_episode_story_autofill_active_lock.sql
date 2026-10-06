-- lyra:migration no-transaction

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_jobs_active_episode_story_autofill_resource
  ON generation_jobs ((params->>'episode_id'))
  WHERE job_type = 'episode_story_autofill'
    AND status IN ('queued', 'processing')
    AND params ? 'episode_id';
