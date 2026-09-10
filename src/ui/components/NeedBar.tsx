import React, { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { NeedId, Needs } from '@engine/core/types';
import { NEED_META, useTheme } from '../theme';
import { Text } from './Text';
import { Icon } from '../icons';

export function needColor(value: number, base: string, t = useTheme()): string {
  if (value < 15) return t.colors.danger;
  if (value < 30) return t.colors.warning;
  return base;
}

export interface NeedBarProps {
  need: NeedId;
  value: number;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  showLabel?: boolean;
}

export function NeedBar({ need, value, compact, style, showLabel = true }: NeedBarProps): React.ReactElement {
  const t = useTheme();
  const v = Math.max(0, Math.min(100, value));
  const base = t.colors.needs[need];
  const color = v < 15 ? t.colors.danger : v < 30 ? t.colors.warning : base;
  const w = useSharedValue(v);
  const pulse = useSharedValue(1);
  useEffect(() => {
    w.value = withTiming(v, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [v, w]);
  useEffect(() => {
    if (v < 25) {
      pulse.value = withRepeat(withSequence(withTiming(0.45, { duration: 650 }), withTiming(1, { duration: 650 })), -1, true);
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [v < 25, pulse, v]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value}%`, opacity: pulse.value }));
  const meta = NEED_META[need];
  const h = compact ? 5 : 7;
  return (
    <View style={[{ gap: compact ? 3 : 5 }, style]} accessible accessibilityLabel={`${meta.label} ${Math.round(v)} percent`}>
      {showLabel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Icon name={meta.icon} size={compact ? 11 : 13} color={color} />
          <Text variant="caption" muted style={{ flex: 1, fontSize: compact ? 11 : 12.5 }} numberOfLines={1}>
            {meta.label}
          </Text>
          <Text variant="caption" color={color} weight="600" style={{ fontSize: compact ? 11 : 12, fontVariant: ['tabular-nums'] }}>
            {Math.round(v)}
          </Text>
        </View>
      ) : null}
      <View style={{ height: h, borderRadius: h / 2, backgroundColor: t.colors.surfaceOverlay, overflow: 'hidden' }}>
        <Animated.View style={[fill, { height: h, borderRadius: h / 2, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export function NeedsGrid({ needs, compact, columns = 2, style }: { needs: Needs; compact?: boolean; columns?: 2 | 4; style?: StyleProp<ViewStyle> }): React.ReactElement {
  const order: NeedId[] = ['hunger', 'energy', 'thirst', 'bladder', 'hygiene', 'social', 'fun', 'comfort'];
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: compact ? 8 : 12 }, style]}>
      {order.map((n) => (
        <NeedBar key={n} need={n} value={needs[n]} compact={compact} style={{ width: columns === 4 ? '22%' : '46%', flexGrow: 1 }} />
      ))}
    </View>
  );
}

/** Tiny 8-dot summary used in headers: colored dots dim when a need is low. */
export function NeedsDots({ needs, size = 6 }: { needs: Needs; size?: number }): React.ReactElement {
  const t = useTheme();
  const order: NeedId[] = ['hunger', 'thirst', 'energy', 'bladder', 'hygiene', 'social', 'fun', 'comfort'];
  return (
    <View style={{ flexDirection: 'row', gap: 3 }} accessible accessibilityLabel="Needs summary">
      {order.map((n) => {
        const v = needs[n];
        const c = v < 15 ? t.colors.danger : v < 30 ? t.colors.warning : t.colors.needs[n];
        return <View key={n} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c, opacity: 0.35 + 0.65 * (v / 100) }} />;
      })}
    </View>
  );
}

export function lowestNeed(needs: Needs): { need: NeedId; value: number } {
  let best: NeedId = 'hunger';
  for (const k of Object.keys(needs) as NeedId[]) if (needs[k] < needs[best]) best = k;
  return { need: best, value: needs[best] };
}

export default NeedBar;
