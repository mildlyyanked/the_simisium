import React from 'react';
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon } from '../icons';
import { haptic } from '../haptics';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: string;
  badge?: number | string;
}

/** Scrollable underline tabs for in-screen sections. */
export function Tabs<T extends string>({ tabs, value, onChange, style }: { tabs: TabItem<T>[]; value: T; onChange: (v: T) => void; style?: StyleProp<ViewStyle> }): React.ReactElement {
  const t = useTheme();
  return (
    <View style={[{ borderBottomWidth: 1, borderBottomColor: t.colors.border }, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 4 }} accessibilityRole="tablist">
        {tabs.map((tab) => {
          const active = tab.id === value;
          return (
            <Pressable
              key={tab.id}
              onPress={() => {
                haptic.select();
                onChange(tab.id);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={{ paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: active ? t.colors.accent : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              {tab.icon ? <Icon name={tab.icon} size={15} color={active ? t.colors.accent : t.colors.textMuted} /> : null}
              <Text variant="body" weight="600" color={active ? t.colors.text : t.colors.textMuted}>
                {tab.label}
              </Text>
              {tab.badge !== undefined && tab.badge !== 0 ? (
                <View style={{ backgroundColor: t.colors.accent, borderRadius: 99, minWidth: 18, height: 18, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' }}>
                  <Text variant="caption" color={t.colors.accentText} weight="700" style={{ fontSize: 10.5, lineHeight: 13 }}>
                    {String(tab.badge)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default Tabs;
