import React, { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useNewGameDraft, type ResidenceKind, type VehicleKind } from '@/store/newGameDraft';
import { buildRegion } from '@engine/gen/region';
import { Screen, Text, Button, Card, Chip, ChipRow, SectionHeader, Icon, MoneyText } from '@/ui/components';
import { StepHeader } from '@/ui/newgame/StepHeader';
import { useTheme } from '@/ui/theme';
import { money } from '@/ui/format';

const RESIDENCES: { id: ResidenceKind; label: string; icon: string; hint: string }[] = [
  { id: 'room', label: 'A rented room', icon: 'door', hint: 'Cheap. A bed, a desk, a shared kitchen.' },
  { id: 'apartment', label: 'Apartment', icon: 'office-building-outline', hint: 'Rent due on the 1st. Neighbors through the wall.' },
  { id: 'house', label: 'House', icon: 'home-outline', hint: 'A yard, a garage, a mortgage if you can afford it.' },
  { id: 'family_home', label: 'Family home', icon: 'home-heart', hint: 'No rent. Your parents are in the next room.' },
];
const CASH = [
  { label: 'Broke', amount: 300, hint: 'Rent is due in three weeks.' },
  { label: 'Modest', amount: 2500, hint: 'A cushion, if nothing goes wrong.' },
  { label: 'Comfortable', amount: 12000, hint: 'Room to breathe and make mistakes.' },
  { label: 'Trust fund', amount: 80000, hint: 'Money is not your problem. Yet.' },
];
const VEHICLES: { id: VehicleKind; label: string; icon: string }[] = [
  { id: 'none', label: 'No car', icon: 'walk' },
  { id: 'bicycle', label: 'Bicycle', icon: 'bike' },
  { id: 'used_car', label: 'Used car', icon: 'car-outline' },
  { id: 'new_car', label: 'New car (financed)', icon: 'car-sports' },
];
const PETS: { species: string; label: string; icon: string }[] = [
  { species: 'dog', label: 'Dog', icon: 'dog' },
  { species: 'cat', label: 'Cat', icon: 'cat' },
  { species: 'rabbit', label: 'Rabbit', icon: 'rabbit' },
  { species: 'fish', label: 'Fish', icon: 'fish' },
];

export default function HomeStep(): React.ReactElement {
  const t = useTheme();
  const router = useRouter();
  const draft = useNewGameDraft();
  const [petName, setPetName] = useState('');
  useEffect(() => {
    draft.setStep(2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const region = draft.region ? buildRegion({ name: draft.region.name, state: draft.region.state, stateCode: draft.region.stateCode, center: draft.region.center }) : null;
  const rentEstimate = region ? (draft.residence === 'room' ? region.medianRent1br * 0.6 : draft.residence === 'apartment' ? region.medianRent1br * 1.1 : draft.residence === 'house' ? region.medianRent1br * 1.8 : 0) : 0;

  const addPet = (species: string) => {
    if (draft.pets.length >= 3) return;
    const name = petName.trim() || ['Biscuit', 'Mochi', 'Pepper', 'Luna', 'Bean', 'Olive'][draft.pets.length % 6];
    draft.setHousehold({ pets: [...draft.pets, { species, name }] });
    setPetName('');
  };

  return (
    <Screen scroll padded bottomInset={96}>
      <StepHeader step={2} title="Home & money" subtitle="Where you sleep and what's in the account on day one." />

      <SectionHeader title="Home" style={{ marginTop: 8 }} />
      {RESIDENCES.map((r) => {
        const on = draft.residence === r.id;
        return (
          <Card key={r.id} onPress={() => draft.setHousehold({ residence: r.id })} style={{ marginBottom: 8 }} accent={on ? t.colors.accent : undefined} raised={on} accessibilityLabel={r.label}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icon name={r.icon} size={22} color={on ? t.colors.accent : t.colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{r.label}</Text>
                <Text variant="caption" muted>
                  {r.hint}
                </Text>
              </View>
              {region && r.id !== 'family_home' ? (
                <Text variant="caption" muted>
                  ~{money(r.id === 'room' ? region.medianRent1br * 0.6 : r.id === 'apartment' ? region.medianRent1br * 1.1 : region.medianRent1br * 1.8, { cents: false })}/mo
                </Text>
              ) : null}
            </View>
          </Card>
        );
      })}

      <SectionHeader title="Starting money" style={{ marginTop: 18 }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {CASH.map((c) => {
          const on = draft.startingCash === c.amount;
          return (
            <Card key={c.label} onPress={() => draft.setHousehold({ startingCash: c.amount })} style={{ width: '48%', flexGrow: 1 }} accent={on ? t.colors.accent : undefined} raised={on} accessibilityLabel={`${c.label}, ${money(c.amount)}`}>
              <Text variant="label" faint>
                {c.label}
              </Text>
              <MoneyText amount={c.amount} cents={false} variant="title" colorize={false} />
              <Text variant="caption" muted>
                {c.hint}
              </Text>
            </Card>
          );
        })}
      </View>
      {rentEstimate > 0 ? (
        <Text variant="caption" muted style={{ marginTop: 10 }}>
          At ~{money(rentEstimate, { cents: false })} a month, {money(draft.startingCash, { cents: false })} covers about {Math.max(0, Math.floor(draft.startingCash / rentEstimate))} month{Math.floor(draft.startingCash / rentEstimate) === 1 ? '' : 's'} of rent with nothing else.
        </Text>
      ) : null}

      <SectionHeader title="Getting around" style={{ marginTop: 18 }} />
      <ChipRow>
        {VEHICLES.map((v) => (
          <Chip key={v.id} label={v.label} icon={v.icon} selected={draft.vehicle === v.id} onPress={() => draft.setHousehold({ vehicle: v.id })} />
        ))}
      </ChipRow>

      <SectionHeader title={`Pets · ${draft.pets.length}/3`} style={{ marginTop: 18 }} />
      {draft.pets.map((p, i) => (
        <Chip key={`${p.species}-${i}`} label={`${p.name} the ${p.species}`} icon={PETS.find((x) => x.species === p.species)?.icon} selected onPress={() => draft.setHousehold({ pets: draft.pets.filter((_, j) => j !== i) })} style={{ marginBottom: 6, alignSelf: 'flex-start' }} />
      ))}
      {draft.pets.length < 3 ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <TextInput value={petName} onChangeText={setPetName} placeholder="Pet's name (optional)" placeholderTextColor={t.colors.textFaint} style={{ flex: 1, backgroundColor: t.colors.surface, borderColor: t.colors.border, borderWidth: 1, borderRadius: 12, color: t.colors.text, paddingHorizontal: 12, paddingVertical: 8 }} accessibilityLabel="Pet name" />
        </View>
      ) : null}
      {draft.pets.length < 3 ? (
        <ChipRow style={{ marginTop: 8 }}>
          {PETS.map((p) => (
            <Chip key={p.species} label={`Add ${p.label.toLowerCase()}`} icon={p.icon} size="sm" onPress={() => addPet(p.species)} />
          ))}
        </ChipRow>
      ) : null}

      <View style={{ position: 'absolute', left: 16, right: 16, bottom: 20 }}>
        <Button title="Review" iconRight="arrow-right" full size="lg" onPress={() => router.push('/new-game/review')} />
      </View>
    </Screen>
  );
}
