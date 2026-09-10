import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon } from '../icons';
import { haptic } from '../haptics';

export interface ChipProps {
  label: string;
  icon?: string;
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  color?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Chip({ label, icon, selected, onPress, onLongPress, color, disabled, size = 'md', style, accessibilityLabel }: ChipProps): React.ReactElement {
  const t = useTheme();
  const c = color ?? t.colors.accent;
  const bg = selected ? (color ? `${c}26` : t.colors.accentSoft) : t.colors.surfaceRaised;
  const fg = selected ? c : t.colors.text;
  const border = selected ? c : t.colors.border;
  const inner = (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: size === 'sm' ? 10 : 12,
          height: size === 'sm' ? 28 : 34,
          borderRadius: t.radii.pill,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: border,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 13 : 15} color={fg} /> : null}
      <Text variant={size === 'sm' ? 'caption' : 'body'} color={fg} weight={selected ? '600' : '500'} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
  if (!onPress && !onLongPress) return inner;
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        haptic.select();
        onPress?.();
      }}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      {inner}
    </Pressable>
  );
}

export function Pill({ label, color, icon, style, size = 'sm' }: { label: string; color?: string; icon?: string; style?: StyleProp<ViewStyle>; size?: 'xs' | 'sm' }): React.ReactElement {
  const t = useTheme();
  const c = color ?? t.colors.textMuted;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: size === 'xs' ? 6 : 8, paddingVertical: size === 'xs' ? 1 : 3, borderRadius: t.radii.pill, backgroundColor: `${c}22` }, style]}>
      {icon ? <Icon name={icon} size={size === 'xs' ? 10 : 12} color={c} /> : null}
      <Text variant="caption" color={c} weight="600" style={size === 'xs' ? { fontSize: 10.5, lineHeight: 13 } : undefined}>
        {label}
      </Text>
    </View>
  );
}

export function ChipRow({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }): React.ReactElement {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, style]}>{children}</View>;
}

export default Chip;
