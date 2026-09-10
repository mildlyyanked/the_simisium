import React, { useEffect } from 'react';
import { TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useNewGameDraft } from '@/store/newGameDraft';
import { useSettings } from '@/store/settings';
import { CONTENT } from '@engine/content';
import { Screen, Text, Button, Card, KeyValue, Avatar, SectionHeader } from '@/ui/components';
import { StepHeader } from '@/ui/newgame/StepHeader';
import { useTheme } from '@/ui/theme';
import { money } from '@/ui/format';

export default function ReviewStep(): React.ReactElement {
  const t = useTheme();
  const router = useRouter();
  const draft = useNewGameDraft();
  const openRouterKey = useSettings((s) => s.openRouterKey);
  const googleKey = useSettings((s) => s.googlePlacesKey);
  useEffect(() => {
    draft.setStep(3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const you = draft.members[0];
  const careerName = (id?: string) => (id && id !== 'unemployed' && id !== 'student' ? CONTENT.careers[id]?.name ?? id : id === 'student' ? 'Student' : 'Between jobs');

  return (
    <Screen scroll padded bottomInset={96}>
      <StepHeader step={3} title="One last look" subtitle="You can't change the city or the household once the world exists. Everything else is yours to change by living." />
      <Card raised style={{ marginTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {draft.members.slice(0, 4).map((m, i) => (
            <Avatar key={m.id} params={m.avatar} size={i === 0 ? 64 : 44} ring={i === 0 ? t.colors.accent : undefined} />
          ))}
          <View style={{ flex: 1 }}>
            <Text variant="title" numberOfLines={2}>
              {draft.householdName || `${you?.lastName ?? 'New'} household`}
            </Text>
            <Text variant="caption" muted>
              {draft.members.length} {draft.members.length === 1 ? 'person' : 'people'} · {draft.region?.name}, {draft.region?.stateCode ?? draft.region?.state}
            </Text>
          </View>
        </View>
      </Card>

      <SectionHeader title="Household" style={{ marginTop: 18 }} />
      <Card>
        {draft.members.map((m, i) => (
          <KeyValue key={m.id} label={`${m.firstName} ${m.lastName}${i === 0 ? ' (you)' : m.relationship ? ` · ${m.relationship}` : ''}`} value={`${m.age} · ${careerName(m.careerId)}`} last={i === draft.members.length - 1} />
        ))}
      </Card>

      <SectionHeader title="Life on day one" style={{ marginTop: 18 }} />
      <Card>
        <KeyValue label="City" value={`${draft.region?.name ?? '—'}${draft.region?.stateCode ? `, ${draft.region.stateCode}` : ''}`} />
        <KeyValue label="Home" value={draft.residence.replace('_', ' ')} />
        <KeyValue label="Money" value={money(draft.startingCash, { cents: false })} />
        <KeyValue label="Vehicle" value={draft.vehicle.replace('_', ' ')} />
        <KeyValue label="Pets" value={draft.pets.length ? draft.pets.map((p) => `${p.name} (${p.species})`).join(', ') : 'none'} last />
      </Card>

      <SectionHeader title="Name this life" style={{ marginTop: 18 }} />
      <TextInput value={draft.name} onChangeText={(v) => draft.setHousehold({ name: v })} placeholder={`${you?.firstName ?? 'A'}'s life in ${draft.region?.name ?? 'the city'}`} placeholderTextColor={t.colors.textFaint} style={{ backgroundColor: t.colors.surface, borderColor: t.colors.border, borderWidth: 1, borderRadius: 12, color: t.colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 }} accessibilityLabel="Save name" />

      <Card padded={12} style={{ marginTop: 18 }}>
        <Text variant="caption" muted>
          {openRouterKey ? 'Conversations and freeform actions will be driven by your OpenRouter models.' : 'No OpenRouter key set — conversations will use the offline fallback. Add a key in Settings any time.'}
          {'\n'}
          {googleKey ? 'Real places from Google Maps will populate the world.' : 'No Google key set — the bundled Austin fixtures stand in for your city.'}
        </Text>
      </Card>

      <View style={{ position: 'absolute', left: 16, right: 16, bottom: 20 }}>
        <Button title="Start living" icon="play" full size="lg" disabled={!draft.region || !draft.members.length} onPress={() => router.replace('/new-game/generating')} />
      </View>
    </Screen>
  );
}
