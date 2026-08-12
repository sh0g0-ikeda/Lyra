import type { ViewStyle, TextStyle } from 'react-native';

export const mobileContentMaxWidth = 760;

export const colors = {
  canvas: '#0A0A0A',
  canvasAlt: '#141414',
  surface: 'rgba(26, 26, 26, 0.92)',
  surfaceAlt: '#101010',
  surfaceRaised: '#151515',
  field: '#1A1D22',
  fieldFocus: '#20252C',
  controlSurface: '#252A31',
  controlSurfaceFocus: '#2D343D',
  ink: '#E0E0E0',
  inkStrong: '#F4F4F4',
  muted: '#8A8A8A',
  mutedSoft: '#6F6F6F',
  border: 'rgba(229, 199, 107, 0.12)',
  borderStrong: 'rgba(229, 199, 107, 0.34)',
  controlBorder: 'rgba(229, 199, 107, 0.48)',
  primary: '#E5C76B',
  primaryPressed: '#DDB74C',
  primaryText: '#17120A',
  secondary: '#77AEFF',
  secondarySurface: 'rgba(34, 49, 77, 0.88)',
  accent: '#A68B3C',
  warning: '#FFC107',
  warningSurface: 'rgba(255, 193, 7, 0.10)',
  danger: '#F44336',
  dangerSurface: 'rgba(244, 67, 54, 0.12)',
  success: '#4CAF50',
  successSurface: 'rgba(76, 175, 80, 0.12)',
  info: '#00BCD4',
  infoSurface: 'rgba(0, 188, 212, 0.10)',
  disabled: '#7D8691'
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32
} as const;

export const radius = {
  sm: 6,
  md: 8
} as const;

export const shadow: ViewStyle = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.28,
  shadowRadius: 22,
  elevation: 4
};

export const textStyles = {
  title: {
    color: colors.inkStrong,
    fontSize: 19,
    fontWeight: '700' as const,
    lineHeight: 24,
    letterSpacing: 0
  },
  sectionTitle: {
    color: colors.inkStrong,
    fontSize: 15,
    fontWeight: '700' as const,
    lineHeight: 21,
    letterSpacing: 0
  },
  body: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 21,
    letterSpacing: 0
  },
  caption: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0
  }
} satisfies Record<string, TextStyle>;
