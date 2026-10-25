import { useEffect, useRef, useState } from 'react';
import {
  Image,
  type ImageProps
} from 'expo-image';

import {
  imageSourceListIdentity,
  type RemoteImageSource
} from '@/domain/imageSourceCandidates';

interface ResilientImageProps extends Omit<ImageProps, 'onError' | 'source'> {
  sources: readonly RemoteImageSource[];
  onExhausted?: () => void;
  onSourceChange?: (source: RemoteImageSource) => void;
}

export function ResilientImage({
  sources,
  onExhausted,
  onSourceChange,
  ...imageProps
}: ResilientImageProps): React.JSX.Element | null {
  const sourceIdentity = imageSourceListIdentity(sources);
  const [attempt, setAttempt] = useState<{
    exhausted: boolean;
    sourceIdentity: string;
    sourceIndex: number;
  } | null>(null);
  const exhaustedSourceIdentityRef = useRef<string | null>(null);
  const sourceIndex =
    attempt?.sourceIdentity === sourceIdentity ? attempt.sourceIndex : 0;
  const source = sources[sourceIndex] ?? null;

  useEffect(() => {
    exhaustedSourceIdentityRef.current = null;
  }, [sourceIdentity]);

  useEffect(() => {
    if (source !== null) {
      onSourceChange?.(source);
    }
  }, [onSourceChange, source]);

  if (source === null) {
    return null;
  }

  return (
    <Image
      {...imageProps}
      onError={() => {
        if (exhaustedSourceIdentityRef.current === sourceIdentity) {
          return;
        }
        if (sourceIndex + 1 < sources.length) {
          setAttempt({
            exhausted: false,
            sourceIdentity,
            sourceIndex: sourceIndex + 1
          });
          return;
        }
        exhaustedSourceIdentityRef.current = sourceIdentity;
        setAttempt({
          exhausted: true,
          sourceIdentity,
          sourceIndex
        });
        onExhausted?.();
      }}
      recyclingKey={source.cacheKey ?? imageProps.recyclingKey}
      source={source}
    />
  );
}
