import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import { buildEntityReferenceCandidateImageSource } from '../domain/entityReferenceCandidateImageSources';
import { EntityReferenceImportImageError } from '../domain/entityReferenceImportImage';
import { refreshProtectedImageSource, type RemoteImageSource } from '../domain/entityReferenceImageSources';
import type {
  ConfirmEntityReferenceInput,
  EntityImportResponseRecord,
  EntityRecord,
  EntityReferenceSetRecord,
} from '../lib/api';
import { ApiError } from '../lib/api';
import {
  showEntityReferenceConfirmPrompt,
  type EntityReferenceConfirmPromptInput,
} from '../lib/entityReferenceConfirmPrompt';
import { t, type MessageKey, type UiLanguage } from '../lib/i18n';
import {
  entityReferenceImagePicker,
  type EntityReferenceImagePickerPort,
} from '../infrastructure/entityReferenceImagePicker';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';
import { ResilientAuthenticatedImage } from './ResilientAuthenticatedImage';

export interface EntityReferenceMutationApiPort {
  confirmEntityReference(
    entityId: string,
    body: ConfirmEntityReferenceInput,
    organizationId?: string | null,
  ): Promise<EntityReferenceSetRecord>;
  importEntityReferenceImage(
    entityId: string,
    entityType: EntityRecord['entity_type'],
    imageDataUrl: string,
    organizationId?: string | null,
  ): Promise<EntityImportResponseRecord>;
}

interface EntityReferenceImportControlsProps {
  acceptReferenceSet(referenceSet: EntityReferenceSetRecord): void;
  api: EntityReferenceMutationApiPort;
  apiBaseUrl: string;
  authorizationHeader: string | null;
  confirmReferenceCandidate?: (
    input: EntityReferenceConfirmPromptInput,
  ) => Promise<boolean>;
  entityId: string;
  entityName: string;
  entityType: EntityRecord['entity_type'];
  imagePicker?: EntityReferenceImagePickerPort;
  language: UiLanguage;
  onOperationActiveChange?(operationId: string, active: boolean): void;
  organizationId: string | null;
  referenceSet: EntityReferenceSetRecord | undefined;
  referenceSetError: boolean;
  refreshAuthorizationHeader(): Promise<string>;
  refreshReferenceSet(): Promise<EntityReferenceSetRecord | null>;
  resetImageAuthorization(): void;
  sessionKey: string;
}

interface ImportCandidate {
  ambiguous: boolean;
  baselineFingerprint: string;
  previewLoaded: boolean;
  promptSupplement: string;
  revision: string;
  token: string;
}

interface Feedback {
  key: MessageKey;
  tone?: 'danger';
}

interface ActiveReferenceOperation {
  id: string;
  promise: Promise<void>;
}

let nextReferenceOperationSequence = 0;

