import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGame, type ToastItem } from '@/store/gameStore';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon } from '../icons';

function ToastRow({ item }: { item: ToastItem }): React.ReactElement {
  const t = useTheme();
  const dismiss = useGame((s) => s.dismissToast);
  useEffect(() => {
    const ttl = item.kind === 'error' ? 6000 : 4000;
    const id = setTimeout(() => dismiss(item.id), ttl);
    return () => clearTimeout(id);
  }, [item.id, item.kind, dismiss]);
  const color = item.kind === 'error' ? t.colors.danger : item.kind === 'warning' ? t.colors.warning : item.kind === 'success' ? t.colors.success : t.colors.accent2;
  const icon = item.kind === 'error' ? 'alert-circle' : item.kind === 'warning' ? 'alert' : item.kind === 'success' ? 'check-circle' : 'information-outline';
  return (
    <Animated.View entering={FadeInUp.duration(220)} exiting={FadeOutUp.duration(180)}>
      <Pressable onPress={() => dismiss(item.id)} accessibilityRole="alert" accessibilityLabel={item.text}>
        <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.colors.surfaceRaised, borderColor: color, borderWidth: 1, borderLeftWidth: 4, borderRadius: t.radii.md, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8 }, t.shadows.soft]}>
          <Icon name={icon} size={18} color={color} />
          <Text variant="body" style={{ flex: 1 }} numberOfLines={3}>
            {item.text}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Global toast host — mount once in the root layout. */
export function ToastHost(): React.ReactElement | null {
  const errors = useGame((s) => s.errors);
  const insets = useSafeAreaInsets();
  if (!errors.length) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, zIndex: 1000, alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: 520 }}>
        {errors.map((e) => (
          <ToastRow key={e.id} item={e} />
        ))}
      </View>
    </View>
  );
}

export default ToastHost;
