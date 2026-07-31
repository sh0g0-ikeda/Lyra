import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import {
  buildEntityReferenceImageSources,
  refreshProtectedImageSource,
  type RemoteImageSource,
} from '../domain/entityReferenceImageSources';
import type { EntityRecord, EntityReferenceSetRecord } from '../lib/api';
import { t, type UiLanguage } from '../lib/i18n';
import type { storyQueryKeys } from '../lib/storyQueryKeys';
import {
  EntityReferenceImportControls,
  type EntityReferenceMutationApiPort,
} from './EntityReferenceImportControls';
import type { EntityReferenceImagePickerPort } from '../infrastructure/entityReferenceImagePicker';
import type { EntityReferenceConfirmPromptInput } from '../lib/entityReferenceConfirmPrompt';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';
import { ResilientAuthenticatedImage } from './ResilientAuthenticatedImage';

export interface EntityReferenceApiPort extends EntityReferenceMutationApiPort {
  getEntityReferenceSet(
    entityId: string,
    organizationId?: string | null,
  ): Promise<EntityReferenceSetRecord>;
  refreshImageAuthorizationHeader(): Promise<string>;
}

interface EntityReferenceSectionProps {
  api: EntityReferenceApiPort;
  apiBaseUrl: string;
  authorizationHeader: string | null;
  entityId: string;
  entityName: string;
  entityType: EntityRecord['entity_type'];
  confirmReferenceCandidate?: (
    input: EntityReferenceConfirmPromptInput,
  ) => Promise<boolean>;
  imagePicker?: EntityReferenceImagePickerPort;
  language: UiLanguage;
  onOperationActiveChange?(operationId: string, active: boolean): void;
  organizationId: string | null;
  queryKeys: ReturnType<typeof storyQueryKeys>;
  sessionKey: string;
}

