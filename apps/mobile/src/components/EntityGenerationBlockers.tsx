import type {
  EntityReferenceGenerationBlocker,
  EntityReferenceGenerationBlockerCode,
} from '@/domain/entityReferencePolicy';
import type { UiLanguage } from '@/domain/types';

interface EntityGenerationBlockersProps {
  blockers: readonly EntityReferenceGenerationBlocker[];
  language: UiLanguage;
  messageForCode: (code: EntityReferenceGenerationBlockerCode) => string;
  onAction: (code: EntityReferenceGenerationBlockerCode) => void;
}

export function EntityGenerationBlockers({
  blockers: _blockers,
  language: _language,
  messageForCode: _messageForCode,
  onAction: _onAction,
}: EntityGenerationBlockersProps): null {
  // The source fields and disabled generation action provide the actionable state.
  return null;
}
