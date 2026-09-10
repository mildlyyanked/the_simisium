import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon } from '../icons';

export function Stat({ label, value, icon, color, sub, style, size = 'md' }: { label: string; value: string | number; icon?: string; color?: string; sub?: string; style?: StyleProp<ViewStyle>; size?: 'sm' | 'md' | 'lg' }): React.ReactElement {
  const t = useTheme();
  return (
    <View style={[{ backgroundColor: t.colors.surfaceRaised, borderRadius: t.radii.md, borderWidth: 1, borderColor: t.colors.border, padding: size === 'sm' ? 10 : 14, minWidth: 96, flexGrow: 1, flexBasis: 0 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {icon ? <Icon name={icon} size={13} color={color ?? t.colors.textMuted} /> : null}
        <Text variant="label" muted numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text variant={size === 'lg' ? 'title' : 'heading'} color={color} style={size === 'sm' ? { fontSize: 15 } : undefined} numberOfLines={1}>
        {value}
      </Text>
      {sub ? (
        <Text variant="caption" faint numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

export function StatRow({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }): React.ReactElement {
  return <View style={[{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function KeyValue({ label, value, color, last }: { label: string; value: string; color?: string; last?: boolean }): React.ReactElement {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.colors.border, gap: 12 }}>
      <Text variant="body" muted style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <Text variant="bodyStrong" color={color} style={{ textAlign: 'right', flexShrink: 1 }}>
        {value}
      </Text>
    </View>
  );
}

export default Stat;
