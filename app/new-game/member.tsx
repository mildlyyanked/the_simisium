import React, { useMemo, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useNewGameDraft, type DraftMember } from '@/store/newGameDraft';
import { CONTENT } from '@engine/content';
import type { EducationLevel, Gender } from '@engine/core/types';
import { Screen, Text, Button, Card, Chip, ChipRow, SectionHeader, SegmentedControl, IconButton } from '@/ui/components';
import { AvatarCustomizer } from '@/ui/newgame/AvatarCustomizer';
import { useTheme } from '@/ui/theme';
import { randomAvatar } from '@/ui/avatar/avatarParams';

const GENDERS: { id: Gender; label: string }[] = [{ id: 'female', label: 'Woman' }, { id: 'male', label: 'Man' }, { id: 'nonbinary', label: 'Non-binary' }];
const EDU: { id: EducationLevel; label: string }[] = [{ id: 'high_school', label: 'High school' }, { id: 'some_college', label: 'Some college' }, { id: 'associate', label: 'Associate' }, { id: 'bachelor', label: "Bachelor's" }, { id: 'master', label: "Master's" }, { id: 'doctorate', label: 'Doctorate' }];
const RELS: { id: NonNullable<DraftMember['relationship']>; label: string }[] = [{ id: 'spouse', label: 'Spouse' }, { id: 'partner', label: 'Partner' }, { id: 'child', label: 'Child' }, { id: 'parent', label: 'Parent' }, { id: 'sibling', label: 'Sibling' }, { id: 'roommate', label: 'Roommate' }];

function Field({ label, value, onChange, placeholder, multiline, keyboardType }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: 'default' | 'number-pad' }): React.ReactElement {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text variant="label" faint style={{ marginBottom: 6 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.colors.textFaint}
        multiline={multiline}
        keyboardType={keyboardType}
        style={{ backgroundColor: t.colors.surface, borderColor: t.colors.border, borderWidth: 1, borderRadius: 12, color: t.colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, minHeight: multiline ? 96 : undefined, textAlignVertical: multiline ? 'top' : 'center' }}
        accessibilityLabel={label}
      />
    </View>
  );
}

