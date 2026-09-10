import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { AvatarParams, Gender } from '@engine/core/types';
import { useTheme } from '../theme';
import { Text } from '../components/Text';
import { Avatar } from '../avatar/Avatar';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { ACCESSORY_NAMES, CLOTHING_COLORS, EYE_COLORS, FACE_SHAPE_NAMES, FACIAL_HAIR_NAMES, HAIR_COLORS, HAIR_STYLE_NAMES, SKIN_TONES, randomAvatar } from '../avatar/avatarParams';
import { haptic } from '../haptics';

function Swatches({ label, colors, value, onChange }: { label: string; colors: string[]; value: string; onChange: (c: string) => void }): React.ReactElement {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" muted>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {colors.map((c) => {
          const on = c.toLowerCase() === value.toLowerCase();
          return (
            <Pressable
              key={c}
              onPress={() => {
                haptic.select();
                onChange(c);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${c}`}
              accessibilityState={{ selected: on }}
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: on ? 3 : 1, borderColor: on ? t.colors.accent : t.colors.borderStrong }}
            />
          );
        })}
      </View>
    </View>
  );
}

function Options({ label, names, value, onChange }: { label: string; names: string[]; value: number; onChange: (i: number) => void }): React.ReactElement {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" muted>
        {label}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {names.map((n, i) => (
          <Chip key={n} label={n} size="sm" selected={value === i} onPress={() => onChange(i)} />
        ))}
      </ScrollView>
    </View>
  );
}

export function AvatarCustomizer({ value, onChange, gender }: { value: AvatarParams; onChange: (p: AvatarParams) => void; gender: Gender }): React.ReactElement {
  const t = useTheme();
  const set = (patch: Partial<AvatarParams>) => onChange({ ...value, ...patch });
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Avatar params={value} size={112} ring={t.colors.accent} ringWidth={3} />
        <View style={{ flex: 1, gap: 8 }}>
          <Button title="Randomize" icon="dice-5" variant="secondary" onPress={() => onChange(randomAvatar(gender))} full />
          <Button title="Toggle glasses" icon="glasses" variant="ghost" size="sm" onPress={() => set({ glasses: !value.glasses })} />
        </View>
      </View>
      <Options label="Hair style" names={HAIR_STYLE_NAMES} value={value.hairStyle} onChange={(i) => set({ hairStyle: i })} />
      <Swatches label="Hair color" colors={HAIR_COLORS} value={value.hair} onChange={(c) => set({ hair: c })} />
      <Swatches label="Skin" colors={SKIN_TONES} value={value.skin} onChange={(c) => set({ skin: c })} />
      <Options label="Face" names={FACE_SHAPE_NAMES} value={value.faceShape} onChange={(i) => set({ faceShape: i })} />
      <Swatches label="Eyes" colors={EYE_COLORS} value={value.eye} onChange={(c) => set({ eye: c })} />
      <Options label="Facial hair" names={FACIAL_HAIR_NAMES} value={value.facialHair} onChange={(i) => set({ facialHair: i })} />
      <Options label="Accessory" names={ACCESSORY_NAMES} value={value.accessory} onChange={(i) => set({ accessory: i })} />
      <Swatches label="Clothing" colors={CLOTHING_COLORS} value={value.clothing} onChange={(c) => set({ clothing: c })} />
    </View>
  );
}

export default AvatarCustomizer;
