import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Shimmer } from './Skeleton';

export function BusyOverlay({ visible, label }: { visible: boolean; label?: string }): React.ReactElement | null {
  const t = useTheme();
  if (!visible) return null;
  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} pointerEvents="auto" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(11,14,20,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 50 }]} accessibilityLiveRegion="polite">
      <View style={[{ backgroundColor: t.colors.surfaceRaised, borderColor: t.colors.border, borderWidth: 1, borderRadius: t.radii.lg, paddingVertical: 16, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 12, overflow: 'hidden' }, t.shadows.soft]}>
        <Shimmer />
        <ActivityIndicator color={t.colors.accent} />
        <Text variant="prose" style={{ fontStyle: 'italic' }}>
          {label || 'The world is thinking…'}
        </Text>
      </View>
    </Animated.View>
  );
}

export default BusyOverlay;
