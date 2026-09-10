import React, { useEffect, useState } from 'react';
import { Modal, Pressable, View, StyleSheet, useWindowDimensions, KeyboardAvoidingView, Platform, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { Text } from './Text';
import { IconButton } from './Button';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  /** fraction of screen height (0..1) the sheet may take */
  maxHeight?: number;
  /** render children without padding */
  flush?: boolean;
  headerRight?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** scrollable content should set this false and manage its own scroll */
  keyboard?: boolean;
}

/**
 * Bottom sheet built on RN Modal (web-compatible) with reanimated slide/fade.
 */
export function Sheet({ visible, onClose, title, subtitle, children, maxHeight = 0.88, flush, headerRight, style, keyboard = true }: SheetProps): React.ReactElement | null {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      progress.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const backdrop = useAnimatedStyle(() => ({ opacity: progress.value * 0.6 }));
  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * 80 }] }));

  if (!mounted) return null;
  const wide = width > 700;
  const content = (
    <Animated.View
      style={[
        panel,
        {
          backgroundColor: t.colors.surface,
          borderTopLeftRadius: t.radii.xl,
          borderTopRightRadius: t.radii.xl,
          borderWidth: 1,
          borderColor: t.colors.border,
          maxHeight: height * maxHeight,
          paddingBottom: insets.bottom + 8,
          width: wide ? 560 : '100%',
          alignSelf: 'center',
        },
        t.shadows.soft,
        style,
      ]}
    >
      <View style={{ alignItems: 'center', paddingTop: 8 }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: t.colors.borderStrong }} />
      </View>
      {title || headerRight ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.spacing.lg, paddingTop: 10, paddingBottom: 6, gap: 12 }}>
          <View style={{ flex: 1 }}>
            {title ? <Text variant="title">{title}</Text> : null}
            {subtitle ? (
              <Text variant="caption" muted>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {headerRight}
          <IconButton icon="close" size={34} onPress={onClose} accessibilityLabel="Close" />
        </View>
      ) : null}
      <View style={{ paddingHorizontal: flush ? 0 : t.spacing.lg, paddingTop: flush ? 0 : 6, flexShrink: 1 }}>{children}</View>
    </Animated.View>
  );
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, backdrop, { backgroundColor: '#000' }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" accessibilityRole="button" />
        <View pointerEvents="box-none" style={{ flex: 1, justifyContent: 'flex-end' }}>
          {keyboard ? (
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none">
              {content}
            </KeyboardAvoidingView>
          ) : (
            content
          )}
        </View>
      </View>
    </Modal>
  );
}

/** Centered modal dialog primitive. */
export function Dialog({ visible, onClose, title, children, width = 420, dismissable = true }: { visible: boolean; onClose: () => void; title?: string; children?: React.ReactNode; width?: number; dismissable?: boolean }): React.ReactElement | null {
  const t = useTheme();
  const { width: w } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      progress.value = withTiming(0, { duration: 160 }, (f) => {
        if (f) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const backdrop = useAnimatedStyle(() => ({ opacity: progress.value * 0.7 }));
  const panel = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ scale: 0.96 + progress.value * 0.04 }] }));
  if (!mounted) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={dismissable ? onClose : undefined} statusBarTranslucent>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 20 }]}>
        <Animated.View style={[StyleSheet.absoluteFill, backdrop, { backgroundColor: '#000' }]} />
        {dismissable ? <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" /> : null}
        <Animated.View style={[panel, { width: Math.min(width, w - 32), backgroundColor: t.colors.surface, borderRadius: t.radii.xl, borderWidth: 1, borderColor: t.colors.border, padding: t.spacing.xl }, t.shadows.soft]}>
          {title ? (
            <Text variant="title" style={{ marginBottom: 10 }}>
              {title}
            </Text>
          ) : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

export default Sheet;
