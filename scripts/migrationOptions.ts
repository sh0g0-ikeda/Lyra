import { ConfigurationError } from '../src/domain/errors/index.js';

export const PRODUCTION_BRIDGE_QUIESCENCE_FLAG = '--production-lineage-bridge-quiesced';

/** An explicit one-off operator assertion; never enabled by a default env flag. */
export function parseMigrationOptions(args: readonly string[]): { allowProductionLineageBridge: boolean } {
  if (args.some((argument) => argument !== PRODUCTION_BRIDGE_QUIESCENCE_FLAG) || args.length > 1) {
    throw new ConfigurationError('Unexpected migration argument');
  }
  return { allowProductionLineageBridge: args.includes(PRODUCTION_BRIDGE_QUIESCENCE_FLAG) };
}
