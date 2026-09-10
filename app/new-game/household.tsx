import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useNewGameDraft, type DraftMember } from '@/store/newGameDraft';
import { CONTENT } from '@engine/content';
import { Screen, Text, Button, Card, Icon, Pill, Avatar, EmptyState } from '@/ui/components';
import { StepHeader } from '@/ui/newgame/StepHeader';
import { useTheme } from '@/ui/theme';

const REL_LABEL: Record<NonNullable<DraftMember['relationship']>, string> = { spouse: 'Spouse', partner: 'Partner', child: 'Child', parent: 'Parent', sibling: 'Sibling', roommate: 'Roommate' };

function MemberCard({ m, index, onEdit, onRemove }: { m: DraftMember; index: number; onEdit: () => void; onRemove: () => void }): React.ReactElement {
  const t = useTheme();
  const career = m.careerId && m.careerId !== 'unemployed' && m.careerId !== 'student' ? CONTENT.careers[m.careerId]?.name : m.careerId === 'student' ? 'Student' : 'Between jobs';
  return (
    <Card onPress={onEdit} style={{ marginBottom: 10 }} accessibilityLabel={`Edit ${m.firstName}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar params={m.avatar} size={56} ring={index === 0 ? t.colors.accent : undefined} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="heading" numberOfLines={1}>
              {m.firstName} {m.lastName}
            </Text>
            {index === 0 ? <Pill label="You" color={t.colors.accent} /> : m.relationship ? <Pill label={REL_LABEL[m.relationship]} /> : null}
          </View>
          <Text variant="caption" muted numberOfLines={1}>
            {m.age} · {m.gender} · {career}
          </Text>
          <Text variant="caption" faint numberOfLines={1}>
            {m.traits.length ? m.traits.map((x) => CONTENT.traits[x]?.name ?? x).join(', ') : 'No traits yet'}
          </Text>
        </View>
        <Pressable onPress={onRemove} hitSlop={10} accessibilityLabel={`Remove ${m.firstName}`} style={{ padding: 6 }}>
          <Icon name="close" size={18} color={t.colors.textFaint} />
        </Pressable>
      </View>
    </Card>
  );
}

export default function HouseholdStep(): React.ReactElement {
  const t = useTheme();
  const router = useRouter();
  const members = useNewGameDraft((s) => s.members);
  const addMember = useNewGameDraft((s) => s.addMember);
  const removeMember = useNewGameDraft((s) => s.removeMember);
  const setStep = useNewGameDraft((s) => s.setStep);
  useEffect(() => {
    setStep(1);
  }, [setStep]);

  const add = () => {
    const m = addMember();
    router.push({ pathname: '/new-game/member', params: { id: m.id } });
  };
  const ready = members.length > 0 && members.every((m) => m.firstName.trim() && m.lastName.trim() && m.traits.length >= 1);

  return (
    <Screen scroll padded bottomInset={96}>
      <StepHeader step={1} title="Who are you?" subtitle="Play one person or a whole household. The first member is you; the others can run on autonomy while you're busy." />
      <View style={{ marginTop: 8 }}>
        {members.length === 0 ? (
          <EmptyState icon="account-plus-outline" title="Nobody yet" body="Create the person you'll play as. Traits, a job, a background — the world will take it seriously." action="Create your character" onAction={add} />
        ) : (
          members.map((m, i) => <MemberCard key={m.id} m={m} index={i} onEdit={() => router.push({ pathname: '/new-game/member', params: { id: m.id } })} onRemove={() => removeMember(m.id)} />)
        )}
        {members.length > 0 && members.length < 6 ? <Button title="Add a household member" icon="account-plus-outline" variant="secondary" full onPress={add} /> : null}
      </View>
      {!ready && members.length ? (
        <Text variant="caption" color={t.colors.warning} style={{ marginTop: 12 }}>
          Every member needs a name and at least one trait.
        </Text>
      ) : null}
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: 20 }}>
        <Button title="Next: home & money" iconRight="arrow-right" full size="lg" disabled={!ready} onPress={() => router.push('/new-game/home')} />
      </View>
    </Screen>
  );
}