export function EntityReferenceImportControls({
  acceptReferenceSet,
  api,
  apiBaseUrl,
  authorizationHeader,
  confirmReferenceCandidate = showEntityReferenceConfirmPrompt,
  entityId,
  entityName,
  entityType,
  imagePicker = entityReferenceImagePicker,
  language,
  onOperationActiveChange,
  organizationId,
  referenceSet,
  referenceSetError,
  refreshAuthorizationHeader,
  refreshReferenceSet,
  resetImageAuthorization,
  sessionKey,
}: EntityReferenceImportControlsProps): React.JSX.Element {
  const [candidate, setCandidate] = useState<ImportCandidate | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [operation, setOperation] = useState<'confirming' | 'idle' | 'importing'>('idle');
  const operationRef = useRef<ActiveReferenceOperation | null>(null);
  const candidateRevision = useRef(0);
  const mounted = useRef(true);
  const operationChangeHandler = useRef(onOperationActiveChange);

  useEffect(() => {
    operationChangeHandler.current = onOperationActiveChange;
  }, [onOperationActiveChange]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = operationRef.current;
      operationRef.current = null;
      if (current !== null) {
        operationChangeHandler.current?.(current.id, false);
      }
    };
  }, []);

  const runExclusive = useCallback((
    nextOperation: 'confirming' | 'importing',
    work: () => Promise<void>,
  ): void => {
    if (operationRef.current !== null) {
      return;
    }
    setOperation(nextOperation);
    const operationId = createReferenceOperationId({
      entityId,
      nextOperation,
      organizationId,
      sessionKey,
    });
    operationChangeHandler.current?.(operationId, true);
    const current: ActiveReferenceOperation = {
      id: operationId,
      promise: Promise.resolve().then(work),
    };
    operationRef.current = current;
    const settle = (): void => {
      if (operationRef.current === current) {
        operationRef.current = null;
        if (mounted.current) {
          setOperation('idle');
        }
        operationChangeHandler.current?.(operationId, false);
      }
    };
    void current.promise.then(settle, settle);
  }, [entityId, organizationId, sessionKey]);

  const importImage = useCallback((): void => {
    if (
      candidate !== null
      || referenceSet === undefined
      || referenceSetError
    ) {
      return;
    }
    runExclusive('importing', async () => {
      setFeedback(null);
      try {
        const picked = await imagePicker.pick();
        if (picked === null || !mounted.current) {
          return;
        }
        const latest = await refreshReferenceSet();
        if (!mounted.current) {
          return;
        }
        if (latest === null) {
          setFeedback({ key: 'characterReferenceLoadError', tone: 'danger' });
          return;
        }
        acceptReferenceSet(latest);
        const imported = await api.importEntityReferenceImage(
          entityId,
          entityType,
          picked.dataUrl,
          organizationId,
        );
        if (!mounted.current) {
          return;
        }
        candidateRevision.current += 1;
        setCandidate({
          ambiguous: false,
          baselineFingerprint: referenceSetFingerprint(latest),
          previewLoaded: false,
          promptSupplement: imported.prompt_supplement,
          revision: `candidate-${candidateRevision.current}`,
          token: imported.tmp_image_token,
        });
      } catch (error) {
        if (!mounted.current) {
          return;
        }
        setFeedback({
          key: importErrorMessageKey(error),
          tone: 'danger',
        });
      }
    });
  }, [
    acceptReferenceSet,
    api,
    candidate,
    entityId,
    entityType,
    imagePicker,
    organizationId,
    referenceSet,
    referenceSetError,
    refreshReferenceSet,
    runExclusive,
  ]);

  const confirmCandidate = useCallback((): void => {
    if (candidate === null || !candidate.previewLoaded || candidate.ambiguous) {
      return;
    }
    runExclusive('confirming', async () => {
      setFeedback(null);
      let confirmDispatched = false;
      try {
        const latest = await refreshReferenceSet();
        if (!mounted.current) {
          return;
        }
        if (latest === null) {
          setFeedback({ key: 'characterReferenceLoadError', tone: 'danger' });
          return;
        }
        acceptReferenceSet(latest);
        const latestFingerprint = referenceSetFingerprint(latest);
        if (latestFingerprint !== candidate.baselineFingerprint) {
          setCandidate((current) => current === null ? null : {
            ...current,
            baselineFingerprint: latestFingerprint,
          });
          setFeedback({ key: 'characterReferenceRemoteChanged', tone: 'danger' });
          return;
        }
        if (!(await confirmReferenceCandidate({
          existingCount: latest.reference_images.length,
          language,
        })) || !mounted.current) {
          return;
        }

        confirmDispatched = true;
        const confirmed = await api.confirmEntityReference(
          entityId,
          {
            selected_candidate_tokens: [candidate.token],
            primary_candidate_token: candidate.token,
            prompt_supplement: candidate.promptSupplement,
          },
          organizationId,
        );
        if (!mounted.current) {
          return;
        }
        acceptReferenceSet(confirmed);
        setCandidate(null);
        setFeedback({ key: 'characterReferenceConfirmed' });
        const refreshed = await refreshReferenceSet().catch(() => null);
        if (!mounted.current) {
          return;
        }
        acceptReferenceSet(
          refreshed !== null && refreshed.updated_at >= confirmed.updated_at
            ? refreshed
            : confirmed,
        );
      } catch (error) {
        if (!mounted.current) {
          return;
        }
        if (!confirmDispatched) {
          setFeedback({ key: 'characterReferenceLoadError', tone: 'danger' });
          return;
        }
        if (isDefinitiveRequestRejection(error)) {
          setFeedback({ key: 'characterReferenceConfirmRejected', tone: 'danger' });
          return;
        }
        const refreshed = await refreshReferenceSet().catch(() => null);
        if (!mounted.current) {
          return;
        }
        if (refreshed !== null) {
          acceptReferenceSet(refreshed);
        }
        setCandidate((current) => current === null ? null : {
          ...current,
          ambiguous: true,
        });
        setFeedback({ key: 'characterReferenceConfirmAmbiguous', tone: 'danger' });
      }
    });
  }, [
    acceptReferenceSet,
    api,
    candidate,
    confirmReferenceCandidate,
    entityId,
    language,
    organizationId,
    refreshReferenceSet,
    runExclusive,
  ]);

  const importDisabled = operation !== 'idle'
    || candidate !== null
    || referenceSet === undefined
    || referenceSetError;

  return (
    <View style={styles.controls}>
      <PrimaryButton
        disabled={importDisabled}
        label={t(language, 'characterReferenceImportAction')}
        loading={operation === 'importing'}
        onPress={importImage}
      />
      {operation === 'importing' ? (
        <Notice message={t(language, 'characterReferenceImporting')} />
      ) : operation === 'confirming' ? (
        <Notice message={t(language, 'characterReferenceConfirming')} />
      ) : null}
      {feedback === null ? null : (
        <Notice message={t(language, feedback.key)} tone={feedback.tone} />
      )}
      {candidate === null ? null : (
        <ImportCandidateCard
          ambiguous={candidate.ambiguous}
          apiBaseUrl={apiBaseUrl}
          authorizationHeader={authorizationHeader}
          entityId={entityId}
          entityName={entityName}
          language={language}
          onConfirm={confirmCandidate}
          onDiscard={() => {
            if (operationRef.current !== null) {
              return;
            }
            setCandidate(null);
            setFeedback(null);
          }}
          onPreviewFailed={() => setCandidate((current) => current === null ? null : {
            ...current,
            previewLoaded: false,
          })}
          onPreviewLoaded={() => setCandidate((current) => current === null ? null : {
            ...current,
            previewLoaded: true,
          })}
          operationActive={operation !== 'idle'}
          organizationId={organizationId}
          previewLoaded={candidate.previewLoaded}
          promptSupplement={candidate.promptSupplement}
          refreshAuthorizationHeader={refreshAuthorizationHeader}
          resetImageAuthorization={resetImageAuthorization}
          revision={candidate.revision}
          sessionKey={sessionKey}
          token={candidate.token}
        />
      )}
    </View>
  );
}

