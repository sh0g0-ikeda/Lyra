import type { QueryResultRow } from 'pg';
import type { CharacterAutofillResult } from '../../packages/api-contract/src/characterAutofill.js';
import { extractEntityAliases } from '../domain/entityAliases.js';
import { ConfigurationError, NotFoundError, ResourceStaleError, ValidationError } from '../domain/errors/index.js';
import type { EntityType } from '../domain/types/entity.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { parseStructuredFields } from '../lib/validators/entity.schema.js';
import {
  mergeCharacterAutofillCandidates,
  type CharacterAutofillCandidate,
} from '../services/story/CharacterAutofillFields.js';
import {
  isCharacterAppearanceChoice,
  readCharacterAppearanceChoice,
} from '../services/entity/CharacterAppearanceReview.js';
import {
  CANONICAL_REPOSITORY_SCHEMA_PROFILE,
  hasPreVariantEntitySchema,
  type RepositorySchemaProfile,
} from './RepositorySchemaProfile.js';

export interface SaveCharacterAutofillCandidatesInput {
  userId: string;
  episodeId: string;
  version: number;
  organizationId: string | null;
  candidates: readonly CharacterAutofillCandidate[];
  review?: {
    unresolved: NonNullable<CharacterAutofillResult['appearance_review']>['unresolved'];
  };
}

export interface CharacterAutofillRepository {
  saveCandidates(input: SaveCharacterAutofillCandidatesInput): Promise<CharacterAutofillResult>;
}

interface AuthorizedEpisodeRow extends QueryResultRow {
  work_id: string;
  version: number;
}

interface RosterRow extends QueryResultRow {
  id: string;
  name: string;
  entity_type: EntityType;
  structured_fields: unknown;
  updated_at: Date;
}

interface StateRow extends QueryResultRow {
  entity_id: string;
  name: string | null;
  description: string | null;
  extra_note: string | null;
}

interface InsertedEntityRow extends QueryResultRow {
  id: string;
  updated_at: Date;
}

interface RosterEntry {
  id: string;
  name: string;
  entityType: EntityType;
  aliases: string[];
  structuredFields: Record<string, unknown>;
  updatedAt: string;
}

const MAX_REVIEW_ITEMS = 1_920;

/**
 * Persists one extraction result atomically. The work and its current roster are
 * locked before matching so a concurrent replay deterministically observes the
 * first writer's entities and quote-backed states instead of creating copies.
 */
export class PostgresCharacterAutofillRepository implements CharacterAutofillRepository {
  public constructor(
    private readonly transactionRunner: TransactionRunner,
    private readonly schemaProfile: RepositorySchemaProfile = CANONICAL_REPOSITORY_SCHEMA_PROFILE,
  ) {}

