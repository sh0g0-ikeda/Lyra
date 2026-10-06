import { GenerationQuoteController, type GenerationQuoteContext, type GenerationQuoteDependencies, type GenerationQuoteSnapshot } from '@/domain/generationQuoteController';
import type { PageQuoteTarget, PreparedPageQuoteTarget } from '@/domain/pageGenerationQuote';
export type PageQuoteContext = GenerationQuoteContext;
export type PageQuoteSnapshot = GenerationQuoteSnapshot<PageQuoteTarget>;
type Dependencies = Omit<GenerationQuoteDependencies<PageQuoteTarget, PreparedPageQuoteTarget>, 'quoteMatchesTarget'>;
const withPageValidation = (dependencies: Dependencies): GenerationQuoteDependencies<PageQuoteTarget, PreparedPageQuoteTarget> => ({
  ...dependencies,
  quoteMatchesTarget: (quote, target) => quote.target_id === target.pageId && quote.operation === target.operation && quote.render_style === target.renderStyle
});
// Page-specific preparation and presentation retain the shared acceptance and
// receipt state machine used by asset generation and image analysis.
export class PageGenerationQuoteController extends GenerationQuoteController<PageQuoteTarget, PreparedPageQuoteTarget> {
  public constructor(dependencies: Dependencies, context: PageQuoteContext) { super(withPageValidation(dependencies), context); }
  public override updateDependencies(dependencies: Dependencies): void { super.updateDependencies(withPageValidation(dependencies)); }
}
