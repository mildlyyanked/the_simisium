import React, { useEffect } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { useTheme } from '../theme';

export function Skeleton({ width = '100%', height = 14, radius = 8, style }: { width?: number | `${number}%`; height?: number; radius?: number; style?: StyleProp<ViewStyle> }): React.ReactElement {
  const t = useTheme();
  const o = useSharedValue(0.35);
  useEffect(() => {
    o.value = withRepeat(withTiming(0.8, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: t.colors.surfaceOverlay }, a, style]} />;
}

/** Subtle moving highlight, used by the busy overlay. */
export function Shimmer({ style, color = 'rgba(245,184,74,0.18)' }: { style?: StyleProp<ViewStyle>; color?: string }): React.ReactElement {
  const x = useSharedValue(-1);
  useEffect(() => {
    x.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.cubic) }), -1, false);
  }, [x]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 200 }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, width: 160, backgroundColor: color, opacity: 0.6, transform: [{ skewX: '-18deg' }] }, a, style]} />;
}

export default Skeleton;
