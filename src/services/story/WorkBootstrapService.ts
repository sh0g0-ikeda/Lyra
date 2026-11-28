import type { WorkCreationMetadata, CreateWorkBootstrapInput, WorkBootstrapResult } from '../../domain/types/workBootstrap.js';

export interface WorkBootstrapRepositoryPort {
  create(actorUserId: string, input: CreateWorkBootstrapInput): Promise<WorkBootstrapResult>;
  listMetadata(actorUserId: string, organizationId: string | null, workIds: string[]): Promise<WorkCreationMetadata[]>;
}

export interface WorkBootstrapServicePort {
  create(actorUserId: string, input: CreateWorkBootstrapInput): Promise<WorkBootstrapResult>;
  listMetadata(actorUserId: string, organizationId: string | null, workIds: string[]): Promise<WorkCreationMetadata[]>;
}

export class WorkBootstrapService implements WorkBootstrapServicePort {
  public constructor(private readonly repository: WorkBootstrapRepositoryPort) {}

  public async create(actorUserId: string, input: CreateWorkBootstrapInput): Promise<WorkBootstrapResult> {
    return this.repository.create(actorUserId, input);
  }

  public async listMetadata(actorUserId: string, organizationId: string | null, workIds: string[]): Promise<WorkCreationMetadata[]> {
    return this.repository.listMetadata(actorUserId, organizationId, workIds);
  }
}
