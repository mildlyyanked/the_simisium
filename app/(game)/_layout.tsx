import React from 'react';
import { Pressable, View } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGame } from '@/store/gameStore';
import { useActiveSim, useEngine } from '@/store/selectors';
import { Text, Icon } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { clockShort } from '@/ui/format';

const TABS: { name: string; label: string; icon: string; iconActive: string }[] = [
  { name: 'live', label: 'Live', icon: 'book-open-outline', iconActive: 'book-open-page-variant' },
  { name: 'map', label: 'Map', icon: 'map-outline', iconActive: 'map' },
  { name: 'phone', label: 'Phone', icon: 'cellphone', iconActive: 'cellphone' },
  { name: 'sims', label: 'Sims', icon: 'account-group-outline', iconActive: 'account-group' },
  { name: 'journal', label: 'Journal', icon: 'notebook-outline', iconActive: 'notebook' },
];

interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean }; navigate: (name: string) => void };
}

function TabBar({ state, navigation }: TabBarProps): React.ReactElement {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const engine = useEngine();
  const sim = useActiveSim();
  const unread = sim ? sim.phone.notifications.filter((n) => !n.read).length + Object.values(sim.phone.threads).reduce((n, th) => n + th.filter((m) => !m.read && m.to === sim.id).length, 0) : 0;
  return (
    <View style={{ backgroundColor: t.colors.backgroundElevated, borderTopWidth: 1, borderTopColor: t.colors.border, paddingBottom: Math.max(insets.bottom, 8), paddingTop: 6 }}>
      {engine && sim ? (
        <View style={{ alignSelf: 'center', marginBottom: 6, paddingHorizontal: 12, paddingVertical: 3, borderRadius: 999, backgroundColor: t.colors.surfaceRaised, flexDirection: 'row', alignItems: 'center', gap: 8 }} accessibilityLabel="Now">
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.colors.accent }} />
          <Text variant="caption" muted>
            {clockShort(engine.state.time.minute)} · {sim.identity.firstName} · {engine.state.venues[sim.location.venueId]?.name ?? '…'}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row' }}>
        {state.routes.map((route, index) => {
          const meta = TABS.find((x) => x.name === route.name) ?? TABS[0];
          const focused = state.index === index;
          const badge = route.name === 'phone' ? unread : 0;
          return (
            <Pressable
              key={route.key}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={meta.label}
              style={{ flex: 1, alignItems: 'center', paddingVertical: 4, gap: 2 }}
            >
              <View>
                <Icon name={focused ? meta.iconActive : meta.icon} size={22} color={focused ? t.colors.accent : t.colors.textMuted} />
                {badge > 0 ? (
                  <View style={{ position: 'absolute', top: -4, right: -10, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: t.colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                    <Text size={10} weight="700" color="#fff">
                      {badge > 9 ? '9+' : badge}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text variant="caption" color={focused ? t.colors.accent : t.colors.textMuted} size={11}>
                {meta.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function GameLayout(): React.ReactElement {
  const hydrated = useGame((s) => s.hydrated);
  const engine = useGame((s) => s.engine);
  const t = useTheme();
  if (hydrated && !engine) return <Redirect href="/" />;
  return (
    <Tabs tabBar={(props) => <TabBar state={props.state} navigation={props.navigation as unknown as TabBarProps['navigation']} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: t.colors.background }, lazy: true }}>
      <Tabs.Screen name="live" options={{ title: 'Live' }} />
      <Tabs.Screen name="map" options={{ title: 'Map' }} />
      <Tabs.Screen name="phone" options={{ title: 'Phone' }} />
      <Tabs.Screen name="sims" options={{ title: 'Sims' }} />
      <Tabs.Screen name="journal" options={{ title: 'Journal' }} />
    </Tabs>
  );
}
