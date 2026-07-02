import type { OrganizationUsageEvent } from '../../domain/types/organization.js';

const USAGE_CSV_HEADERS = [
  'created_at',
  'organization_id',
  'user_id',
  'work_id',
  'generation_job_id',
  'event_type',
  'credit_amount',
  'generation_type',
  'status',
] as const;

/**
 * Exports organization usage with only operational fields.
 * Prompt text, image URLs, S3 keys, Stripe IDs, and external request IDs are
 * intentionally excluded so support CSVs can be shared without leaking assets.
 */
export function buildOrganizationUsageCsv(events: OrganizationUsageEvent[]): string {
  const rows = events.map((event) => [
    event.createdAt.toISOString(),
    event.organizationId,
    event.userId ?? '',
    event.workId ?? '',
    event.generationJobId ?? '',
    event.eventType,
    String(event.creditAmount),
    readStringMetadata(event.metadata, 'generation_type'),
    readStringMetadata(event.metadata, 'status'),
  ]);

  return [USAGE_CSV_HEADERS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function readStringMetadata(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}

function csvCell(value: string): string {
  if (!/[",\r\n]/u.test(value)) {
    return value;
  }
  return `"${value.replace(/"/gu, '""')}"`;
}
