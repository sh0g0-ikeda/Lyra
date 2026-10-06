import { ConfigurationError } from '../domain/errors/index.js';
import {
  createTerminalGenerationNotificationRecoveryRepository,
} from '../repositories/TerminalGenerationNotificationRecoveryRepository.js';
import {
  isProduction44RepositorySchemaProfile,
  type RepositorySchemaProfile,
} from '../repositories/RepositorySchemaProfile.js';
import { TerminalGenerationNotificationRecoveryService } from '../services/notification/TerminalGenerationNotificationRecoveryService.js';
import type { DatabaseClient, TransactionRunner } from './db.js';

const MIN_INTERVAL_MS = 5_000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export interface TerminalGenerationNotificationRecoveryRuntimeOptions {
  enabled: boolean;
  cutover?: string;
  intervalMs: number;
}

export interface TerminalGenerationNotificationRecoveryRuntime {
  readonly intervalMs: number;
  run(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * The caller supplies an explicit rollout cutover. No process clock or database
 * history is used to widen the notification population implicitly.
 */
export async function createTerminalGenerationNotificationRecoveryRuntime(
  database: DatabaseClient & TransactionRunner,
  profile: RepositorySchemaProfile,
  options: TerminalGenerationNotificationRecoveryRuntimeOptions,
): Promise<TerminalGenerationNotificationRecoveryRuntime | null> {
  if (!options.enabled || profile === 'canonical') return null;
  if (!isProduction44RepositorySchemaProfile(profile)) {
    throw new ConfigurationError('Unsupported terminal notification recovery profile');
  }
  if (!isExactUtcTimestamp(options.cutover)
    || !Number.isSafeInteger(options.intervalMs)
    || options.intervalMs < MIN_INTERVAL_MS
    || options.intervalMs > MAX_INTERVAL_MS) {
    throw new ConfigurationError('Invalid terminal notification recovery runtime configuration');
  }
  const repository = await createTerminalGenerationNotificationRecoveryRepository(database, profile);
  const service = new TerminalGenerationNotificationRecoveryService(repository, options.cutover);
  return new Runtime(service, options.intervalMs);
}

/** Runs one startup batch before scheduling later bounded batches. */
export async function startTerminalGenerationNotificationRecoveryMaintenance(
  runtime: TerminalGenerationNotificationRecoveryRuntime | null,
): Promise<() => Promise<void>> {
  if (runtime === null) return async () => undefined;
  await runtime.run();
  const timer = setInterval(() => { void runtime.run(); }, runtime.intervalMs);
  timer.unref();
  let stopping: Promise<void> | null = null;
  return (): Promise<void> => {
    clearInterval(timer);
    stopping ??= runtime.stop();
    return stopping;
  };
}

class Runtime implements TerminalGenerationNotificationRecoveryRuntime {
  private active: Promise<void> | null = null;
  private stopped = false;
  private stopping: Promise<void> | null = null;

  public constructor(
    private readonly service: Pick<TerminalGenerationNotificationRecoveryService, 'run' | 'stop'>,
    public readonly intervalMs: number,
  ) {}

  public run(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.active !== null) return this.active;
    const work = this.recover();
    this.active = work;
    void work.then(
      () => { if (this.active === work) this.active = null; },
      () => { if (this.active === work) this.active = null; },
    );
    return work;
  }

  public stop(): Promise<void> {
    this.stopped = true;
    this.stopping ??= this.service.stop();
    return this.stopping;
  }

  private async recover(): Promise<void> {
    try {
      const result = await this.service.run();
      if (result.scanned > 0 || result.scanFailed || result.failed > 0) {
        console.info(JSON.stringify({
          event: 'terminal_generation_notification_recovery',
          scanned: result.scanned,
          inserted: result.inserted,
          existing: result.existing,
          deferred: result.deferred,
          failed: result.failed,
          wrapped: result.wrapped,
          scanFailed: result.scanFailed,
          stopped: result.stopped,
        }));
      }
    } catch {
      console.error('Terminal generation notification recovery failed; retry retained for the next cycle');
    }
  }
}

function isExactUtcTimestamp(value: string | undefined): value is string {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}
