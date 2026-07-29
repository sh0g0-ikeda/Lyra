import { ApiError } from '@/lib/api';

interface PageGenerationResult {
  job_id: string;
}

interface PageGenerationFallbackInput {
  saveAndGenerate: () => Promise<PageGenerationResult>;
  saveDrafts: () => Promise<void>;
  generateLegacy: () => Promise<PageGenerationResult>;
}

export const hasUnsavedNewPanelDraft = ({
  panelDirty,
  selectedPanelId,
}: {
  panelDirty: boolean;
  selectedPanelId: string | null;
}): boolean => panelDirty && selectedPanelId === null;

export const isLegacyPageGenerationCapabilityUnavailable = (
  error: unknown,
): error is ApiError =>
  error instanceof ApiError && (error.status === 404 || error.status === 405);

export const runPageGenerationWithLegacyFallback = async ({
  saveAndGenerate,
  saveDrafts,
  generateLegacy,
}: PageGenerationFallbackInput): Promise<PageGenerationResult> => {
  try {
    return await saveAndGenerate();
  } catch (error) {
    if (!isLegacyPageGenerationCapabilityUnavailable(error)) {
      throw error;
    }
  }

  await saveDrafts();
  return generateLegacy();
};
