import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Maximize2 } from 'lucide-react-native';
import type { ImageProps } from 'expo-image';

import { ResilientImage } from '@/components/ResilientImage';
import { colors, spacing } from '@/constants/theme';
import {
  imageSourceListIdentity,
  type RemoteImageSource
} from '@/domain/imageSourceCandidates';

interface PageImageViewerProps {
  expandLabel: string;
  imageStyle?: ImageProps['style'];
  onExhausted?: () => void;
  onExpand: (source: RemoteImageSource) => void;
  sources: readonly RemoteImageSource[];
}

export function PageImageViewer({
  expandLabel,
  imageStyle,
  onExhausted,
  onExpand,
  sources
}: PageImageViewerProps): React.JSX.Element {
  const sourceIdentity = imageSourceListIdentity(sources);
  const [resolvedSource, setResolvedSource] = useState<{
    sourceIdentity: string;
    source: RemoteImageSource;
  } | null>(null);
  const activeSource =
    resolvedSource?.sourceIdentity === sourceIdentity
      ? resolvedSource.source
      : sources[0] ?? null;
  const handleSourceChange = useCallback((source: RemoteImageSource): void => {
    setResolvedSource((current) => {
      if (
        current?.sourceIdentity === sourceIdentity &&
        imageSourceListIdentity([current.source]) ===
          imageSourceListIdentity([source])
      ) {
        return current;
      }
      return {
        sourceIdentity,
        source
      };
    });
  }, [sourceIdentity]);

  return (
    <View style={styles.container}>
      <ResilientImage
        cachePolicy="memory-disk"
        contentFit="contain"
        onExhausted={onExhausted}
        onSourceChange={handleSourceChange}
        priority="high"
        sources={sources}
        style={imageStyle}
        transition={150}
      />
      <Pressable
        accessibilityLabel={expandLabel}
        accessibilityRole="button"
        disabled={activeSource === null}
        hitSlop={spacing.sm}
        onPress={() => {
          if (activeSource !== null) {
            onExpand(activeSource);
          }
        }}
        style={styles.expandButton}
      >
        <Maximize2 color={colors.primaryText} size={20} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative'
  },
  expandButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(8, 8, 8, 0.84)',
    borderColor: colors.primary,
    borderRadius: 6,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    width: 44
  }
});
