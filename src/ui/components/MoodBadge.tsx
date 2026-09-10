import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { EmotionId, Mind } from '@engine/core/types';
import { EMOTION_META, useTheme } from '../theme';
import { Text } from './Text';

export function MoodBadge({ emotion, mood, size = 'md', style, showMood = true }: { emotion: EmotionId; mood?: number; size?: 'sm' | 'md' | 'lg'; style?: StyleProp<ViewStyle>; showMood?: boolean }): React.ReactElement {
  const t = useTheme();
  const meta = EMOTION_META[emotion] ?? EMOTION_META.happy;
  const fs = size === 'sm' ? 11.5 : size === 'lg' ? 15 : 13;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: size === 'sm' ? 7 : 10, paddingVertical: size === 'sm' ? 2 : 4, borderRadius: t.radii.pill, backgroundColor: `${meta.color}22`, borderWidth: 1, borderColor: `${meta.color}55` }, style]} accessible accessibilityLabel={`Feeling ${meta.label}`}>
      <Text style={{ fontSize: fs + 1, lineHeight: fs + 5 }}>{meta.emoji}</Text>
      <Text variant="caption" color={meta.color} weight="600" style={{ fontSize: fs, lineHeight: fs + 4 }}>
        {meta.label}
      </Text>
      {showMood && mood !== undefined ? (
        <Text variant="caption" color={meta.color} style={{ fontSize: fs - 1, lineHeight: fs + 4, opacity: 0.8 }}>
          {mood > 0 ? `+${Math.round(mood)}` : Math.round(mood)}
        </Text>
      ) : null}
    </View>
  );
}

export function MoodletList({ mind, now, max = 6 }: { mind: Mind; now: number; max?: number }): React.ReactElement {
  const t = useTheme();
  const list = [...mind.moodlets].filter((m) => m.expiresAt > now).sort((a, b) => Math.abs(b.intensity) - Math.abs(a.intensity)).slice(0, max);
  if (!list.length)
    return (
      <Text variant="caption" faint>
        No active moodlets.
      </Text>
    );
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {list.map((m) => {
        const meta = EMOTION_META[m.emotion] ?? EMOTION_META.happy;
        const c = m.intensity >= 0 ? meta.color : t.colors.danger;
        return (
          <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: t.radii.pill, backgroundColor: `${c}1A` }}>
            <Text style={{ fontSize: 11 }}>{meta.emoji}</Text>
            <Text variant="caption" color={c}>
              {m.label}
            </Text>
            <Text variant="caption" color={c} style={{ opacity: 0.75, fontSize: 11 }}>
              {m.intensity > 0 ? `+${Math.round(m.intensity)}` : Math.round(m.intensity)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default MoodBadge;
