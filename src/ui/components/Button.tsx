import React, { useCallback } from 'react';
import { Pressable, ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon } from '../icons';
import { haptic } from '../haptics';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';

export interface ButtonProps {
  title?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  iconRight?: string;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  hapticStyle?: 'light' | 'medium' | 'select' | 'none';
  accessibilityLabel?: string;
  children?: React.ReactNode;
}

export function Button({ title, onPress, onLongPress, variant = 'primary', size = 'md', icon, iconRight, disabled, loading, full, style, hapticStyle = 'light', accessibilityLabel, children }: ButtonProps): React.ReactElement {
  const t = useTheme();
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const onIn = useCallback(() => {
    scale.value = withSpring(0.96, { damping: 18, stiffness: 300 });
  }, [scale]);
  const onOut = useCallback(() => {
    scale.value = withSpring(1, { damping: 18, stiffness: 300 });
  }, [scale]);
  const handlePress = useCallback(() => {
    if (disabled || loading) return;
    if (hapticStyle === 'light') haptic.light();
    else if (hapticStyle === 'medium') haptic.medium();
    else if (hapticStyle === 'select') haptic.select();
    onPress?.();
  }, [disabled, loading, hapticStyle, onPress]);

  const palette = (() => {
    switch (variant) {
      case 'primary':
        return { bg: t.colors.accent, fg: t.colors.accentText, border: 'transparent' };
      case 'secondary':
        return { bg: t.colors.surfaceRaised, fg: t.colors.text, border: t.colors.border };
      case 'outline':
        return { bg: 'transparent', fg: t.colors.text, border: t.colors.borderStrong };
      case 'danger':
        return { bg: t.colors.dangerSoft, fg: t.colors.danger, border: 'transparent' };
      default:
        return { bg: 'transparent', fg: t.colors.accent, border: 'transparent' };
    }
  })();
  const dims = size === 'sm' ? { h: 34, px: 12, fs: 13, icon: 15 } : size === 'lg' ? { h: 54, px: 22, fs: 16, icon: 20 } : { h: 46, px: 18, fs: 15, icon: 18 };

  return (
    <Animated.View style={[aStyle, full ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start' }, style]}>
      <Pressable
        onPress={handlePress}
        onLongPress={onLongPress}
        onPressIn={onIn}
        onPressOut={onOut}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityState={{ disabled: !!disabled, busy: !!loading }}
        style={{
          height: dims.h,
          paddingHorizontal: dims.px,
          borderRadius: t.radii.md,
          backgroundColor: palette.bg,
          borderWidth: 1,
          borderColor: palette.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: disabled ? 0.45 : 1,
        }}
      >
        {loading ? <ActivityIndicator size="small" color={palette.fg} /> : icon ? <Icon name={icon} size={dims.icon} color={palette.fg} /> : null}
        {title ? (
          <Text variant="bodyStrong" color={palette.fg} style={{ fontSize: dims.fs, lineHeight: dims.fs * 1.3 }} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {children}
        {iconRight ? <Icon name={iconRight} size={dims.icon} color={palette.fg} /> : null}
      </Pressable>
    </Animated.View>
  );
}

export function IconButton({ icon, onPress, size = 40, color, bg, disabled, accessibilityLabel, style, active }: { icon: string; onPress?: () => void; size?: number; color?: string; bg?: string; disabled?: boolean; accessibilityLabel: string; style?: StyleProp<ViewStyle>; active?: boolean }): React.ReactElement {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        haptic.select();
        onPress?.();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? t.colors.accentSoft : bg ?? t.colors.surfaceRaised,
          borderWidth: 1,
          borderColor: active ? t.colors.accent : t.colors.border,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} color={active ? t.colors.accent : color ?? t.colors.text} />
    </Pressable>
  );
}

export function ButtonRow({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }): React.ReactElement {
  return <View style={[{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }, style]}>{children}</View>;
}

export default Button;
