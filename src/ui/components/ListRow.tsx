import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon } from '../icons';
import { haptic } from '../haptics';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: string;
  iconColor?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  value?: string;
  valueColor?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  chevron?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  last?: boolean;
  accessibilityLabel?: string;
  children?: React.ReactNode;
}

export function ListRow({ title, subtitle, icon, iconColor, left, right, value, valueColor, onPress, onLongPress, chevron, disabled, style, last, accessibilityLabel, children }: ListRowProps): React.ReactElement {
  const t = useTheme();
  const body = (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.colors.border, opacity: disabled ? 0.5 : 1 }, style]}>
      {left ??
        (icon ? (
          <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: `${iconColor ?? t.colors.accent}1F`, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={18} color={iconColor ?? t.colors.accent} />
          </View>
        ) : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" weight="500" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" muted numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {children}
      </View>
      {value ? (
        <Text variant="bodyStrong" color={valueColor} style={{ textAlign: 'right' }}>
          {value}
        </Text>
      ) : null}
      {right}
      {chevron ? <Icon name="chevron-right" size={18} color={t.colors.textFaint} /> : null}
    </View>
  );
  if (!onPress && !onLongPress) return body;
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
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  );
}

export default ListRow;
