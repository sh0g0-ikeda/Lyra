import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../../../src/domain/errors/index.js';
import { buildFencedStateReferenceKey, STATE_REFERENCE_COPY_V2_PROTOCOL } from '../../../../src/domain/state/FencedStateReferenceKey.js';
import type { ConfirmEntityStateReferenceInput } from '../../../../src/domain/types/entityStateReference.js';
import type { FencedImageReceipt, FencedStateReferenceImageCreatePort, FencedStateReferenceRecoveryPort } from '../../../../src/infrastructure/aws/FencedStateReferenceStorage.js';
import type { FencedStateReferenceAttempt, FencedStateReferenceRepository } from '../../../../src/repositories/FencedStateReferenceRepository.js';
import { FencedStateReferenceConfirmationService } from '../../../../src/services/entity/FencedStateReferenceConfirmationService.js';

function fixture(enabled = true) {
  const userId = '11111111-1111-4111-8111-111111111111';
  const entityId = '22222222-2222-4222-8222-222222222222';
  const attemptToken = '33333333-3333-4333-8333-333333333333';
  const s3Key = buildFencedStateReferenceKey({ ownerUserId: userId, entityId, attemptToken, mimeType: 'image/png' });
  const input: ConfirmEntityStateReferenceInput = {
    userId, organizationId: null, entityId, stateId: '44444444-4444-4444-8444-444444444444',
    jobId: '55555555-5555-4555-8555-555555555555', candidateS3Key: `session/${userId}/entities/${entityId}/candidate.png`,
    expectedStateRevision: '2026-10-01T00:00:00.000Z',
    descriptor: { refId: 'candidate', s3Key, storageOwnerUserId: userId, imageModel: 'gpt-image-2', baseRefId: 'base',
      createdAt: '2026-10-01T00:00:00.000Z', inputFingerprint: 'a'.repeat(64) },
  };
  const prepared = { imageData: Buffer.from('fixture'), mimeType: 'image/png' as const, sizeBytes: 7,
    digest: 'b'.repeat(64), sourceRevision: { eTag: '"source"' } };
  const attempt: FencedStateReferenceAttempt = {
    input, intent: { ...prepared, protocol: STATE_REFERENCE_COPY_V2_PROTOCOL, attemptToken, s3Key,
      ownerUserId: userId, entityId }, state: 'unresolved', dispatchStartedAt: null, imageReceipt: null,
    erasureReceipt: null, fencingReason: null, deletionProcessingToken: null,
  };
  const receipt: FencedImageReceipt = { kind: 'image', protocol: STATE_REFERENCE_COPY_V2_PROTOCOL,
    attemptToken, s3Key, digest: prepared.digest, mimeType: prepared.mimeType, sizeBytes: prepared.sizeBytes, eTag: '"image"' };
  const erased = { kind: 'marker' as const, protocol: STATE_REFERENCE_COPY_V2_PROTOCOL, attemptToken, s3Key, eTag: '"empty"', historyErased: true as const };
  const confirmed = { entityId, stateId: input.stateId, stateRevision: '2026-10-01T00:00:01.000Z', referenceImage: input.descriptor };
  const calls: string[] = [];
  const repository: FencedStateReferenceRepository = {
    findActiveAttempt: vi.fn(async () => null),
    findPendingAttemptForRecovery: vi.fn(async () => null),
    admit: vi.fn(async () => { calls.push('admit'); return { confirmed: null, attempt, newlyAdmitted: true }; }),
    authorizeDispatch: vi.fn(async () => { calls.push('permit'); return true; }),
    confirmObservedImage: vi.fn(async () => { calls.push('confirm'); return confirmed; }),
    claimFencing: vi.fn(async (value, claim) => { calls.push('claim-fence'); return { ...value, state: 'fencing', fencingReason: claim.reason, deletionProcessingToken: claim.processingToken ?? null }; }),
    completeFencing: vi.fn(async (value) => { calls.push('settle-fence'); return { ...value, state: 'effects_fenced', erasureReceipt: erased }; }),
    findByKeyAndScope: vi.fn(async () => null), listPersonalPendingFences: vi.fn(async () => []),
  };
  const imageCreator: FencedStateReferenceImageCreatePort = {
    loadSource: vi.fn(async () => { calls.push('source'); return prepared; }),
    createImage: vi.fn(async () => { calls.push('image'); return receipt; }),
  };
  const recovery: FencedStateReferenceRecoveryPort = {
    observe: vi.fn(async () => receipt),
    fenceAndErase: vi.fn(async () => { calls.push('storage-fence'); return erased; }),
  };
  const service = new FencedStateReferenceConfirmationService({ repository, imageCreator, recovery, admissionEnabled: enabled });
  return { service, repository, imageCreator, recovery, input, attempt, receipt, confirmed, erased, calls };
}

