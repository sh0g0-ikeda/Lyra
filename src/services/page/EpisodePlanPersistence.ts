import type { EpisodePagePlanContext } from '../../domain/types/page.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import type { PanelRepository } from '../../repositories/PanelRepository.js';
import type { PanelEntityAssignmentServicePort } from './PanelEntityAssignmentService.js';

export interface EpisodePlanPersistenceResources {
  pageRepository: PageRepository;
  panelRepository: PanelRepository;
  panelEntityAssignmentService: PanelEntityAssignmentServicePort;
}

export interface EpisodePlanPersistenceInput {
  episodeId: string;
  userId: string;
  organizationId: string | null;
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
