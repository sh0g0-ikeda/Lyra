import { ConflictError, ForbiddenError, NotFoundError } from '../domain/errors/index.js';
import type { QueryResultRow } from 'pg';
import type { EpisodePagePlanContext } from '../domain/types/page.js';
import {
  roleHasCapability,
  type OrganizationMemberRole,
} from '../domain/types/organization.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { PostgresPageRepository } from './PageRepository.js';
import { PostgresPanelEntityAssignmentRepository } from './PanelEntityAssignmentRepository.js';
import { PostgresPanelRepository } from './PanelRepository.js';
import { PostgresEpisodeStoryAutofillExecutionRepository } from './EpisodeStoryAutofillExecutionRepository.js';
import {
  CANONICAL_REPOSITORY_SCHEMA_PROFILE,
  type RepositorySchemaProfile,
} from './RepositorySchemaProfile.js';
import type {
  EpisodePlanPersistenceInput,
  EpisodePlanPersistencePort,
  EpisodePlanPersistenceResources,
} from '../services/page/EpisodePlanPersistence.js';
import { PanelEntityAssignmentService } from '../services/page/PanelEntityAssignmentService.js';
import { assertLegacyPersonalWriteAllowed } from './LegacyAccountDeletionWriteFence.js';
import {
  sameStoryAutofillAttempt,
  type GenerationJobRow as StoryAutofillGenerationJobRow,
} from './EpisodeStoryAutofillExecutionRepository.js';
import { lockMobilePushTokenRegistryForTerminalSettlement } from './PushNotificationOutboxRepository.js';

interface LockedEpisodeRow extends QueryResultRow {
  episode_id: string;
}

/**
 * Owns the commit boundary for a compiled episode plan. Every input used by
 * the context fingerprint is locked before it is read again and persisted.
 * Transaction-scoped repositories retain the caller's schema profile so legacy
 * physical schemas never receive canonical planning or notification queries.
 */
export class PostgresEpisodePlanPersistenceRepository implements EpisodePlanPersistencePort {
  public constructor(
    private readonly client: DatabaseClient & TransactionRunner,
    private readonly schemaProfile: RepositorySchemaProfile = CANONICAL_REPOSITORY_SCHEMA_PROFILE,
  ) {}

