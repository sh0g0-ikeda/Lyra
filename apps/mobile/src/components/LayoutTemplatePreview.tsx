import { StyleSheet, Text, View } from 'react-native';
import Svg, { Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { colors, spacing, textStyles } from '@/constants/theme';

export interface FramePreviewDefinition {
  vertices: { x: number; y: number }[];
}

const PAGE_WIDTH = 100;
const PAGE_HEIGHT = 140;

const frameCenter = (
  vertices: FramePreviewDefinition['vertices']
): { x: number; y: number } => {
  if (vertices.length === 0) {
    return { x: 0.5, y: 0.5 };
  }

  const total = vertices.reduce(
    (sum, vertex) => ({
      x: sum.x + vertex.x,
      y: sum.y + vertex.y
    }),
    { x: 0, y: 0 }
  );

  return {
    x: total.x / vertices.length,
    y: total.y / vertices.length
  };
};

interface LayoutTemplatePreviewProps {
  frames: FramePreviewDefinition[];
  title?: string;
}

export function LayoutTemplatePreview({
  frames,
  title
}: LayoutTemplatePreviewProps): React.JSX.Element | null {
  if (frames.length === 0) {
    return null;
  }

  return (
    <View style={styles.preview}>
      {title === undefined ? null : <Text style={styles.title}>{title}</Text>}
      <View style={styles.paper}>
        <Svg height="100%" viewBox={`0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}`} width="100%">
          <Rect
            fill="#F8F2DE"
            height={PAGE_HEIGHT}
            rx={2}
            stroke="#1A1A1A"
            strokeWidth={0.8}
            width={PAGE_WIDTH}
            x={0}
            y={0}
          />
          {frames.map((frame, index) => (
            <Polygon
              fill={index % 2 === 0 ? '#FFF8DF' : '#F0E5BF'}
              key={`frame-${index}`}
              points={frame.vertices
                .map((vertex) => `${vertex.x * PAGE_WIDTH},${vertex.y * PAGE_HEIGHT}`)
                .join(' ')}
              stroke="#1A1A1A"
              strokeLinejoin="round"
              strokeWidth={1.2}
            />
          ))}
          {frames.map((frame, index) => {
            const center = frameCenter(frame.vertices);
            return (
              <SvgText
                fill={colors.primary}
                fontSize={7}
                fontWeight="700"
                key={`label-${index}`}
                textAnchor="middle"
                x={center.x * PAGE_WIDTH}
                y={center.y * PAGE_HEIGHT + 2.5}
              >
                {String(index + 1)}
              </SvgText>
            );
          })}
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  paper: {
    alignSelf: 'center',
    aspectRatio: PAGE_WIDTH / PAGE_HEIGHT,
    backgroundColor: '#F8F2DE',
    borderRadius: 8,
    overflow: 'hidden',
    width: '72%'
  },
  preview: {
    gap: spacing.sm,
    paddingVertical: spacing.xs
  },
  title: {
    ...textStyles.caption,
    color: colors.ink,
    fontWeight: '700'
  }
});