interface ImportCandidateCardProps {
  ambiguous: boolean;
  apiBaseUrl: string;
  authorizationHeader: string | null;
  entityId: string;
  entityName: string;
  language: UiLanguage;
  onConfirm(): void;
  onDiscard(): void;
  onPreviewFailed(): void;
  onPreviewLoaded(): void;
  operationActive: boolean;
  organizationId: string | null;
  previewLoaded: boolean;
  promptSupplement: string;
  refreshAuthorizationHeader(): Promise<string>;
  resetImageAuthorization(): void;
  revision: string;
  sessionKey: string;
  token: string;
}

function ImportCandidateCard({
  ambiguous,
  apiBaseUrl,
  authorizationHeader,
  entityId,
  entityName,
  language,
  onConfirm,
  onDiscard,
  onPreviewFailed,
  onPreviewLoaded,
  operationActive,
  organizationId,
  previewLoaded,
  promptSupplement,
  refreshAuthorizationHeader,
  resetImageAuthorization,
  revision,
  sessionKey,
  token,
}: ImportCandidateCardProps): React.JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const source = useMemo(() => buildEntityReferenceCandidateImageSource({
    apiBaseUrl,
    authorizationHeader,
    candidateToken: token,
    entityId,
    organizationId,
    revision,
    sessionKey,
  }), [
    apiBaseUrl,
    authorizationHeader,
    entityId,
    organizationId,
    revision,
    sessionKey,
    token,
  ]);
  const refreshProtectedSource = useCallback(async (): Promise<RemoteImageSource> => {
    if (source.protectedSource === null) {
      throw new Error('Candidate image source is unavailable');
    }
    return refreshProtectedImageSource(
      source.protectedSource,
      await refreshAuthorizationHeader(),
    );
  }, [refreshAuthorizationHeader, source.protectedSource]);
  const retry = (): void => {
    resetImageAuthorization();
    onPreviewFailed();
    setFailed(false);
    setAttempt((current) => current + 1);
  };

  return (
    <View style={styles.candidateCard}>
      <Text style={styles.heading}>{t(language, 'characterReferenceCandidateHeading')}</Text>
      {failed || source.protectedSource === null ? (
        <View style={styles.imagePlaceholder}>
          <Notice
            message={t(language, 'characterReferenceCandidatePreviewError')}
            tone="danger"
          />
          <PrimaryButton
            label={t(language, 'characterReferenceCandidateRetry')}
            onPress={retry}
          />
        </View>
      ) : (
        <ResilientAuthenticatedImage
          accessibilityLabel={t(language, 'characterReferenceCandidateAlt', {
            name: entityName,
          })}
          identity={`${source.identity}:attempt-${attempt}`}
          onExhausted={() => {
            onPreviewFailed();
            setFailed(true);
          }}
          onLoad={onPreviewLoaded}
          protectedSource={source.protectedSource}
          publicSource={null}
          refreshProtectedSource={refreshProtectedSource}
          style={styles.image}
        />
      )}
      <Text style={styles.label}>{t(language, 'characterReferencePromptSupplement')}</Text>
      <Text style={styles.promptSupplement}>{promptSupplement}</Text>
      <View style={styles.actions}>
        <PrimaryButton
          disabled={!previewLoaded || ambiguous || operationActive}
          label={t(language, 'characterReferenceConfirmAction')}
          loading={operationActive}
          onPress={onConfirm}
        />
        <PrimaryButton
          disabled={operationActive}
          label={t(language, 'characterReferenceCandidateDiscard')}
          onPress={onDiscard}
        />
      </View>
    </View>
  );
}

