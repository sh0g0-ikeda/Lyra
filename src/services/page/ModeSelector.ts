import {
  PAGE_GENERATION_CREDIT_COSTS,
  PAGE_GENERATION_QUALITY,
  THINKING_MODE_THRESHOLDS,
} from '../../domain/constants/generation.js';
import { ValidationError } from '../../domain/errors/index.js';
import type {
  ModeSelectionInput,
  PageGenerationMode,
  PageGenerationRequestKind,
  PageGenerationSelection,
} from '../../domain/types/pageGeneration.js';

/**
 * Centralizes page-generation profile selection so routes and workers share
 * the same thresholds, credit cost, quality, and planner rules.
 */
export class ModeSelector {
  public selectMode(input: ModeSelectionInput): PageGenerationMode {
    validateCounts(input);

    if (
      input.entityCount > THINKING_MODE_THRESHOLDS.MAX_ENTITIES_FOR_STANDARD ||
      input.panelCount > THINKING_MODE_THRESHOLDS.MAX_PANELS_FOR_STANDARD
    ) {
      return 'thinking';
    }

    return 'standard';
  }

  public selectProfile(
    input: ModeSelectionInput & { requestKind: PageGenerationRequestKind },
  ): PageGenerationSelection {
    const mode = this.selectMode(input);

    if (input.requestKind === 'regenerate') {
      return {
        requestKind: input.requestKind,
        mode,
        quality: PAGE_GENERATION_QUALITY.REGENERATE,
        creditCost: PAGE_GENERATION_CREDIT_COSTS.regenerate,
        requiresPlanner: true,
      };
    }

    return {
      requestKind: input.requestKind,
      mode,
      quality: PAGE_GENERATION_QUALITY.INITIAL,
      creditCost:
        mode === 'thinking'
          ? PAGE_GENERATION_CREDIT_COSTS.thinking
          : PAGE_GENERATION_CREDIT_COSTS.standard,
      requiresPlanner: mode === 'thinking',
    };
  }
}

function validateCounts(input: ModeSelectionInput): void {
  if (!Number.isInteger(input.entityCount) || input.entityCount < 0) {
    throw new ValidationError('entityCount must be a non-negative integer');
  }

  if (!Number.isInteger(input.panelCount) || input.panelCount < 0) {
    throw new ValidationError('panelCount must be a non-negative integer');
  }
}
