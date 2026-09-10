import React, { useEffect, useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon } from '../icons';
import { haptic } from '../haptics';

export interface Segment<T extends string> {
  id: T;
  label: string;
  icon?: string;
}

export function SegmentedControl<T extends string>({ segments, value, onChange, style, size = 'md' }: { segments: Segment<T>[]; value: T; onChange: (v: T) => void; style?: StyleProp<ViewStyle>; size?: 'sm' | 'md' }): React.ReactElement {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const idx = Math.max(0, segments.findIndex((s) => s.id === value));
  const x = useSharedValue(0);
  const segW = segments.length ? width / segments.length : 0;
  useEffect(() => {
    x.value = withSpring(idx * segW, { damping: 20, stiffness: 220 });
  }, [idx, segW, x]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const h = size === 'sm' ? 32 : 40;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width - 6)} style={[{ flexDirection: 'row', backgroundColor: t.colors.surface, borderRadius: t.radii.md, borderWidth: 1, borderColor: t.colors.border, padding: 3, height: h + 6 }, style]} accessibilityRole="tablist">
      {segW > 0 ? <Animated.View style={[a, { position: 'absolute', top: 3, left: 3, width: segW, height: h, borderRadius: t.radii.sm, backgroundColor: t.colors.surfaceOverlay, borderWidth: 1, borderColor: t.colors.borderStrong }]} /> : null}
      {segments.map((s) => {
        const active = s.id === value;
        return (
          <Pressable
            key={s.id}
            onPress={() => {
              haptic.select();
              onChange(s.id);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={{ flex: 1, height: h, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
          >
            {s.icon ? <Icon name={s.icon} size={size === 'sm' ? 13 : 15} color={active ? t.colors.accent : t.colors.textMuted} /> : null}
            <Text variant={size === 'sm' ? 'caption' : 'body'} weight="600" color={active ? t.colors.text : t.colors.textMuted} numberOfLines={1}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default SegmentedControl;