function importErrorMessageKey(error: unknown): MessageKey {
  if (error instanceof EntityReferenceImportImageError) {
    return error.reason === 'too_large'
      ? 'characterReferenceImportTooLarge'
      : 'characterReferenceImportInvalid';
  }
  if (error instanceof ApiError) {
    if (error.status === 402) {
      return 'characterReferenceImportInsufficientCredits';
    }
    if (error.status === 413) {
      return 'characterReferenceImportTooLarge';
    }
    if (error.status === 422) {
      return 'characterReferenceImportInvalid';
    }
    if (error.status === 429) {
      return 'characterReferenceImportRateLimited';
    }
  }
  return 'characterReferenceImportError';
}

function isDefinitiveRequestRejection(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

function createReferenceOperationId(input: {
  entityId: string;
  nextOperation: 'confirming' | 'importing';
  organizationId: string | null;
  sessionKey: string;
}): string {
  nextReferenceOperationSequence += 1;
  return [
    'entity-reference-operation',
    input.sessionKey,
    input.organizationId ?? 'personal',
    input.entityId,
    input.nextOperation,
    String(nextReferenceOperationSequence),
  ].map(encodeURIComponent).join(':');
}

function referenceSetFingerprint(referenceSet: EntityReferenceSetRecord): string {
  return JSON.stringify({
    images: referenceSet.reference_images.map((image) => ({
      createdAt: image.created_at,
      refId: image.ref_id,
      source: image.source,
    })),
    primaryRefId: referenceSet.primary_ref_id,
    status: referenceSet.status,
    updatedAt: referenceSet.updated_at,
  });
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.sm,
  },
  candidateCard: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  controls: {
    gap: spacing.sm,
  },
  heading: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  image: {
    aspectRatio: 0.72,
    backgroundColor: colors.canvas,
    borderRadius: radius.sm,
    width: '100%',
  },
  imagePlaceholder: {
    aspectRatio: 0.72,
    backgroundColor: colors.canvas,
    borderRadius: radius.sm,
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.md,
    width: '100%',
  },
  label: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  promptSupplement: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
});
