import type { GenerationQuote, GenerationQuoteRequest } from '@/domain/pageGenerationQuote';
export interface AssetQuoteTarget {
  request: GenerationQuoteRequest & { operation: 'entity_preview' | 'entity_state_preview' | 'entity_import_analysis' };
  label: string;
  revision: string;
}
export function assetQuoteMatchesTarget(quote: GenerationQuote, target: AssetQuoteTarget): boolean {
  if (quote.operation !== target.request.operation) return false;
  // Import target IDs identify the server-verified upload, not an entity. The
  // opaque upload token is bound by the authenticated quote-creation request.
  if (target.request.operation === 'entity_import_analysis') return quote.image_model === null && quote.quality === null && quote.render_style === null;
  return quote.target_id === target.request.target_id && quote.image_model === 'gpt-image-2' && quote.quality === 'medium' &&
    (target.request.render_style === undefined || quote.render_style === target.request.render_style);
}