export default function MemberEditor(): React.ReactElement {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const members = useNewGameDraft((s) => s.members);
  const updateMember = useNewGameDraft((s) => s.updateMember);
  const m = members.find((x) => x.id === id);
  const index = members.findIndex((x) => x.id === id);
  const [careerQuery, setCareerQuery] = useState('');
  const traitIds = useMemo(() => Object.keys(CONTENT.traits).sort((a, b) => CONTENT.traits[a].name.localeCompare(CONTENT.traits[b].name)), []);
  const hobbyIds = useMemo(() => Object.keys(CONTENT.hobbies), []);
  const careers = useMemo(() => Object.values(CONTENT.careers).filter((c) => c.sector !== 'criminal').sort((a, b) => a.name.localeCompare(b.name)), []);

  if (!m) {
    return (
      <Screen padded>
        <Text>That member no longer exists.</Text>
        <Button title="Back" onPress={() => router.back()} />
      </Screen>
    );
  }
  const set = (patch: Partial<DraftMember>) => updateMember(m.id, patch);
  const toggleTrait = (tid: string) => {
    const has = m.traits.includes(tid);
    if (has) return set({ traits: m.traits.filter((x) => x !== tid) });
    if (m.traits.length >= 4) return;
    const conflicts = CONTENT.traits[tid]?.conflicts ?? [];
    if (m.traits.some((x) => conflicts.includes(x) || (CONTENT.traits[x]?.conflicts ?? []).includes(tid))) return;
    set({ traits: [...m.traits, tid] });
  };
  const toggleHobby = (h: string) => {
    const hobbies = m.hobbies ?? [];
    set({ hobbies: hobbies.includes(h) ? hobbies.filter((x) => x !== h) : hobbies.length < 4 ? [...hobbies, h] : hobbies });
  };
  const filteredCareers = careers.filter((c) => !careerQuery || c.name.toLowerCase().includes(careerQuery.toLowerCase()));
  const isAdult = m.age >= 16;

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 6, gap: 8 }}>
        <IconButton icon="chevron-down" accessibilityLabel="Close" onPress={() => router.back()} />
        <Text variant="heading" style={{ flex: 1 }}>
          {index === 0 ? 'Your character' : 'Household member'}
        </Text>
        <Button title="Done" size="sm" onPress={() => router.back()} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <AvatarCustomizer value={m.avatar} onChange={(avatar) => set({ avatar })} gender={m.gender} />

        <SectionHeader title="Identity" style={{ marginTop: 18 }} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Field label="First name" value={m.firstName} onChange={(v) => set({ firstName: v })} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Last name" value={m.lastName} onChange={(v) => set({ lastName: v })} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
          <View style={{ width: 96 }}>
            <Field label="Age" value={String(m.age)} onChange={(v) => set({ age: Math.max(0, Math.min(95, parseInt(v || '0', 10) || 0)) })} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1, marginBottom: 12 }}>
            <Text variant="label" faint style={{ marginBottom: 6 }}>
              Gender
            </Text>
            <SegmentedControl segments={GENDERS} value={m.gender} onChange={(g) => set({ gender: g, avatar: randomAvatar(g) })} size="sm" />
          </View>
        </View>
        {index > 0 ? (
          <>
            <Text variant="label" faint style={{ marginBottom: 6 }}>
              Relationship to {members[0]?.firstName || 'you'}
            </Text>
            <ChipRow style={{ marginBottom: 12 }}>
              {RELS.map((r) => (
                <Chip key={r.id} label={r.label} size="sm" selected={m.relationship === r.id} onPress={() => set({ relationship: r.id })} />
              ))}
            </ChipRow>
          </>
        ) : null}

        <SectionHeader title={`Traits · ${m.traits.length}/4`} />
        <Text variant="caption" muted style={{ marginBottom: 8 }}>
          Traits change how needs decay, how skills grow, and how the world talks to you.
        </Text>
        <ChipRow>
          {traitIds.map((tid) => {
            const def = CONTENT.traits[tid];
            const selected = m.traits.includes(tid);
            const blocked = !selected && m.traits.some((x) => (def.conflicts ?? []).includes(x) || (CONTENT.traits[x]?.conflicts ?? []).includes(tid));
            return <Chip key={tid} label={def.name} icon={def.icon} size="sm" selected={selected} disabled={blocked || (!selected && m.traits.length >= 4)} onPress={() => toggleTrait(tid)} />;
          })}
        </ChipRow>

        {isAdult ? (
          <>
            <SectionHeader title="Work" style={{ marginTop: 18 }} />
            <ChipRow style={{ marginBottom: 8 }}>
              <Chip label="Between jobs" selected={!m.careerId || m.careerId === 'unemployed'} onPress={() => set({ careerId: 'unemployed' })} size="sm" />
              <Chip label="Student" selected={m.careerId === 'student'} onPress={() => set({ careerId: 'student' })} size="sm" />
            </ChipRow>
            <Field label="Find a career" value={careerQuery} onChange={setCareerQuery} placeholder="nurse, barista, software…" />
            <ChipRow>
              {filteredCareers.slice(0, careerQuery ? 40 : 18).map((c) => (
                <Chip key={c.id} label={c.name} icon={c.icon} size="sm" selected={m.careerId === c.id} onPress={() => set({ careerId: c.id })} />
              ))}
            </ChipRow>
            <SectionHeader title="Education" style={{ marginTop: 18 }} />
            <ChipRow>
              {EDU.map((e) => (
                <Chip key={e.id} label={e.label} size="sm" selected={m.educationLevel === e.id} onPress={() => set({ educationLevel: e.id })} />
              ))}
            </ChipRow>
          </>
        ) : null}

        <SectionHeader title={`Hobbies · ${(m.hobbies ?? []).length}/4`} style={{ marginTop: 18 }} />
        <ChipRow>
          {hobbyIds.map((h) => (
            <Chip key={h} label={CONTENT.hobbies[h].name} icon={CONTENT.hobbies[h].icon} size="sm" selected={(m.hobbies ?? []).includes(h)} onPress={() => toggleHobby(h)} />
          ))}
        </ChipRow>

        <SectionHeader title="Story" style={{ marginTop: 18 }} />
        <Field label="Background — what's your story?" value={m.background ?? ''} onChange={(v) => set({ background: v })} placeholder="Grew up in Fresno, moved here for a job that fell through. Still here." multiline />
        <Field label="What do you want out of this life?" value={m.aspiration ?? ''} onChange={(v) => set({ aspiration: v })} placeholder="open a bakery · get out of debt · find someone" />
        <Card padded={12} style={{ marginTop: 4 }}>
          <Text variant="caption" muted>
            Everything you write here becomes ground truth for the world: other characters will react to it, and it shapes what happens to you.
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}