  public async saveCandidates(input: SaveCharacterAutofillCandidatesInput): Promise<CharacterAutofillResult> {
    if (hasPreVariantEntitySchema(this.schemaProfile)) {
      throw new ConfigurationError('Character autofill requires entity state variants');
    }
    const candidates = normalizeCandidates(input.candidates);
    if (input.review !== undefined) assertReview(input.review.unresolved);
    return this.transactionRunner.transaction(async (transactionClient) => {
      await this.lockOrganizationEditor(transactionClient, input);
      const episode = await this.lockAuthorizedEpisode(transactionClient, input);
      if (episode.version !== input.version) throw new ResourceStaleError();

      const roster = await this.lockRoster(transactionClient, episode.work_id);
      const statesByEntity = await this.lockStates(transactionClient, roster.map((entry) => entry.id));
      const characters: CharacterAutofillResult['characters'] = [];
      const skippedNames: string[] = [];
      const resultByEntityId = new Map<string, CharacterAutofillResult['characters'][number]>();
      const appearanceSuggestions: NonNullable<CharacterAutofillResult['appearance_review']>['suggestions'] = [];
      const appearanceSuggestionKeys = new Set<string>();

      for (const candidate of candidates) {
        const matches = findRosterMatches(roster, candidate.name);
        if (matches.length > 1 || (matches.length === 1 && matches[0]?.entityType === 'object')) {
          skippedNames.push(candidate.name);
          continue;
        }

        let entry = matches[0];
        let created = false;
        if (entry === undefined) {
          if (candidate.entityType === null) {
            skippedNames.push(candidate.name);
            continue;
          }
          entry = await this.insertEntity(transactionClient, episode.work_id, input.userId, {
            ...candidate,
            entityType: candidate.entityType,
          });
          roster.push(entry);
          statesByEntity.set(entry.id, []);
          created = true;
        }

        if (input.review !== undefined && !created && entry.entityType === 'character') {
          for (const evidence of candidate.choiceEvidence ?? []) {
            if (appearanceSuggestions.length >= MAX_REVIEW_ITEMS) break;
            if (!isCharacterAppearanceChoice(evidence.field, evidence.value)
              || readCharacterAppearanceChoice(entry.structuredFields, evidence.field) !== undefined) continue;
            const key = `${entry.id}\u0000${evidence.field}\u0000${evidence.value}\u0000${normalizeText(evidence.quote)}`;
            if (appearanceSuggestionKeys.has(key)) continue;
            appearanceSuggestionKeys.add(key);
            appearanceSuggestions.push({
              entity_id: entry.id,
              name: entry.name,
              field: evidence.field,
              value: evidence.value,
              quote: evidence.quote.trim(),
              expected_updated_at: entry.updatedAt,
            });
          }
        }

        const states = statesByEntity.get(entry.id) ?? [];
        let statesAdded = 0;
        for (const change of candidate.changes) {
          if (hasMatchingState(states, change)) continue;
          await transactionClient.query(
            `INSERT INTO entity_states
               (entity_id, scene_id, name, description, expression_default, extra_note)
             VALUES ($1, NULL, $2, $3, 'neutral', $4)`,
            [entry.id, change.name.trim(), change.description.trim(), change.quote.trim()],
          );
          states.push({
            entity_id: entry.id,
            name: change.name.trim(),
            description: change.description.trim(),
            extra_note: change.quote.trim(),
          });
          statesAdded += 1;
        }
        statesByEntity.set(entry.id, states);

        const priorResult = resultByEntityId.get(entry.id);
        if (priorResult !== undefined) {
          priorResult.states_added += statesAdded;
          continue;
        }
        const result = {
          entity_id: entry.id,
          name: candidate.name,
          created,
          states_added: statesAdded,
        };
        resultByEntityId.set(entry.id, result);
        characters.push(result);
      }

      return {
        version: input.version,
        characters,
        skipped_names: Array.from(new Set(skippedNames)),
        ...(input.review === undefined ? {} : {
          appearance_review: {
            unresolved: input.review.unresolved,
            suggestions: appearanceSuggestions,
          },
        }),
      };
    });
  }

  private async lockOrganizationEditor(
    client: DatabaseClient,
    input: SaveCharacterAutofillCandidatesInput,
  ): Promise<void> {
    if (input.organizationId === null) return;
    const result = await client.query(
      `SELECT organization_members.id
       FROM organizations
       INNER JOIN organization_members
         ON organization_members.organization_id = organizations.id
       WHERE organizations.id = $1::uuid
         AND organizations.status IN ('active', 'trialing')
         AND organization_members.user_id = $2::uuid
         AND organization_members.status = 'active'
         AND organization_members.role IN ('owner', 'admin', 'editor')
       FOR SHARE OF organizations, organization_members`,
      [input.organizationId, input.userId],
    );
    if (result.rows[0] === undefined) throw new NotFoundError('Episode not found');
  }

