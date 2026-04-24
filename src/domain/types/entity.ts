export type EntityType = 'character' | 'nonhuman' | 'object';

export type EntityStatus = 'draft' | 'ready';

export interface Entity {
  id: string;
  workId: string;
  userId: string;
  entityType: EntityType;
  name: string;
  freeDescription: string | null;
  structuredFields: Record<string, unknown>;
  promptSupplement: string | null;
  speechProfile: Record<string, unknown>;
  status: EntityStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEntityInput {
  workId: string;
  userId: string;
  entityType: EntityType;
  name: string;
  freeDescription: string | null;
  promptSupplement: string | null;
  structuredFields: Record<string, unknown>;
  speechProfile: Record<string, unknown>;
}

export interface UpdateEntityInput {
  entityType?: EntityType;
  name?: string;
  freeDescription?: string | null;
  promptSupplement?: string | null;
  structuredFields?: Record<string, unknown>;
  speechProfile?: Record<string, unknown>;
}
