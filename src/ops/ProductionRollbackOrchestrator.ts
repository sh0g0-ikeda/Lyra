import {
  assertRollbackAuthorization,
  buildRecoveryActions,
  buildRollbackActions,
  createRollbackReceipt,
  evaluateRollbackPreconditions,
  RollbackSafetyError,
  type ProductionSnapshot,
  type RecoveryAction,
  type RollbackAction,
  type RollbackManifest,
  type RollbackObservation,
  type RollbackReceipt,
} from './ProductionRollback.js';

export interface ProductionRollbackCloudPort {
  collectObservation(manifest: RollbackManifest): Promise<RollbackObservation>;
  captureSnapshot(manifest: RollbackManifest): Promise<ProductionSnapshot>;
  executeRollbackAction(action: RollbackAction): Promise<void>;
  executeRecoveryAction(action: RecoveryAction): Promise<void>;
}

export interface RollbackReceiptStore {
  save(receipt: RollbackReceipt): Promise<string>;
}

export type ProductionRollbackResult =
  | {
      mode: 'dry-run';
      actions: RollbackAction[];
    }
  | {
      mode: 'applied';
      actions: RollbackAction[];
      receiptPath: string;
    };

export interface RunProductionRollbackInput {
  manifest: RollbackManifest;
  options: {
    apply: boolean;
    confirmation?: string;
  };
  cloud: ProductionRollbackCloudPort;
  receiptStore: RollbackReceiptStore;
}

export async function runProductionRollback(
  input: RunProductionRollbackInput,
): Promise<ProductionRollbackResult> {
  assertRollbackAuthorization(input.manifest, input.options);

  const observation = await input.cloud.collectObservation(input.manifest);
  const preconditionErrors = evaluateRollbackPreconditions(input.manifest, observation);
  if (preconditionErrors.length > 0) {
    throw new RollbackSafetyError(preconditionErrors.join('\n'));
  }

  const actions = buildRollbackActions(input.manifest);
  if (!input.options.apply) {
    return {
      mode: 'dry-run',
      actions,
    };
  }

  const snapshot = await input.cloud.captureSnapshot(input.manifest);
  const receiptPath = await input.receiptStore.save(
    createRollbackReceipt(input.manifest, snapshot),
  );

  try {
    for (const action of actions) {
      await input.cloud.executeRollbackAction(action);
    }
  } catch (rollbackError) {
    await recoverPreviousProductionState(input, snapshot, rollbackError);
  }

  return {
    mode: 'applied',
    actions,
    receiptPath,
  };
}

async function recoverPreviousProductionState(
  input: RunProductionRollbackInput,
  snapshot: ProductionSnapshot,
  rollbackError: unknown,
): Promise<never> {
  const recoveryErrors: string[] = [];

  for (const action of buildRecoveryActions(input.manifest, snapshot)) {
    try {
      await input.cloud.executeRecoveryAction(action);
    } catch (recoveryError) {
      recoveryErrors.push(`${action.kind}: ${toErrorMessage(recoveryError)}`);
    }
  }

  if (recoveryErrors.length > 0) {
    throw new RollbackSafetyError(
      [
        `Rollback failed: ${toErrorMessage(rollbackError)}`,
        'Automatic recovery was incomplete.',
        ...recoveryErrors,
      ].join('\n'),
    );
  }

  throw new RollbackSafetyError(
    `Rollback failed and the previous production state was restored: ${toErrorMessage(rollbackError)}`,
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 1000);
  }
  return 'Unknown operation error';
}
