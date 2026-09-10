import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useNewGameDraft, type DraftRegion } from '@/store/newGameDraft';
import { buildPlaces } from '@/store/engineFactory';
import { useSettings } from '@/store/settings';
import { buildRegion, REGION_PRESETS } from '@engine/gen/region';
import type { PlacePrediction } from '@engine/places/types';
import { Screen, Text, Button, Card, Chip, ChipRow, Icon, ListRow, SectionHeader } from '@/ui/components';
import { StepHeader } from '@/ui/newgame/StepHeader';
import { useTheme } from '@/ui/theme';
import { money } from '@/ui/format';

const FEATURED = ['austin, tx', 'new york, ny', 'los angeles, ca', 'chicago, il', 'seattle, wa', 'denver, co', 'miami, fl', 'atlanta, ga', 'boston, ma', 'nashville, tn', 'portland, or', 'phoenix, az'];

function presetToRegion(key: string): DraftRegion | null {
  const p = REGION_PRESETS[key];
  if (!p?.center) return null;
  return { name: p.name ?? key.split(',')[0], state: p.state, stateCode: p.stateCode, center: p.center };
}

export default function CityStep(): React.ReactElement {
  const t = useTheme();
  const router = useRouter();
  const region = useNewGameDraft((s) => s.region);
  const setRegion = useNewGameDraft((s) => s.setRegion);
  const setStep = useNewGameDraft((s) => s.setStep);
  const googleKey = useSettings((s) => s.googlePlacesKey);
  const [query, setQuery] = useState('');
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const places = useMemo(() => buildPlaces().places, [googleKey]);

  useEffect(() => {
    setStep(0);
  }, [setStep]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!query.trim() || !places) {
      setPredictions([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await places.autocomplete(query.trim());
        setPredictions(res.filter((p) => p.types.some((x) => /locality|political|city|administrative/.test(x)) || !p.types.length).slice(0, 6));
      } catch (err) {
        setError((err as Error).message);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, places]);

  const choosePrediction = async (p: PlacePrediction) => {
    if (!places) return;
    setError(null);
    try {
      const geo = await places.geocode(p.text);
      if (!geo) throw new Error('Could not locate that city.');
      const name = geo.city ?? p.text.split(',')[0].trim();
      setRegion({ name, state: geo.state, stateCode: geo.stateCode, center: geo.location });
      setQuery('');
      setPredictions([]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const useMyLocation = async () => {
    if (Platform.OS === 'web' && !('geolocation' in navigator)) return;
    setLocating(true);
    setError(null);
    try {
      let coords: { latitude: number; longitude: number } | null = null;
      if (Platform.OS === 'web') {
        coords = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((pos) => resolve(pos.coords), reject, { timeout: 8000 }));
      } else {
        const Location = await import('expo-location');
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') throw new Error('Location permission was not granted.');
        const pos = await Location.getCurrentPositionAsync({});
        coords = pos.coords;
      }
      if (!coords || !places) throw new Error('Location unavailable.');
      const center = { lat: coords.latitude, lng: coords.longitude };
      const rev = await places.reverseGeocode(center);
      setRegion({ name: rev?.city ?? 'Your city', state: rev?.state, stateCode: rev?.stateCode, center });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLocating(false);
    }
  };

  const preview = region ? buildRegion({ name: region.name, state: region.state, stateCode: region.stateCode, center: region.center }) : null;

  return (
    <Screen scroll padded bottomInset={96}>
      <StepHeader step={0} title="Where does this life happen?" subtitle={googleKey ? 'Real places from Google Maps will become your world.' : 'No Google key yet — the bundled Austin fixtures stand in for any city you pick.'} />
      <Card raised style={{ marginTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="magnify" size={20} color={t.colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search a US city"
            placeholderTextColor={t.colors.textFaint}
            autoCapitalize="words"
            autoCorrect={false}
            style={{ flex: 1, color: t.colors.text, fontSize: 16, paddingVertical: 8 }}
            accessibilityLabel="Search a city"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Icon name="close-circle" size={18} color={t.colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
        {predictions.length ? (
          <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: t.colors.border }}>
            {predictions.map((p, i) => (
              <ListRow key={p.placeId} title={p.text} subtitle={p.secondaryText} icon="map-marker-outline" onPress={() => void choosePrediction(p)} last={i === predictions.length - 1} />
            ))}
          </View>
        ) : null}
      </Card>
      <Button title={locating ? 'Locating…' : 'Use my location'} icon="crosshairs-gps" variant="secondary" full loading={locating} onPress={() => void useMyLocation()} style={{ marginTop: 10 }} />
      {error ? (
        <Text variant="caption" color={t.colors.danger} style={{ marginTop: 8 }}>
          {error}
        </Text>
      ) : null}

      <SectionHeader title="Or pick a city" style={{ marginTop: 22 }} />
      <ChipRow>
        {FEATURED.map((k) => {
          const r = presetToRegion(k);
          if (!r) return null;
          const on = region?.name === r.name && region?.stateCode === r.stateCode;
          return <Chip key={k} label={`${r.name}, ${r.stateCode ?? ''}`} selected={on} onPress={() => setRegion(r)} />;
        })}
      </ChipRow>

      {preview && region ? (
        <Card title={`${preview.name}, ${preview.stateCode}`} subtitle={preview.culture} icon="city-variant-outline" accent={t.colors.accent} style={{ marginTop: 18 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 6 }}>
            <Fact label="1-bed rent" value={money(preview.medianRent1br, { cents: false })} />
            <Fact label="Home price" value={money(preview.medianHomePrice, { cents: false, compact: true })} />
            <Fact label="Cost of living" value={`${Math.round(preview.costOfLiving * 100)}%`} />
            <Fact label="Min. wage" value={`${money(preview.minimumWage)}/h`} />
            <Fact label="Climate" value={preview.climate.replace(/_/g, ' ')} />
            <Fact label="Transit" value={preview.transitQuality >= 0.6 ? 'Good' : preview.transitQuality >= 0.3 ? 'Some' : 'Car country'} />
          </View>
        </Card>
      ) : null}

      <View style={{ position: 'absolute', left: 16, right: 16, bottom: 20 }}>
        <Button title="Next: your household" iconRight="arrow-right" full size="lg" disabled={!region} onPress={() => router.push('/new-game/household')} />
      </View>
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={{ minWidth: '28%' }}>
      <Text variant="label" faint>
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}
