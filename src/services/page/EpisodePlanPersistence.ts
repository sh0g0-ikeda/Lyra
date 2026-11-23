import type { EpisodePagePlanApplyResult, EpisodePagePlanContext } from '../../domain/types/page.js';
import type { GenerationJob } from '../../domain/types/job.js';
import type { EpisodeUnresolvedStateTransition } from '../../domain/types/episodeStateTransition.js';
import type { PersistedEpisodeStateChange } from '../../domain/types/episodeStateChange.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import type { PanelRepository } from '../../repositories/PanelRepository.js';
import type { PanelEntityAssignmentServicePort } from './PanelEntityAssignmentService.js';

export interface EpisodePlanPersistenceResources {
  pageRepository: PageRepository;
  panelRepository: PanelRepository;
  panelEntityAssignmentService: PanelEntityAssignmentServicePort;
  /** Runs under the same planning locks and transaction as panel writes and job completion. */
  persistStateChanges?: (
    changes: readonly EpisodeUnresolvedStateTransition[],
  ) => Promise<readonly PersistedEpisodeStateChange[]>;
  completeStoryAutofillJob?: (
    jobId: string,
    userId: string,
    result: EpisodePagePlanApplyResult,
  ) => Promise<boolean>;
  storyAutofillCommitStarted?: boolean;
  updateStoryAutofillProgress?: (input: {
    stage: string;
    message: string;
    currentChunk: number | null;
    totalChunks: number | null;
  }) => Promise<boolean>;
}

export interface EpisodePlanPersistenceInput {
  episodeId: string;
  userId: string;
  organizationId: string | null;
  storyAutofillAttempt?: GenerationJob;
}

export interface EpisodePlanPersistencePort {
  withLockedEpisodePlan<T>(
    input: EpisodePlanPersistenceInput,
    work: (
      context: EpisodePagePlanContext,
      resources: EpisodePlanPersistenceResources,
    ) => Promise<T>,
  ): Promise<T>;
}
