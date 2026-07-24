import { Component, type PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, textStyles } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';
import { captureHandledException } from '@/lib/operationalEvents';

interface ErrorBoundaryProps extends PropsWithChildren {
  language?: UiLanguage;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false
  };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return {
      hasError: true
    };
  }

  public componentDidCatch(error: unknown): void {
    captureHandledException(error);
    console.error('Lyra Mobile render error boundary triggered');
  }

  public render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Lyra Mobile</Text>
          <Text style={styles.message}>
            {t(this.props.language ?? 'ja', 'shared.errorBoundary.startup')}
          </Text>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.canvas,
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.lg
  },
  message: {
    ...textStyles.body
  },
  title: {
    ...textStyles.title
  }
});
