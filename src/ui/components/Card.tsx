import React from 'react';
import { View, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon } from '../icons';

export interface CardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  raised?: boolean;
  padded?: boolean | number;
  onPress?: () => void;
  onLongPress?: () => void;
  title?: string;
  subtitle?: string;
  icon?: string;
  right?: React.ReactNode;
  accent?: string;
  accessibilityLabel?: string;
}

export function Card({ children, style, raised, padded = true, onPress, onLongPress, title, subtitle, icon, right, accent, accessibilityLabel }: CardProps): React.ReactElement {
  const t = useTheme();
  const pad = typeof padded === 'number' ? padded : padded ? t.spacing.lg : 0;
  const body = (
    <View
      style={[
        {
          backgroundColor: raised ? t.colors.surfaceRaised : t.colors.surface,
          borderRadius: t.radii.lg,
          borderWidth: 1,
          borderColor: t.colors.border,
          padding: pad,
          overflow: 'hidden',
        },
        t.shadows.card,
        style,
      ]}
    >
      {accent ? <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: accent }} /> : null}
      {title || icon || right ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: children ? t.spacing.md : 0, gap: t.spacing.sm }}>
          {icon ? (
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={icon} size={18} color={t.colors.accent} />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            {title ? <Text variant="heading">{title}</Text> : null}
            {subtitle ? (
              <Text variant="caption" muted>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
  if (onPress || onLongPress) {
    return (
      <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
        {body}
      </Pressable>
    );
  }
  return body;
}

export function SectionHeader({ title, action, onAction, style }: { title: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }): React.ReactElement {
  const t = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: t.spacing.lg, marginBottom: t.spacing.sm }, style]}>
      <Text variant="label" muted>
        {title}
      </Text>
      {action && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8}>
          <Text variant="caption" accent>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default Card;
