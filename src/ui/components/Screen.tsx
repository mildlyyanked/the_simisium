import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle, ScrollView, type ScrollViewProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

export interface ScreenProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** scrollable content */
  scroll?: boolean;
  scrollProps?: ScrollViewProps;
  /** apply safe-area padding on these edges (default: top) */
  edges?: ('top' | 'bottom')[];
  padded?: boolean;
  /** extra bottom padding, e.g. for a floating tab bar */
  bottomInset?: number;
  gradient?: boolean;
}

/**
 * Root container for a screen: dark gradient backdrop + safe-area handling.
 */
export function Screen({ children, style, scroll, scrollProps, edges = ['top'], padded, bottomInset = 0, gradient = true }: ScreenProps): React.ReactElement {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const padTop = edges.includes('top') ? insets.top : 0;
  const padBottom = (edges.includes('bottom') ? insets.bottom : 0) + bottomInset;
  const inner = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      {...scrollProps}
      contentContainerStyle={[{ paddingTop: padTop, paddingBottom: padBottom + t.spacing.xl, paddingHorizontal: padded ? t.spacing.lg : 0 }, scrollProps?.contentContainerStyle]}
      style={[{ flex: 1 }, scrollProps?.style]}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, paddingTop: padTop, paddingBottom: padBottom, paddingHorizontal: padded ? t.spacing.lg : 0 }, style]}>{children}</View>
  );
  return (
    <View style={[styles.root, { backgroundColor: t.colors.background }]}>
      {gradient ? <LinearGradient colors={['#121a2e', '#0B0E14', '#0B0E14']} locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} /> : null}
      {gradient ? <View pointerEvents="none" style={[styles.glow, { backgroundColor: t.colors.glow }]} /> : null}
      {inner}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  glow: { position: 'absolute', top: -160, right: -120, width: 320, height: 320, borderRadius: 160, opacity: 0.35, transform: [{ scaleX: 1.4 }] },
});

export default Screen;
