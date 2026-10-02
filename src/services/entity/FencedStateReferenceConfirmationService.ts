import { ConfigurationError, ConflictError } from '../../domain/errors/index.js';
import type { ConfirmedEntityStateReference, ConfirmEntityStateReferenceInput } from '../../domain/types/entityStateReference.js';
import type {
  FencedImageReceipt, FencedStorageOperationBudget, FencedStateReferenceImageCreatePort,
  FencedStateReferenceRecoveryPort,
} from '../../infrastructure/aws/FencedStateReferenceStorage.js';
import type {
  FencedStateReferenceAttempt, FencedStateReferenceRepository, FencedStateReferenceRecoveryScope,
} from '../../repositories/FencedStateReferenceRepository.js';

export interface FencedStateReferenceConfirmationPort {
  recoverPendingReference(scope: FencedStateReferenceRecoveryScope): Promise<void>;
  /** null chooses the unchanged legacy path; existing v2 attempts never fall back. */
  tryConfirmReference(input: ConfirmEntityStateReferenceInput): Promise<ConfirmedEntityStateReference | null>;
}
export interface PersonalStateReferenceFencingPort {
  fencePersonalReferences(userId: string, processingToken: string, budget: FencedStorageOperationBudget): Promise<boolean>;
}
export interface FencedStateReferenceConfirmationDependencies {
  repository: FencedStateReferenceRepository;
  imageCreator?: FencedStateReferenceImageCreatePort;
  recovery?: FencedStateReferenceRecoveryPort;
  admissionEnabled?: boolean;
}

/** Admission OFF does not disable recovery of already-issued v2 operations.
 * No new image is dispatched on an unknown outcome, failed DB acknowledgement,
 * or retry of an existing token. Only the repository can publish a descriptor.
 */
