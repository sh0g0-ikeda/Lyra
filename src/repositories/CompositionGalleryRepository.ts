import type { QueryResultRow } from 'pg';
import type {
  CompositionGalleryItem,
  CompositionGalleryQuery,
} from '../domain/types/composition.js';
import type { DatabaseClient } from '../lib/db.js';

export type { CompositionGalleryItem, CompositionGalleryQuery };

export interface CompositionGalleryRepository {
  findMany(query: CompositionGalleryQuery): Promise<CompositionGalleryItem[]>;
  findByIds(ids: string[]): Promise<CompositionGalleryItem[]>;
}

interface CompositionGalleryRow extends QueryResultRow {
  id: string;
  name: string;
  category: string;
  entity_count: number;
  preview_s3_key: string;
  preview_cdn_url: string;
  composition_prompt: string;
  shot_type: string;
  angle: string;
  tags: string[];
  created_at: Date;
}

export class PostgresCompositionGalleryRepository implements CompositionGalleryRepository {
  public constructor(private readonly client: DatabaseClient) {}

  public async findMany(query: CompositionGalleryQuery): Promise<CompositionGalleryItem[]> {
    const result = await this.client.query<CompositionGalleryRow>(
      `
      SELECT id,
             name,
             category,
             entity_count,
             preview_s3_key,
             preview_cdn_url,
             composition_prompt,
             shot_type,
             angle,
             tags,
             created_at
      FROM composition_gallery
      WHERE category = COALESCE($1, category)
        AND entity_count = COALESCE($2, entity_count)
        AND ($3::text IS NULL OR $3 = ANY(tags))
      ORDER BY category ASC,
               entity_count ASC,
               id ASC
      LIMIT $4
      `,
      [query.category, query.entityCount, query.tag, query.limit],
    );

    return result.rows.map(mapCompositionGalleryRow);
  }

  public async findByIds(ids: string[]): Promise<CompositionGalleryItem[]> {
    if (ids.length === 0) {
      return [];
    }

    const result = await this.client.query<CompositionGalleryRow>(
      `
      SELECT id,
             name,
             category,
             entity_count,
             preview_s3_key,
             preview_cdn_url,
             composition_prompt,
             shot_type,
             angle,
             tags,
             created_at
      FROM composition_gallery
      WHERE id = ANY($1::text[])
      ORDER BY id ASC
      `,
      [ids],
    );

    return result.rows.map(mapCompositionGalleryRow);
  }
}

function mapCompositionGalleryRow(row: CompositionGalleryRow): CompositionGalleryItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    entityCount: row.entity_count,
    previewS3Key: row.preview_s3_key,
    previewCdnUrl: row.preview_cdn_url,
    compositionPrompt: row.composition_prompt,
    shotType: row.shot_type,
    angle: row.angle,
    tags: toStringArray(row.tags),
    createdAt: row.created_at,
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}
