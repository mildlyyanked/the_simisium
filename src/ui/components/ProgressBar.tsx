import React, { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { useTheme } from '../theme';

export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  color?: string;
  track?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
  animated?: boolean;
}

export function ProgressBar({ value, color, track, height = 6, style, animated = true }: ProgressBarProps): React.ReactElement {
  const t = useTheme();
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const w = useSharedValue(animated ? 0 : v);
  useEffect(() => {
    w.value = animated ? withTiming(v, { duration: 500, easing: Easing.out(Easing.cubic) }) : v;
  }, [v, animated, w]);
  const aStyle = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={[{ height, borderRadius: height / 2, backgroundColor: track ?? t.colors.surfaceOverlay, overflow: 'hidden' }, style]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}>
      <Animated.View style={[aStyle, { height, borderRadius: height / 2, backgroundColor: color ?? t.colors.accent }]} />
    </View>
  );
}

export default ProgressBar;
