import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<
  PropsWithChildren,
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  public componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Provider details are intentionally not rendered or logged here.
  }

  public render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <View
          accessibilityRole="alert"
          style={{
            backgroundColor: colors.canvas,
            flex: 1,
            justifyContent: 'center',
            padding: spacing.md,
          }}
        >
          <Text style={{ color: colors.danger, fontSize: 16 }}>
            画面を表示できませんでした。アプリを再起動してください。
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}