export class FencedStateReferenceConfirmationService
implements FencedStateReferenceConfirmationPort, PersonalStateReferenceFencingPort {
  public constructor(private readonly dependencies: FencedStateReferenceConfirmationDependencies) {}

  public async recoverPendingReference(scope: FencedStateReferenceRecoveryScope): Promise<void> {
    // One attempt bounds each call. Admission still refuses any remaining live
    // blocker. The lookup is authorized independently of candidate freshness.
    const attempt = await this.dependencies.repository.findPendingAttemptForRecovery(scope);
    if (attempt === null) return;
    if (attempt.input.userId !== scope.userId) {
      // Another current organization editor can retire an orphaned operation,
      // but cannot adopt its image or replace the stored original owner/input.
      await this.fenceUnconfirmed(attempt, scope.userId);
      return;
    }
    await this.recoverConfirmation(attempt);
  }

  public async tryConfirmReference(input: ConfirmEntityStateReferenceInput): Promise<ConfirmedEntityStateReference | null> {
    const existing = await this.dependencies.repository.findActiveAttempt(input);
    if (existing !== null) return await this.recoverConfirmation(existing) ?? discard();
    if (this.dependencies.admissionEnabled !== true) return null;
    const creator = this.requireCreator();
    const source = await creator.loadSource({
      ownerUserId: input.userId, entityId: input.entityId, sourceS3Key: input.candidateS3Key,
      mimeType: sourceMimeType(input.candidateS3Key),
    });
    const { imageData, ...preparedSource } = source;
    const admission = await this.dependencies.repository.admit(input, preparedSource);
    if (admission.confirmed !== null) return admission.confirmed;
    const attempt = admission.attempt;
    if (attempt === null) throw new ConfigurationError('State reference copy admission is missing');
    if (!admission.newlyAdmitted || !await this.dependencies.repository.authorizeDispatch(attempt)) {
      return await this.recoverConfirmation(attempt) ?? discard();
    }
    let receipt: FencedImageReceipt;
    try {
      receipt = await creator.createImage({ intent: attempt.intent, imageData });
    } catch {
      // The remote operation may still complete. Keep its exact durable intent.
      throw pending();
    }
    return await this.adoptObservedImage(attempt, receipt) ?? discard();
  }

  public async fencePersonalReferences(
    userId: string,
    processingToken: string,
    budget: FencedStorageOperationBudget,
  ): Promise<boolean> {
    const recovery = this.requireRecovery();
    // A bounded batch also limits DB-only work when an adapter produces no sends.
    const attempts = await this.dependencies.repository.listPersonalPendingFences(userId, processingToken, 25);
    for (const attempt of attempts) {
      if (budget.remainingTimeMs() <= 0) return false;
      const claimed = await this.dependencies.repository.claimFencing(attempt, { reason: 'account_deletion', processingToken });
      const receipt = await recovery.fenceAndErase(claimed.intent, budget);
      await this.dependencies.repository.completeFencing(claimed, receipt);
    }
    return (await this.dependencies.repository.listPersonalPendingFences(userId, processingToken, 1)).length === 0;
  }

  private async recoverConfirmation(attempt: FencedStateReferenceAttempt): Promise<ConfirmedEntityStateReference | null> {
    if (attempt.state === 'confirmed') {
      if (attempt.imageReceipt === null) throw pending();
      // A historical confirmed image cannot be erased by a stale confirmation.
      return this.dependencies.repository.confirmObservedImage(attempt, attempt.imageReceipt);
    }
    if (attempt.state === 'fencing') {
      await this.fenceUnconfirmed(attempt);
      return null;
    }
    if (attempt.state !== 'unresolved') return null;
    let observation;
    try {
      observation = await this.requireRecovery().observe(attempt.intent);
    } catch {
      // Unknown or foreign object metadata is not permission to overwrite it.
      throw pending();
    }
    if (observation.kind === 'image') return this.adoptObservedImage(attempt, observation);
    await this.fenceUnconfirmed(attempt);
    return null;
  }

  private async adoptObservedImage(attempt: FencedStateReferenceAttempt, receipt: FencedImageReceipt): Promise<ConfirmedEntityStateReference | null> {
    try {
      return await this.dependencies.repository.confirmObservedImage(attempt, receipt);
    } catch (error) {
      if (error instanceof ConflictError && attempt.state !== 'confirmed') {
        // The journal rechecks the current state. If another process already
        // confirmed the image, unconfirmed recovery cannot erase that image.
        await this.fenceUnconfirmed(attempt);
        return null;
      }
      throw error;
    }
  }

  private async fenceUnconfirmed(attempt: FencedStateReferenceAttempt, recoveryUserId?: string): Promise<void> {
    const recovery = this.dependencies.recovery;
    if (recovery === undefined) throw pending();
    const claimed = await this.dependencies.repository.claimFencing(attempt, {
      reason: 'unconfirmed_recovery', ...(recoveryUserId === undefined ? {} : { recoveryUserId }),
    });
    const receipt = await recovery.fenceAndErase(claimed.intent);
    await this.dependencies.repository.completeFencing(claimed, receipt);
  }
  private requireCreator(): FencedStateReferenceImageCreatePort {
    if (this.dependencies.imageCreator === undefined) throw new ConfigurationError('Verified state reference image storage is not configured');
    return this.dependencies.imageCreator;
  }
  private requireRecovery(): FencedStateReferenceRecoveryPort {
    if (this.dependencies.recovery === undefined) throw new ConfigurationError('Verified state reference recovery storage is not configured');
    return this.dependencies.recovery;
  }
}
function pending(): ConflictError { return new ConflictError('State reference copy outcome requires recovery; no new copy was started'); }
function discard(): never { throw new ConflictError('The previous state reference copy was safely discarded; review and retry confirmation'); }
function sourceMimeType(key: string): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  if (key.endsWith('.webp')) return 'image/webp';
  throw new ConfigurationError('State reference source MIME is invalid');
}
