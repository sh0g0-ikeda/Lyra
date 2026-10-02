import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import * as Crypto from 'expo-crypto';
import { GenerationQuoteController } from '@/domain/generationQuoteController';
import { assetQuoteMatchesTarget, type AssetQuoteTarget } from '@/domain/assetGenerationQuote';
import type { GenerationQuoteReceipt } from '@/domain/pageGenerationQuote';
import type { LyraMobileApiClient } from '@/lib/api';
interface Input {
  api: LyraMobileApiClient;
  contextKey: string;
  organizationId: string | null;
  enabled: boolean;
  revision?: string;
  prepare?: (target: AssetQuoteTarget) => Promise<AssetQuoteTarget | null>;
  onAccepted: (receipt: GenerationQuoteReceipt, target: AssetQuoteTarget, originKey: string) => void | Promise<void>;
}
function dependencies(input: Input): ConstructorParameters<typeof GenerationQuoteController<AssetQuoteTarget, AssetQuoteTarget>>[0] {
  return {
    prepare: input.prepare ?? (async (target) => target), quoteMatchesTarget: assetQuoteMatchesTarget,
    createQuote: (target, organizationId) => input.api.createGenerationQuote(target.request, organizationId),
    acceptQuote: (quoteId, body, organizationId) => input.api.acceptGenerationQuote(quoteId, body, organizationId),
    getReceipt: (quoteId, organizationId) => input.api.getGenerationQuote(quoteId, organizationId),
    requestKey: () => Crypto.randomUUID(), now: Date.now, onAccepted: input.onAccepted
  };
}
export function useAssetGenerationQuote(input: Input): { controller: GenerationQuoteController<AssetQuoteTarget, AssetQuoteTarget>; state: ReturnType<GenerationQuoteController<AssetQuoteTarget, AssetQuoteTarget>['getSnapshot']> } {
  const [controller] = useState(() => new GenerationQuoteController(dependencies(input), { key: input.contextKey, organizationId: input.organizationId, enabled: input.enabled, revision: input.revision }));
  useLayoutEffect(() => { controller.updateDependencies(dependencies(input)); controller.updateContext({ key: input.contextKey, organizationId: input.organizationId, enabled: input.enabled, revision: input.revision }); }, [controller, input]);
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { controller, state };
}