  private async lockAuthorizedEpisode(
    client: DatabaseClient,
    input: SaveCharacterAutofillCandidatesInput,
  ): Promise<AuthorizedEpisodeRow> {
    const result = await client.query<AuthorizedEpisodeRow>(
      `SELECT chapters.work_id, episodes.version
       FROM episodes
       INNER JOIN chapters ON chapters.id = episodes.chapter_id
       INNER JOIN works ON works.id = chapters.work_id
       LEFT JOIN organizations ON organizations.id = works.organization_id
       WHERE episodes.id = $1::uuid
         AND (
           ($3::uuid IS NULL
             AND works.organization_id IS NULL
             AND works.user_id = $2::uuid)
           OR (
             $3::uuid IS NOT NULL
             AND works.organization_id = $3::uuid
             AND organizations.status IN ('active', 'trialing')
             AND EXISTS (
               SELECT 1
               FROM organization_members
               WHERE organization_members.organization_id = works.organization_id
                 AND organization_members.user_id = $2::uuid
                 AND organization_members.status = 'active'
                 AND organization_members.role IN ('owner', 'admin', 'editor')
             )
           )
         )
       FOR UPDATE OF works, episodes`,
      [input.episodeId, input.userId, input.organizationId],
    );
    const episode = result.rows[0];
    if (episode === undefined) throw new NotFoundError('Episode not found');
    return episode;
  }

  private async lockRoster(client: DatabaseClient, workId: string): Promise<RosterEntry[]> {
    const result = await client.query<RosterRow>(
      `SELECT id, name, entity_type, structured_fields, updated_at
       FROM entities
       WHERE work_id = $1::uuid
       ORDER BY id ASC
       FOR UPDATE`,
      [workId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      entityType: row.entity_type,
      aliases: extractEntityAliases(readRecord(row.structured_fields)),
      structuredFields: readRecord(row.structured_fields),
      updatedAt: serializeTimestamp(row.updated_at),
    }));
  }

  private async lockStates(
    client: DatabaseClient,
    entityIds: readonly string[],
  ): Promise<Map<string, StateRow[]>> {
    const statesByEntity = new Map<string, StateRow[]>();
    if (entityIds.length === 0) return statesByEntity;
    const result = await client.query<StateRow>(
      `SELECT entity_id, name, description, extra_note
       FROM entity_states
       WHERE entity_id = ANY($1::uuid[])
       ORDER BY entity_id ASC, id ASC
       FOR UPDATE`,
      [entityIds],
    );
    for (const row of result.rows) {
      const states = statesByEntity.get(row.entity_id) ?? [];
      states.push(row);
      statesByEntity.set(row.entity_id, states);
    }
    return statesByEntity;
  }

  private async insertEntity(
    client: DatabaseClient,
    workId: string,
    userId: string,
    candidate: CharacterAutofillCandidate & { entityType: Exclude<CharacterAutofillCandidate['entityType'], null> },
  ): Promise<RosterEntry> {
    const structuredFields = parseStructuredFields(candidate.entityType, candidate.structuredFields);
    const result = await client.query<InsertedEntityRow>(
      `WITH inserted_entity AS (
         INSERT INTO entities
           (work_id, user_id, entity_type, name, free_description, prompt_supplement,
            structured_fields, speech_profile, status)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, NULL, $6::jsonb, '{}'::jsonb, 'draft')
         RETURNING id, updated_at
       ), inserted_reference_set AS (
         INSERT INTO reference_sets (entity_id, status)
         SELECT id, 'empty' FROM inserted_entity
       )
       SELECT id, updated_at FROM inserted_entity`,
      [
        workId,
        userId,
        candidate.entityType,
        candidate.name.trim(),
        candidate.freeDescription,
        JSON.stringify(structuredFields),
      ],
    );
    const id = result.rows[0]?.id;
    const updatedAt = result.rows[0]?.updated_at;
    if (id === undefined || updatedAt === undefined) throw new ConfigurationError('Character autofill failed to create an entity');
    return {
      id,
      name: candidate.name.trim(),
      entityType: candidate.entityType,
      aliases: extractEntityAliases(structuredFields),
      structuredFields,
      updatedAt: serializeTimestamp(updatedAt),
    };
  }
}

