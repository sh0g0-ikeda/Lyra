export type SceneStatus = 'draft' | 'reviewing' | 'ready';

export interface SceneEntityStateReference {
  entityId: string;
  stateId: string;
}

export interface Scene {
  id: string;
  episodeId: string;
  order: number;
  location: string | null;
  time: string | null;
  atmosphere: string | null;
  involvedEntityIds: string[];
  entityStates: SceneEntityStateReference[];
  status: SceneStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntityState {
  id: string;
  entityId: string;
  sceneId: string | null;
  costumeNote: string | null;
  costumeRefId: string | null;
  conditionNote: string | null;
  hairNote: string | null;
  expressionDefault: string;
  extraNote: string | null;
  createdAt: Date;
}

export interface CreateSceneInput {
  order: number;
  location: string | null;
  time: string | null;
  atmosphere: string | null;
  involvedEntityIds: string[];
}

export interface UpdateSceneInput {
  order?: number;
  location?: string | null;
  time?: string | null;
  atmosphere?: string | null;
  involvedEntityIds?: string[];
  status?: SceneStatus;
}

export interface CreateEntityStateInput {
  sceneId: string | null;
  costumeNote: string | null;
  costumeRefId: string | null;
  conditionNote: string | null;
  hairNote: string | null;
  expressionDefault: string;
  extraNote: string | null;
}

export interface UpdateEntityStateInput {
  sceneId?: string | null;
  costumeNote?: string | null;
  costumeRefId?: string | null;
  conditionNote?: string | null;
  hairNote?: string | null;
  expressionDefault?: string;
  extraNote?: string | null;
}
