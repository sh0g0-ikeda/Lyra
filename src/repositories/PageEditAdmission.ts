import type { QueryResultRow } from 'pg';
import { ConflictError } from '../domain/errors/index.js';
import type { PageStatus } from '../domain/types/page.js';
import type { DatabaseClient } from '../lib/db.js';

interface LockedPageEditRow extends QueryResultRow {
  page_id: string;
  page_status: PageStatus;
}

/**
 * An explicit editor write may reopen a confirmed page, but the transition must
 * use the same transaction and authorized page lock as the write. Reads never
 * call this admission path, and generating remains a hard conflict.
 */
export async function prepareAuthorizedPageEditByPageId(
  client: DatabaseClient,
  pageId: string,
  userId: string,
  organizationId: string | null,
): Promise<LockedPageEditRow | null> {
  const result = await client.query<LockedPageEditRow>(
    `
    SELECT pages.id AS page_id,
           pages.status AS page_status
    FROM pages
    INNER JOIN episodes ON episodes.id = pages.episode_id
    INNER JOIN chapters ON chapters.id = episodes.chapter_id
    INNER JOIN works ON works.id = chapters.work_id
    WHERE pages.id = $1
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
    FOR UPDATE OF pages
    `,
    [pageId, userId, organizationId],
  );
  const page = result.rows[0];
  if (page === undefined) {
    return null;
  }

  await transitionLockedPageForExplicitEdit(client, page.page_id, page.page_status);
  return page;
}

export async function prepareAuthorizedPageEditByPanelId(
  client: DatabaseClient,
  panelId: string,
  userId: string,
  organizationId: string | null,
): Promise<LockedPageEditRow | null> {
  const result = await client.query<LockedPageEditRow>(
    `
    SELECT pages.id AS page_id,
           pages.status AS page_status
    FROM panels
    INNER JOIN pages ON pages.id = panels.page_id
    INNER JOIN episodes ON episodes.id = pages.episode_id
    INNER JOIN chapters ON chapters.id = episodes.chapter_id
    INNER JOIN works ON works.id = chapters.work_id
    WHERE panels.id = $1
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
    FOR UPDATE OF pages
    `,
    [panelId, userId, organizationId],
  );
  const page = result.rows[0];
  if (page === undefined) {
    return null;
  }

  await transitionLockedPageForExplicitEdit(client, page.page_id, page.page_status);
  return page;
}

export async function transitionLockedPageForExplicitEdit(
  client: DatabaseClient,
  pageId: string,
  status: PageStatus,
): Promise<void> {
  if (status === 'generating') {
    throw new ConflictError('Page cannot be edited while generation is in progress');
  }
  if (status !== 'confirmed') {
    return;
  }

  const transitioned = await client.query(
    `
    UPDATE pages
    SET status = 'editing',
        updated_at = GREATEST(
          date_trunc('milliseconds', clock_timestamp()),
          date_trunc('milliseconds', pages.updated_at) + INTERVAL '1 millisecond'
        )
    WHERE id = $1
      AND status = 'confirmed'
    RETURNING id
    `,
    [pageId],
  );
  if (transitioned.rows.length !== 1) {
    throw new ConflictError('Page state changed before the edit could be saved');
  }
}
