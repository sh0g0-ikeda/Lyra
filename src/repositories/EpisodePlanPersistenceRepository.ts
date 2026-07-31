import { NotFoundError } from '../domain/errors/index.js';
import type { QueryResultRow } from 'pg';
import type { EpisodePagePlanContext } from '../domain/types/page.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { PostgresPageRepository } from './PageRepository.js';
import { PostgresPanelEntityAssignmentRepository } from './PanelEntityAssignmentRepository.js';
import { PostgresPanelRepository } from './PanelRepository.js';
import type {
  EpisodePlanPersistenceInput,
  EpisodePlanPersistencePort,
  EpisodePlanPersistenceResources,
} from '../services/page/EpisodePlanPersistence.js';
import { PanelEntityAssignmentService } from '../services/page/PanelEntityAssignmentService.js';

interface LockedEpisodeRow extends QueryResultRow {
  episode_id: string;
}

/**
 * Owns the commit boundary for a compiled episode plan. Every input used by
 * the context fingerprint is locked before it is read again and persisted.
 */
export class PostgresEpisodePlanPersistenceRepository implements EpisodePlanPersistencePort {
  public constructor(private readonly client: DatabaseClient & TransactionRunner) {}

  public async withLockedEpisodePlan<T>(
    input: EpisodePlanPersistenceInput,
    work: (
      context: EpisodePagePlanContext,
      resources: EpisodePlanPersistenceResources,
    ) => Promise<T>,
  ): Promise<T> {
    return this.client.transaction(async (transactionClient) => {
      await this.lockEpisodeGraph(transactionClient, input);

      const transactionRunner = buildTransactionScopedRunner(transactionClient);
      const pageRepository = new PostgresPageRepository(transactionClient);
      const panelRepository = new PostgresPanelRepository(transactionRunner);
      const panelEntityAssignmentService = new PanelEntityAssignmentService(
        new PostgresPanelEntityAssignmentRepository(transactionRunner),
      );
      const context = await pageRepository.findEpisodePlanningContextByIdAndUserId(
        input.episodeId,
        input.userId,
        input.organizationId,
      );
      if (context === null) {
        throw new NotFoundError('Episode not found');
      }

      return work(context, {
        pageRepository,
        panelRepository,
        panelEntityAssignmentService,
      });
    });
  }

  private async lockEpisodeGraph(
    client: DatabaseClient,
    input: EpisodePlanPersistenceInput,
  ): Promise<void> {
    const episode = await client.query<LockedEpisodeRow>(
      `
      SELECT episodes.id AS episode_id
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE episodes.id = $1
        AND (
          ($3::uuid IS NULL AND works.user_id = $2 AND works.organization_id IS NULL)
          OR (
            $3::uuid IS NOT NULL
            AND works.organization_id = $3::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
        )
      FOR UPDATE OF works, chapters, episodes
      `,
      [input.episodeId, input.userId, input.organizationId],
    );
    if (episode.rows[0] === undefined) {
      throw new NotFoundError('Episode not found');
    }

    await client.query(
      `SELECT scenes.id
       FROM scenes
       WHERE scenes.episode_id = $1
       ORDER BY scenes."order" ASC, scenes.id ASC
       FOR UPDATE`,
      [input.episodeId],
    );
    await client.query(
      `SELECT pages.id
       FROM pages
       WHERE pages.episode_id = $1
       ORDER BY pages.page_number ASC, pages.id ASC
       FOR UPDATE`,
      [input.episodeId],
    );
    await client.query(
      `SELECT panels.id
       FROM panels
       INNER JOIN pages ON pages.id = panels.page_id
       WHERE pages.episode_id = $1
       ORDER BY pages.page_number ASC, panels."order" ASC, panels.id ASC
       FOR UPDATE OF panels`,
      [input.episodeId],
    );
    await client.query(
      `SELECT panel_frames.id
       FROM panel_frames
       INNER JOIN pages ON pages.id = panel_frames.page_id
       WHERE pages.episode_id = $1
       ORDER BY pages.page_number ASC, panel_frames.reading_order ASC, panel_frames.id ASC
       FOR UPDATE OF panel_frames`,
      [input.episodeId],
    );
    await client.query(
      `SELECT entities.id
       FROM entities
       INNER JOIN chapters ON chapters.work_id = entities.work_id
       INNER JOIN episodes ON episodes.chapter_id = chapters.id
       WHERE episodes.id = $1
       ORDER BY entities.id ASC
       FOR UPDATE OF entities`,
      [input.episodeId],
    );
    await client.query(
      `SELECT entity_states.id
       FROM entity_states
       INNER JOIN entities ON entities.id = entity_states.entity_id
       INNER JOIN chapters ON chapters.work_id = entities.work_id
       INNER JOIN episodes ON episodes.chapter_id = chapters.id
       WHERE episodes.id = $1
       ORDER BY entity_states.id ASC
       FOR UPDATE OF entity_states`,
      [input.episodeId],
    );
  }
}

function buildTransactionScopedRunner(
  transactionClient: DatabaseClient,
): DatabaseClient & TransactionRunner {
  return {
    query: transactionClient.query.bind(transactionClient),
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> =>
      work(transactionClient),
  };
}
