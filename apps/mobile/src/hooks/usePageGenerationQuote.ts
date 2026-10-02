import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import * as Crypto from 'expo-crypto';
import { PageGenerationQuoteController } from '@/domain/pageGenerationQuoteController';
import type { GenerationQuoteReceipt, PageQuoteTarget, PreparedPageQuoteTarget } from '@/domain/pageGenerationQuote';
import type { LyraMobileApiClient } from '@/lib/api';

interface Input {
  api: LyraMobileApiClient;
  contextKey: string;
  organizationId: string | null;
  enabled: boolean;
  prepare: (target: PageQuoteTarget) => Promise<PreparedPageQuoteTarget | null>;
  onAccepted: (receipt: GenerationQuoteReceipt, target: PreparedPageQuoteTarget, originKey: string) => void | Promise<void>;
}
function dependencies(input: Input): ConstructorParameters<typeof PageGenerationQuoteController>[0] {
  return {
    prepare: input.prepare,
    createQuote: (target, organizationId) => input.api.createPageGenerationQuote({ operation: target.operation, target_id: target.pageId, render_style: target.renderStyle }, organizationId),
    acceptQuote: (quoteId, body, organizationId) => input.api.acceptGenerationQuote(quoteId, body, organizationId),
    getReceipt: (quoteId, organizationId) => input.api.getGenerationQuote(quoteId, organizationId),
    requestKey: () => Crypto.randomUUID(),
    now: Date.now,
    onAccepted: input.onAccepted
  };
}
export function usePageGenerationQuote(input: Input): { controller: PageGenerationQuoteController; state: ReturnType<PageGenerationQuoteController['getSnapshot']> } {
  const [controller] = useState(() => new PageGenerationQuoteController(dependencies(input), { key: input.contextKey, organizationId: input.organizationId, enabled: input.enabled }));
  useLayoutEffect(() => {
    controller.updateDependencies(dependencies(input));
    controller.updateContext({ key: input.contextKey, organizationId: input.organizationId, enabled: input.enabled });
  }, [controller, input]);
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { controller, state };
}