describe('FencedStateReferenceConfirmationService', () => {
  it('既定OFFで新規試行がなければ既存確認経路に戻り外部処理を呼ばない', async () => {
    const f = fixture(false);
    expect(await f.service.tryConfirmReference(f.input)).toBeNull();
    expect(f.calls).toEqual([]);
  });
  it('source検証・耐久admission・dispatch許可の順で初めて書き込む', async () => {
    const f = fixture();
    expect(await f.service.tryConfirmReference(f.input)).toEqual(f.confirmed);
    expect(f.calls).toEqual(['source', 'admit', 'permit', 'image', 'confirm']);
  });
  it('admission応答を失った呼び出しは画像を送信しない', async () => {
    const f = fixture(); vi.spyOn(f.repository, 'admit').mockRejectedValue(new Error('lost commit acknowledgement'));
    await expect(f.service.tryConfirmReference(f.input)).rejects.toThrow();
    expect(f.imageCreator.createImage).not.toHaveBeenCalled();
  });
  it('既存未確定試行はOFFでも元keyを観測し新規copyなしで画像を採用する', async () => {
    const f = fixture(false); vi.spyOn(f.repository, 'findActiveAttempt').mockResolvedValue(f.attempt);
    expect(await f.service.tryConfirmReference(f.input)).toEqual(f.confirmed);
    expect(f.recovery.observe).toHaveBeenCalledWith(f.attempt.intent);
    expect(f.imageCreator.createImage).not.toHaveBeenCalled();
    expect(f.imageCreator.loadSource).not.toHaveBeenCalled();
  });
  it('画像なしは終了証拠にせずdurable fencing後に同じkeyを保護する', async () => {
    const f = fixture(); vi.spyOn(f.repository, 'findActiveAttempt').mockResolvedValue(f.attempt);
    vi.spyOn(f.recovery, 'observe').mockResolvedValue({ kind: 'absent' });
    await expect(f.service.tryConfirmReference(f.input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(f.calls).toEqual(['claim-fence', 'storage-fence', 'settle-fence']);
    expect(f.repository.completeFencing).toHaveBeenCalledWith(expect.objectContaining({ state: 'fencing' }), f.erased);
  });
  it('元PUTの失敗は未確定のままにし自動再送や終了推定をしない', async () => {
    const f = fixture(); vi.spyOn(f.imageCreator, 'createImage').mockRejectedValue(new Error('response lost'));
    await expect(f.service.tryConfirmReference(f.input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(f.imageCreator.createImage).toHaveBeenCalledTimes(1);
    expect(f.repository.claimFencing).not.toHaveBeenCalled();
    expect(f.repository.confirmObservedImage).not.toHaveBeenCalled();
  });
  it('観測不明はmarkerを上書きせず保留する', async () => {
    const f = fixture(); vi.spyOn(f.repository, 'findActiveAttempt').mockResolvedValue(f.attempt);
    vi.spyOn(f.recovery, 'observe').mockRejectedValue(new Error('wrong token or unreadable object'));
    await expect(f.service.tryConfirmReference(f.input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(f.repository.claimFencing).not.toHaveBeenCalled();
  });
  it('採用がstaleで失敗した未公開画像はfenceするがconfirmed画像は消さない', async () => {
    const f = fixture(); vi.spyOn(f.repository, 'findActiveAttempt').mockResolvedValue(f.attempt);
    vi.spyOn(f.repository, 'confirmObservedImage').mockRejectedValue(new ConflictError('stale'));
    await expect(f.service.tryConfirmReference(f.input)).rejects.toThrow();
    expect(f.calls).toContain('storage-fence');
    const c = fixture(); vi.spyOn(c.repository, 'findActiveAttempt').mockResolvedValue({ ...c.attempt, state: 'confirmed', imageReceipt: c.receipt });
    vi.spyOn(c.repository, 'confirmObservedImage').mockRejectedValue(new ConflictError('stale'));
    await expect(c.service.tryConfirmReference(c.input)).rejects.toThrow();
    expect(c.repository.claimFencing).not.toHaveBeenCalled();
    expect(c.recovery.observe).not.toHaveBeenCalled();
  });
});
