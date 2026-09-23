import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Shimmer } from './Skeleton';

export function BusyOverlay({ visible, label, preview }: { visible: boolean; label?: string; preview?: { who?: string; text: string } | null }): React.ReactElement | null {
  const t = useTheme();
  if (!visible) return null;
  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} pointerEvents="auto" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(11,14,20,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 50, paddingHorizontal: 24 }]} accessibilityLiveRegion="polite">
      <View style={[{ backgroundColor: t.colors.surfaceRaised, borderColor: t.colors.border, borderWidth: 1, borderRadius: t.radii.lg, paddingVertical: 16, paddingHorizontal: 22, gap: 10, overflow: 'hidden', maxWidth: 520, width: '100%' }, t.shadows.soft]}>
        <Shimmer />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <ActivityIndicator color={t.colors.accent} />
          <Text variant="prose" style={{ fontStyle: 'italic', flexShrink: 1 }}>
            {preview?.text ? (preview.who ? `${preview.who} is answering…` : 'Something is happening…') : label || 'The world is thinking…'}
          </Text>
        </View>
        {preview?.text ? (
          <View style={{ borderLeftWidth: 2, borderLeftColor: t.colors.accent, paddingLeft: 12 }}>
            <Text variant="prose" numberOfLines={6}>
              {preview.text}
            </Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

export default BusyOverlay;