export function EntityReferenceSection({
  api,
  apiBaseUrl,
  authorizationHeader,
  entityId,
  entityName,
  entityType,
  confirmReferenceCandidate,
  imagePicker,
  language,
  onOperationActiveChange,
  organizationId,
  queryKeys,
  sessionKey,
}: EntityReferenceSectionProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const refreshScope = `${sessionKey}:${organizationId ?? 'personal'}:${entityId}`;
  const imageAuthorizationRefresh = useRef<{
    header: string | null;
    operation: Promise<string> | null;
    scope: string;
  }>({ header: null, operation: null, scope: refreshScope });
  const referenceQuery = useQuery({
    queryKey: queryKeys.entityReferenceSet(entityId),
    queryFn: () => api.getEntityReferenceSet(entityId, organizationId),
  });
  const referenceQueryKey = queryKeys.entityReferenceSet(entityId);
  const refreshImageAuthorizationHeader = useCallback((): Promise<string> => {
    const current = imageAuthorizationRefresh.current;
    if (current.scope !== refreshScope) {
      current.scope = refreshScope;
      current.header = null;
      current.operation = null;
    }
    if (current.header !== null) {
      return Promise.resolve(current.header);
    }
    if (current.operation !== null) {
      return current.operation;
    }
    const operation = api.refreshImageAuthorizationHeader();
    current.operation = operation;
    const settle = (header: string | null): void => {
      if (current.operation === operation && current.scope === refreshScope) {
        current.operation = null;
        current.header = header;
      }
    };
    void operation.then(
      (header) => settle(header),
      () => settle(null),
    );
    return operation;
  }, [api, refreshScope]);
  const retryReferenceSet = useCallback(async (): Promise<boolean> => {
    if (imageAuthorizationRefresh.current.scope === refreshScope) {
      imageAuthorizationRefresh.current.header = null;
      imageAuthorizationRefresh.current.operation = null;
    }
    const result = await referenceQuery.refetch();
    return !result.isError;
  }, [referenceQuery, refreshScope]);
  const resetImageAuthorization = useCallback((): void => {
    if (imageAuthorizationRefresh.current.scope === refreshScope) {
      imageAuthorizationRefresh.current.header = null;
      imageAuthorizationRefresh.current.operation = null;
    }
  }, [refreshScope]);
  const refreshReferenceSet = useCallback(async (): Promise<EntityReferenceSetRecord | null> => {
    const result = await referenceQuery.refetch();
    return result.isError || result.data === undefined ? null : result.data;
  }, [referenceQuery]);
  const acceptReferenceSet = useCallback((referenceSet: EntityReferenceSetRecord): void => {
    queryClient.setQueryData(referenceQueryKey, referenceSet);
  }, [queryClient, referenceQueryKey]);

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{t(language, 'characterReferenceHeading')}</Text>
      <Text style={styles.muted}>{t(language, 'characterReferenceHelp')}</Text>
      {referenceQuery.data === undefined ? (
        referenceQuery.isError ? (
          <>
            <Notice message={t(language, 'characterReferenceLoadError')} tone="danger" />
            <PrimaryButton
              label={t(language, 'characterReferenceRetry')}
              loading={referenceQuery.isFetching}
              onPress={() => void referenceQuery.refetch()}
            />
          </>
        ) : (
          <Text style={styles.muted}>{t(language, 'characterReferenceLoading')}</Text>
        )
      ) : (
        <>
          <View style={styles.metrics}>
            <Text style={styles.metric}>
              {t(language, 'characterReferenceStatus', {
                status: referenceStatusLabel(language, referenceQuery.data.status),
              })}
            </Text>
            <Text style={styles.metric}>
              {t(
                language,
                referenceQuery.data.primary_ref_id === null
                  ? 'characterReferencePrimaryUnset'
                  : 'characterReferencePrimarySet',
              )}
            </Text>
            <Text style={styles.metric}>
              {t(language, 'characterReferenceCount', {
                count: String(referenceQuery.data.reference_images.length),
              })}
            </Text>
          </View>
          {referenceQuery.isError ? (
            <>
              <Notice message={t(language, 'characterReferenceRefreshError')} tone="danger" />
              <PrimaryButton
                label={t(language, 'characterReferenceRetry')}
                loading={referenceQuery.isFetching}
                onPress={() => void referenceQuery.refetch()}
              />
            </>
          ) : null}
          {referenceQuery.data.reference_images.length === 0 ? (
            <Notice message={t(language, 'characterReferenceEmpty')} />
          ) : (
            <View style={styles.imageGrid}>
              {referenceQuery.data.reference_images.map((reference, index) => (
                <ReferenceImageCard
                  apiBaseUrl={apiBaseUrl}
                  authorizationHeader={authorizationHeader}
                  createdAt={reference.created_at}
                  entityId={entityId}
                  entityName={entityName}
                  index={index}
                  isPrimary={reference.ref_id === referenceQuery.data.primary_ref_id}
                  key={reference.ref_id}
                  language={language}
                  onRetry={retryReferenceSet}
                  organizationId={organizationId}
                  reference={{
                    cdnUrl: reference.cdn_url,
                    refId: reference.ref_id,
                    source: reference.source,
                  }}
                  revision={referenceQuery.data.updated_at}
                  refreshAuthorizationHeader={refreshImageAuthorizationHeader}
                  sessionKey={sessionKey}
                />
              ))}
            </View>
          )}
          <EntityReferenceImportControls
            acceptReferenceSet={acceptReferenceSet}
            api={api}
            apiBaseUrl={apiBaseUrl}
            authorizationHeader={authorizationHeader}
            confirmReferenceCandidate={confirmReferenceCandidate}
            entityId={entityId}
            entityName={entityName}
            entityType={entityType}
            imagePicker={imagePicker}
            language={language}
            onOperationActiveChange={onOperationActiveChange}
            organizationId={organizationId}
            referenceSet={referenceQuery.data}
            referenceSetError={referenceQuery.isError}
            refreshAuthorizationHeader={refreshImageAuthorizationHeader}
            refreshReferenceSet={refreshReferenceSet}
            resetImageAuthorization={resetImageAuthorization}
            sessionKey={sessionKey}
          />
        </>
      )}
    </View>
  );
}

