import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { mobileContentMaxWidth } from '@/constants/theme';

interface ResponsiveContentFrameProps extends PropsWithChildren {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ResponsiveContentFrame({
  children,
  style,
  testID
}: ResponsiveContentFrameProps): React.JSX.Element {
  return (
    <View style={[styles.frame, style]} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'center',
    maxWidth: mobileContentMaxWidth,
    width: '100%'
  }
});