  public async withLockedEpisodePlan<T>(
    input: EpisodePlanPersistenceInput,
    work: (
      context: EpisodePagePlanContext,
      resources: EpisodePlanPersistenceResources,
    ) => Promise<T>,
  ): Promise<T> {
    return this.client.transaction(async (transactionClient) => {
      const storyAutofillAttempt = input.storyAutofillAttempt;
      let storyAutofillCommitStarted = false;
      if (this.schemaProfile === 'legacy_2debe_v1' && storyAutofillAttempt !== undefined) {
        await this.beginLegacyStoryAutofillCommit(transactionClient, input);
        storyAutofillCommitStarted = true;
      } else if (this.schemaProfile === 'legacy_2debe_v1' && input.organizationId === null) {
        await assertLegacyPersonalWriteAllowed(transactionClient, {
          userId: input.userId,
          organizationId: input.organizationId,
        });
      }
      await this.lockEpisodeGraph(
        transactionClient,
        input,
        this.schemaProfile === 'legacy_2debe_v1' && storyAutofillAttempt !== undefined,
      );

      const transactionRunner = buildTransactionScopedRunner(transactionClient);
      const pageRepository = new PostgresPageRepository(
        transactionClient,
        this.schemaProfile,
        transactionRunner,
      );
      const panelRepository = new PostgresPanelRepository(transactionRunner, this.schemaProfile);
      const panelEntityAssignmentService = new PanelEntityAssignmentService(
        new PostgresPanelEntityAssignmentRepository(transactionRunner, this.schemaProfile),
      );
      const storyAutofillExecutionRepository =
        new PostgresEpisodeStoryAutofillExecutionRepository(transactionRunner, this.schemaProfile);
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
        completeStoryAutofillJob: async (jobId, userId, result) =>
          storyAutofillExecutionRepository.completeEpisodeStoryAutofill({
            jobId,
            userId,
            result,
          }),
        storyAutofillCommitStarted,
        ...(storyAutofillCommitStarted && storyAutofillAttempt !== undefined
          ? {
              updateStoryAutofillProgress: async (progress) =>
                storyAutofillExecutionRepository.updateEpisodeStoryAutofillProgressForAttempt(
                  storyAutofillAttempt,
                  progress,
                ),
            }
          : {}),
      });
    });
  }

  private async beginLegacyStoryAutofillCommit(
    client: DatabaseClient,
    input: EpisodePlanPersistenceInput,
  ): Promise<void> {
    const attempt = input.storyAutofillAttempt;
    if (attempt === undefined) throw new ConflictError('Story autofill attempt is missing');
    const candidate = (await client.query<StoryAutofillGenerationJobRow>(
      'SELECT * FROM generation_jobs WHERE id = $1::uuid',
      [attempt.id],
    )).rows[0];
    if (!sameStoryAutofillAttempt(candidate, attempt)) {
      throw new ConflictError('Story autofill attempt no longer matches');
    }
    if (candidate.user_id !== input.userId) throw new ConflictError('Story autofill actor no longer matches');
    if (candidate.organization_id !== input.organizationId) throw new ConflictError('Story autofill organization no longer matches');
    if (readEpisodeId(candidate.params) !== input.episodeId) {
      throw new ConflictError('Story autofill episode no longer matches');
    }
    await assertLegacyPersonalWriteAllowed(client, {
      userId: candidate.user_id,
      organizationId: candidate.organization_id,
    });
    if (candidate.organization_id !== null) {
      // Account anonymization locks the actor before deleting memberships, and
      // organization editors lock the organization before changing membership.
      // Hold compatible admission locks in that same order before the job gate.
      const actor = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE id = $1::uuid FOR KEY SHARE',
        [candidate.user_id],
      );
      if (actor.rows[0]?.id !== candidate.user_id) {
        throw new ForbiddenError('Organization membership is no longer active');
      }
      const organization = await client.query<{ id: string }>(
        'SELECT id FROM organizations WHERE id = $1::uuid FOR KEY SHARE',
        [candidate.organization_id],
      );
      if (organization.rows[0]?.id !== candidate.organization_id) {
        throw new ForbiddenError('Organization membership is no longer active');
      }
    }
    await lockMobilePushTokenRegistryForTerminalSettlement(client);
    const locked = (await client.query<StoryAutofillGenerationJobRow>(
      'SELECT * FROM generation_jobs WHERE id = $1::uuid FOR UPDATE',
      [attempt.id],
    )).rows[0];
    if (
      !this.matchesStoryAutofillInput(locked, attempt, input)
      || locked.status !== 'processing'
      || locked.cancel_requested_at !== null
      || locked.cancelled_at !== null
      || locked.commit_started_at !== null
    ) {
      throw new ConflictError('Story autofill attempt is no longer committable');
    }
    const bound = new PostgresEpisodeStoryAutofillExecutionRepository(
      buildTransactionScopedRunner(client),
      this.schemaProfile,
    );
    if (!await bound.beginEpisodeStoryAutofillCommit(attempt.id, attempt.userId)) {
      throw new ConflictError('Story autofill commit gate could not be acquired');
    }
    if (candidate.organization_id !== null) {
      const membership = (await client.query<{
        organization_id: string;
        user_id: string;
        status: string;
        role: unknown;
      }>(
        `SELECT organization_id, user_id, status, role
         FROM organization_members
         WHERE organization_id = $1::uuid AND user_id = $2::uuid
         FOR SHARE`,
        [candidate.organization_id, candidate.user_id],
      )).rows[0];
      if (
        membership?.organization_id !== candidate.organization_id
        || membership.user_id !== candidate.user_id
        || membership.status !== 'active'
        || !isOrganizationMemberRole(membership.role)
        || !roleHasCapability(membership.role, 'edit_work')
      ) {
        throw new ForbiddenError('Organization membership is no longer active');
      }
    }
  }

  private matchesStoryAutofillInput(
    row: StoryAutofillGenerationJobRow | undefined,
    attempt: NonNullable<EpisodePlanPersistenceInput['storyAutofillAttempt']>,
    input: EpisodePlanPersistenceInput,
  ): row is StoryAutofillGenerationJobRow {
    return sameStoryAutofillAttempt(row, attempt)
      && row.user_id === input.userId
      && row.organization_id === input.organizationId
      && readEpisodeId(row.params) === input.episodeId;
  }

  private async lockEpisodeGraph(
    client: DatabaseClient,
    input: EpisodePlanPersistenceInput,
    failOnContention: boolean,
  ): Promise<void> {
    try {
      await this.lockEpisodeGraphRows(client, input, failOnContention);
    } catch (error: unknown) {
      // Existing editors use established child-first lock paths. The new
      // autofill commit yields immediately so the editor can finish, and the
      // surrounding transaction rolls back marker, progress, content and outbox.
      if (failOnContention && isPostgresErrorCode(error, '55P03')) {
        throw new ConflictError('Story autofill source is being edited; retry after editing finishes');
      }
      throw error;
    }
  }

  private async lockEpisodeGraphRows(
    client: DatabaseClient,
    input: EpisodePlanPersistenceInput,
    failOnContention: boolean,
  ): Promise<void> {
    const nowait = failOnContention ? ' NOWAIT' : '';
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
      FOR UPDATE OF works, chapters, episodes${nowait}
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
       FOR UPDATE${nowait}`,
      [input.episodeId],
    );
    await client.query(
      `SELECT pages.id
       FROM pages
       WHERE pages.episode_id = $1
       ORDER BY pages.page_number ASC, pages.id ASC
       FOR UPDATE${nowait}`,
      [input.episodeId],
    );
    await client.query(
      `SELECT panels.id
       FROM panels
       INNER JOIN pages ON pages.id = panels.page_id
       WHERE pages.episode_id = $1
       ORDER BY pages.page_number ASC, panels."order" ASC, panels.id ASC
       FOR UPDATE OF panels${nowait}`,
      [input.episodeId],
    );
    await client.query(
      `SELECT panel_frames.id
       FROM panel_frames
       INNER JOIN pages ON pages.id = panel_frames.page_id
       WHERE pages.episode_id = $1
       ORDER BY pages.page_number ASC, panel_frames.reading_order ASC, panel_frames.id ASC
       FOR UPDATE OF panel_frames${nowait}`,
      [input.episodeId],
    );
    await client.query(
      `SELECT entities.id
       FROM entities
       INNER JOIN chapters ON chapters.work_id = entities.work_id
       INNER JOIN episodes ON episodes.chapter_id = chapters.id
       WHERE episodes.id = $1
       ORDER BY entities.id ASC
       FOR UPDATE OF entities${nowait}`,
      [input.episodeId],
    );
    await client.query(
      `SELECT reference_sets.entity_id
       FROM reference_sets
       INNER JOIN entities ON entities.id = reference_sets.entity_id
       INNER JOIN chapters ON chapters.work_id = entities.work_id
       INNER JOIN episodes ON episodes.chapter_id = chapters.id
       WHERE episodes.id = $1
       ORDER BY reference_sets.entity_id ASC
       FOR UPDATE OF reference_sets${nowait}`,
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
       FOR UPDATE OF entity_states${nowait}`,
      [input.episodeId],
    );
  }
}

function isPostgresErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function isOrganizationMemberRole(value: unknown): value is OrganizationMemberRole {
  return value === 'owner'
    || value === 'admin'
    || value === 'billing'
    || value === 'editor'
    || value === 'viewer';
}

function readEpisodeId(params: unknown): string | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return null;
  const value = (params as Record<string, unknown>).episode_id;
  return typeof value === 'string' ? value : null;
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