interface ReferenceImageCardProps {
  apiBaseUrl: string;
  authorizationHeader: string | null;
  createdAt: string;
  entityId: string;
  entityName: string;
  index: number;
  isPrimary: boolean;
  language: UiLanguage;
  onRetry(): Promise<boolean>;
  organizationId: string | null;
  reference: {
    cdnUrl?: string;
    refId: string;
    source: 'generated' | 'upload';
  };
  refreshAuthorizationHeader(): Promise<string>;
  revision: string;
  sessionKey: string;
}

function ReferenceImageCard({
  apiBaseUrl,
  authorizationHeader,
  createdAt,
  entityId,
  entityName,
  index,
  isPrimary,
  language,
  onRetry,
  organizationId,
  reference,
  refreshAuthorizationHeader,
  revision,
  sessionKey,
}: ReferenceImageCardProps): React.JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const sources = useMemo(() => buildEntityReferenceImageSources({
    apiBaseUrl,
    authorizationHeader,
    cdnUrl: reference.cdnUrl,
    entityId,
    organizationId,
    refId: reference.refId,
    revision,
    sessionKey,
  }), [
    apiBaseUrl,
    authorizationHeader,
    entityId,
    organizationId,
    reference.cdnUrl,
    reference.refId,
    revision,
    sessionKey,
  ]);
  const unavailable = sources.publicSource === null && sources.protectedSource === null;
  const refreshProtectedSource = useCallback(async (): Promise<RemoteImageSource> => {
    if (sources.protectedSource === null) {
      throw new Error('Protected image source is unavailable');
    }
    const nextAuthorizationHeader = await refreshAuthorizationHeader();
    return refreshProtectedImageSource(
      sources.protectedSource,
      nextAuthorizationHeader,
    );
  }, [refreshAuthorizationHeader, sources.protectedSource]);
  const retry = async (): Promise<void> => {
    if (retrying) {
      return;
    }
    setRetrying(true);
    try {
      if (await onRetry()) {
        setFailed(false);
        setAttempt((value) => value + 1);
      }
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View style={styles.imageCard}>
      {failed || unavailable ? (
        <View style={styles.imagePlaceholder}>
          <Text style={styles.muted}>{t(language, 'characterReferenceImageError')}</Text>
          <PrimaryButton
            label={t(language, 'characterReferenceImageRetry')}
            loading={retrying}
            onPress={() => void retry()}
          />
        </View>
      ) : (
        <ResilientAuthenticatedImage
          accessibilityLabel={t(language, 'characterReferenceImageAlt', {
            name: entityName,
            number: String(index + 1),
          })}
          identity={`${sources.identity}:attempt-${attempt}`}
          onExhausted={() => setFailed(true)}
          protectedSource={sources.protectedSource}
          publicSource={sources.publicSource}
          refreshProtectedSource={refreshProtectedSource}
          style={styles.image}
        />
      )}
      <Text style={styles.metric}>
        {t(
          language,
          reference.source === 'generated'
            ? 'characterReferenceSourceGenerated'
            : 'characterReferenceSourceUpload',
        )}
      </Text>
      <Text style={styles.muted}>
        {t(language, 'characterReferenceCreatedAt', {
          date: formatReferenceDate(createdAt),
        })}
      </Text>
      {isPrimary ? (
        <Text style={styles.primary}>{t(language, 'characterReferencePrimaryBadge')}</Text>
      ) : null}
    </View>
  );
}

function referenceStatusLabel(
  language: UiLanguage,
  status: EntityReferenceSetRecord['status'],
): string {
  if (status === 'ready') {
    return t(language, 'characterReferenceStatusReady');
  }
  if (status === 'partial') {
    return t(language, 'characterReferenceStatusPartial');
  }
  return t(language, 'characterReferenceStatusEmpty');
}

function formatReferenceDate(value: string): string {
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date : '-';
}

const styles = StyleSheet.create({
  section: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  heading: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  muted: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  metrics: {
    gap: spacing.xs,
  },
  metric: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  imageCard: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
    width: 160,
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
    padding: spacing.sm,
    width: '100%',
  },
  primary: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
  },
});
