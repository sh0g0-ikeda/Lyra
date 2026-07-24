import { describe, expect, it, vi } from 'vitest';
import { ExportArtifactCleanupService } from '../../../../src/services/export/ExportArtifactCleanupService.js';

describe('ExportArtifactCleanupService', () => {
  it('deletes only expired opaque artifacts and records the cleanup checkpoint', async () => {
    const repository = {
      listExpiredArtifacts: vi.fn().mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111', artifactS3Key: 'exports/11111111-1111-4111-8111-111111111111.pdf' }]),
      markArtifactDeleted: vi.fn(),
    };
    const storage = { deleteArtifact: vi.fn() };
    const service = new ExportArtifactCleanupService(repository as never, storage as never);
    await expect(service.cleanupExpiredArtifacts()).resolves.toBe(1);
    expect(storage.deleteArtifact).toHaveBeenCalledWith('exports/11111111-1111-4111-8111-111111111111.pdf');
    expect(repository.markArtifactDeleted).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });
});
