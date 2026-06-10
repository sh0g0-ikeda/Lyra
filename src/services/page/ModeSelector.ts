import {
  calculatePageGenerationCreditCost,
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
    input: ModeSelectionInput & {
      requestKind: PageGenerationRequestKind;
      billableReferenceCount: number;
    },
  ): PageGenerationSelection {
    validateBillableReferenceCount(input.billableReferenceCount);
    const mode = this.selectMode(input);
    const creditCost = calculatePageGenerationCreditCost(input.billableReferenceCount);

    if (input.requestKind === 'regenerate') {
      return {
        requestKind: input.requestKind,
        mode,
        quality: PAGE_GENERATION_QUALITY.REGENERATE,
        creditCost,
        billableReferenceCount: input.billableReferenceCount,
        // Regeneration is billed and stored separately, but rendering remains a fresh
        // creation from current inputs. Planner usage depends on page complexity only.
        requiresPlanner: mode === 'thinking',
      };
    }

    return {
      requestKind: input.requestKind,
      mode,
      quality: PAGE_GENERATION_QUALITY.INITIAL,
      creditCost,
      billableReferenceCount: input.billableReferenceCount,
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

function validateBillableReferenceCount(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError('billableReferenceCount must be a non-negative integer');
  }
}
