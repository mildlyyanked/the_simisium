import React from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon } from '../icons';
import { haptic } from '../haptics';

export interface PhoneApp {
  id: string;
  label: string;
  icon: string;
  color: string;
  badge?: number;
}

export interface PhoneShellProps {
  apps: PhoneApp[];
  activeApp: string | null;
  onOpenApp: (id: string) => void;
  onHome: () => void;
  clockLabel: string;
  battery: number;
  carrier?: string;
  title?: string;
  children?: React.ReactNode;
  /** unread notification lines shown on the home screen */
  notifications?: { id: string; app: string; title: string; body: string }[];
  wallpaperName?: string;
}

/**
 * An in-game smartphone frame: status bar, app grid home screen, and an app viewport.
 */
export function PhoneShell({ apps, activeApp, onOpenApp, onHome, clockLabel, battery, carrier = 'Simisium', title, children, notifications = [], wallpaperName }: PhoneShellProps): React.ReactElement {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const frameW = Math.min(width - 24, 430);
  const batteryColor = battery < 15 ? t.colors.danger : battery < 30 ? t.colors.warning : t.colors.success;
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <View style={[{ width: frameW, flex: 1, backgroundColor: '#05070C', borderRadius: 36, borderWidth: 6, borderColor: '#1B2230', overflow: 'hidden' }, t.shadows.soft]}>
        {/* status bar */}
        <View style={{ height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 4 }}>
          <Text variant="caption" weight="700" style={{ fontVariant: ['tabular-nums'] }}>
            {clockLabel}
          </Text>
          <View style={{ width: 90, height: 22, borderRadius: 11, backgroundColor: '#000', position: 'absolute', left: frameW / 2 - 12 - 45, top: 4 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Icon name="signal" size={12} color={t.colors.text} />
            <Icon name="wifi" size={12} color={t.colors.text} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <View style={{ width: 22, height: 10, borderRadius: 3, borderWidth: 1, borderColor: t.colors.textMuted, padding: 1 }}>
                <View style={{ width: `${Math.max(4, Math.min(100, battery))}%`, height: '100%', borderRadius: 1.5, backgroundColor: batteryColor }} />
              </View>
            </View>
          </View>
        </View>
        {activeApp ? (
          <Animated.View entering={FadeIn.duration(180)} style={{ flex: 1 }}>
            {/* app header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.colors.border, backgroundColor: '#0A0D14' }}>
              <Pressable
                onPress={() => {
                  haptic.select();
                  onHome();
                }}
                accessibilityRole="button"
                accessibilityLabel="Back to home screen"
                hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
              >
                <Icon name="chevron-left" size={22} color={t.colors.accent2} />
                <Text variant="body" color={t.colors.accent2}>
                  Home
                </Text>
              </Pressable>
              <Text variant="heading" style={{ flex: 1, textAlign: 'center' }} numberOfLines={1}>
                {title ?? apps.find((a) => a.id === activeApp)?.label ?? ''}
              </Text>
              <View style={{ width: 60 }} />
            </View>
            <View style={{ flex: 1 }}>{children}</View>
          </Animated.View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 10, gap: 14 }} showsVerticalScrollIndicator={false}>
            <View style={{ alignItems: 'center', paddingVertical: 10 }}>
              <Text variant="display" style={{ fontSize: 44, lineHeight: 50, fontFamily: t.fonts.sans, fontWeight: '300' }}>
                {clockLabel}
              </Text>
              <Text variant="caption" muted>
                {carrier}
                {wallpaperName ? ` · ${wallpaperName}` : ''}
              </Text>
            </View>
            {notifications.length ? (
              <View style={{ gap: 6 }}>
                {notifications.slice(0, 3).map((n) => {
                  const app = apps.find((a) => a.id === n.app);
                  return (
                    <Pressable key={n.id} onPress={() => onOpenApp(n.app)} accessibilityRole="button" accessibilityLabel={`${n.title}: ${n.body}`} style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, padding: 10, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                      <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: app?.color ?? t.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={app?.icon ?? 'bell'} size={15} color="#fff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text variant="caption" weight="700" numberOfLines={1}>
                          {n.title}
                        </Text>
                        <Text variant="caption" muted numberOfLines={2}>
                          {n.body}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 18 }}>
              {apps.map((app) => (
                <Pressable
                  key={app.id}
                  onPress={() => {
                    haptic.select();
                    onOpenApp(app.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${app.label}${app.badge ? `, ${app.badge} new` : ''}`}
                  style={({ pressed }) => ({ width: '23%', alignItems: 'center', gap: 6, opacity: pressed ? 0.7 : 1 })}
                >
                  <View style={{ width: 58, height: 58, borderRadius: 16, backgroundColor: app.color, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={app.icon} size={28} color="#fff" />
                    {app.badge ? (
                      <View style={{ position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: t.colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderWidth: 2, borderColor: '#05070C' }}>
                        <Text variant="caption" weight="700" style={{ fontSize: 10.5, lineHeight: 12 }}>
                          {app.badge > 99 ? '99+' : app.badge}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text variant="caption" numberOfLines={1} style={{ fontSize: 11.5 }}>
                    {app.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        )}
        {/* home indicator */}
        <View style={{ alignItems: 'center', paddingVertical: 6 }}>
          <Pressable onPress={onHome} accessibilityLabel="Home" accessibilityRole="button" hitSlop={10}>
            <View style={{ width: 110, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' }} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default PhoneShell;
