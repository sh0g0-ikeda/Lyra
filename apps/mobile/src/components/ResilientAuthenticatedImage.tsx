import { useEffect, useRef, useState } from 'react';
import { Image, type ImageProps } from 'expo-image';
import type { RemoteImageSource } from '../domain/entityReferenceImageSources';

type ImageStage = 'exhausted' | 'protected' | 'public' | 'refreshed' | 'refreshing';

interface ImageAttemptState {
  identity: string;
  protectedUri: string | null;
  publicUri: string | null;
  refreshedSource: RemoteImageSource | null;
  stage: ImageStage;
}

interface ResilientAuthenticatedImageProps {
  accessibilityLabel: string;
  identity: string;
  onExhausted(): void;
  protectedSource: RemoteImageSource | null;
  publicSource: RemoteImageSource | null;
  refreshProtectedSource(): Promise<RemoteImageSource>;
  style: ImageProps['style'];
}

export function ResilientAuthenticatedImage({
  accessibilityLabel,
  identity,
  onExhausted,
  protectedSource,
  publicSource,
  refreshProtectedSource,
  style,
}: ResilientAuthenticatedImageProps): React.JSX.Element | null {
  const identityRef = useRef(identity);
  const refreshOperationRef = useRef<{
    identity: string;
    operation: Promise<RemoteImageSource>;
  } | null>(null);
  const [attempt, setAttempt] = useState<ImageAttemptState>(() => initialAttempt(
    identity,
    publicSource,
    protectedSource,
  ));
  const stateMatchesSources = attempt.identity === identity
    && attempt.publicUri === (publicSource?.uri ?? null)
    && attempt.protectedUri === (protectedSource?.uri ?? null);
  const current = stateMatchesSources
    ? attempt
    : initialAttempt(identity, publicSource, protectedSource);

  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  const exhaust = (): void => {
    setAttempt((value) => value.identity === identity
      ? { ...value, stage: 'exhausted' }
      : value);
    onExhausted();
  };

  const onError = (): void => {
    if (current.stage === 'public') {
      if (protectedSource === null) {
        exhaust();
        return;
      }
      setAttempt({ ...current, stage: 'protected' });
      return;
    }
    if (current.stage === 'protected') {
      if (refreshOperationRef.current?.identity === identity) {
        return;
      }
      setAttempt({ ...current, stage: 'refreshing' });
      const operation = refreshProtectedSource();
      refreshOperationRef.current = { identity, operation };
      const settled = operation.then(
        (source) => {
          if (identityRef.current !== identity) {
            return;
          }
          setAttempt({ ...current, refreshedSource: source, stage: 'refreshed' });
        },
        () => {
          if (identityRef.current === identity) {
            exhaust();
          }
        },
      );
      const clearRefreshOperation = (): void => {
        if (refreshOperationRef.current?.operation === operation) {
          refreshOperationRef.current = null;
        }
      };
      void settled.then(clearRefreshOperation, clearRefreshOperation);
      return;
    }
    if (current.stage === 'refreshed') {
      exhaust();
    }
  };

  const source = sourceFor(current, publicSource, protectedSource);
  if (source === null || current.stage === 'exhausted' || current.stage === 'refreshing') {
    return null;
  }

  return (
    <Image
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      cachePolicy="memory"
      contentFit="cover"
      onError={onError}
      recyclingKey={`${identity}:${current.stage}`}
      source={source}
      style={style}
    />
  );
}

function initialAttempt(
  identity: string,
  publicSource: RemoteImageSource | null,
  protectedSource: RemoteImageSource | null,
): ImageAttemptState {
  return {
    identity,
    protectedUri: protectedSource?.uri ?? null,
    publicUri: publicSource?.uri ?? null,
    refreshedSource: null,
    stage: publicSource !== null
      ? 'public'
      : protectedSource !== null
        ? 'protected'
        : 'exhausted',
  };
}

function sourceFor(
  attempt: ImageAttemptState,
  publicSource: RemoteImageSource | null,
  protectedSource: RemoteImageSource | null,
): RemoteImageSource | null {
  if (attempt.stage === 'public') {
    return publicSource;
  }
  if (attempt.stage === 'protected') {
    return protectedSource;
  }
  if (attempt.stage === 'refreshed') {
    return attempt.refreshedSource;
  }
  return null;
}