function normalizeCandidates(candidates: readonly CharacterAutofillCandidate[]): CharacterAutofillCandidate[] {
  if (candidates.length > 30) throw new ValidationError('Character autofill has too many characters');
  for (const candidate of candidates) assertCandidate(candidate);
  const merged = mergeCharacterAutofillCandidates(candidates);
  for (const candidate of merged) {
    if (candidate.changes.length > 30) throw new ValidationError('Character autofill has too many states');
  }
  return merged;
}

function assertCandidate(candidate: CharacterAutofillCandidate): void {
  const name = candidate.name.trim();
  if (name.length < 1 || name.length > 100) throw new ValidationError('Character autofill name is invalid');
  if (candidate.freeDescription !== null && candidate.freeDescription.length > 2000) {
    throw new ValidationError('Character autofill description is too long');
  }
  if (candidate.changes.length > 30) throw new ValidationError('Character autofill has too many states');
  if ((candidate.choiceEvidence?.length ?? 0) > 64) {
    throw new ValidationError('Character autofill has too much appearance evidence');
  }
  for (const evidence of candidate.choiceEvidence ?? []) {
    if (evidence.field.trim().length < 1 || evidence.field.length > 100
      || evidence.value.trim().length < 1 || evidence.value.length > 150
      || evidence.quote.trim().length < 1 || evidence.quote.length > 500) {
      throw new ValidationError('Character autofill appearance evidence is invalid');
    }
  }
  for (const change of candidate.changes) {
    if (change.name.trim().length < 1 || change.name.trim().length > 100
      || change.description.trim().length < 1 || change.description.trim().length > 2000
      || change.quote.trim().length < 1 || change.quote.trim().length > 2000) {
      throw new ValidationError('Character autofill state is invalid');
    }
  }
}

function assertReview(
  unresolved: NonNullable<CharacterAutofillResult['appearance_review']>['unresolved'],
): void {
  if (unresolved.length > MAX_REVIEW_ITEMS) throw new ValidationError('Character autofill has too many review issues');
  for (const issue of unresolved) {
    if (issue.quote.trim().length < 1 || issue.quote.length > 500
      || !['ambiguous_character', 'conflicting_traits', 'unverified_trait'].includes(issue.reason)) {
      throw new ValidationError('Character autofill review issue is invalid');
    }
  }
}

function serializeTimestamp(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new ConfigurationError('Character autofill entity timestamp is invalid');
  return timestamp.toISOString();
}

function findRosterMatches(roster: readonly RosterEntry[], name: string): RosterEntry[] {
  const key = normalizeText(name);
  return roster.filter((entry) => [entry.name, ...entry.aliases].some((value) => normalizeText(value) === key));
}

function hasMatchingState(states: readonly StateRow[], change: CharacterAutofillCandidate['changes'][number]): boolean {
  const contentKey = `${normalizeText(change.name)}\u0000${normalizeText(change.description)}`;
  return states.some((state) =>
    (state.name !== null && state.description !== null
      && `${normalizeText(state.name)}\u0000${normalizeText(state.description)}` === contentKey)
    || (state.extra_note !== null && state.description !== null
      && describesSameSourceChange(
        state.extra_note,
        state.description,
        change.quote,
        change.description,
      )));
}

function describesSameSourceChange(
  savedQuote: string,
  savedDescription: string,
  candidateQuote: string,
  candidateDescription: string,
): boolean {
  const leftQuote = normalizeSourceSpan(savedQuote);
  const rightQuote = normalizeSourceSpan(candidateQuote);
  const leftDescription = normalizeSourceSpan(savedDescription);
  const rightDescription = normalizeSourceSpan(candidateDescription);
  return substantivelyContainsEither(leftQuote, rightQuote)
    && substantivelyContainsEither(leftDescription, rightDescription);
}

function substantivelyContainsEither(left: string, right: string): boolean {
  if (left === right) return left.length > 0;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  // Short fragments such as a color or body part are not enough to identify a
  // state when one sentence contains several independent changes.
  return [...shorter].length >= 4 && longer.includes(shorter);
}

function normalizeSourceSpan(value: string): string {
  return normalizeText(value).replace(/[\p{P}\p{S}\s]+/gu, '');
}

function normalizeText(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase();
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
