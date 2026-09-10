import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useNewGameDraft } from '@/store/newGameDraft';
import { useGame } from '@/store/gameStore';
import { buildRegion } from '@engine/gen/region';
import type { PlayerSimSpec } from '@engine/gen/simgen';
import { Screen, Text, Button, ProgressBar, Icon } from '@/ui/components';
import { LogoMark } from '@/ui/components/Wordmark';
import { useTheme } from '@/ui/theme';

export default function GeneratingScreen(): React.ReactElement {
  const t = useTheme();
  const router = useRouter();
  const draft = useNewGameDraft();
  const newGame = useGame((s) => s.newGame);
  const progress = useGame((s) => s.genProgress);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pulse.value * 0.25 }], opacity: 0.35 - pulse.value * 0.3 }));

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        if (!draft.region || !draft.members.length) throw new Error('The draft is incomplete.');
        const region = buildRegion({ name: draft.region.name, state: draft.region.state, stateCode: draft.region.stateCode, center: draft.region.center });
        const members: PlayerSimSpec[] = draft.members.map(({ id: _id, avatar: _avatar, ...spec }) => spec);
        await newGame({
          seed: draft.seed,
          epoch: new Date().toISOString().slice(0, 10),
          name: draft.name.trim() || `${draft.members[0].firstName}'s life in ${draft.region.name}`,
          region,
          household: { name: draft.householdName || `${draft.members[0].lastName} household`, members, residence: draft.residence, startingCash: draft.startingCash, pets: draft.pets, vehicle: draft.vehicle },
          avatars: draft.members.map((m) => m.avatar),
        });
        draft.reset();
        router.replace('/(game)/live');
      } catch (err) {
        setError((err as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen padded edges={['top', 'bottom']} style={{ justifyContent: 'center' }}>
      <View style={{ alignItems: 'center', gap: 22 }}>
        <View style={{ width: 160, height: 160, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={[{ position: 'absolute', width: 140, height: 140, borderRadius: 70, backgroundColor: t.colors.accent }, ring]} />
          <LogoMark size={96} />
        </View>
        <View style={{ width: '100%', maxWidth: 420, gap: 10 }}>
          <Text variant="title" center>
            {error ? 'Something went wrong' : 'Building your world'}
          </Text>
          <Text variant="body" muted center>
            {error ?? progress?.message ?? 'Mapping the city…'}
          </Text>
          {!error ? <ProgressBar value={progress?.fraction ?? 0.02} color={t.colors.accent} height={8} /> : null}
          {error ? <Button title="Back to the draft" icon="arrow-left" variant="secondary" full onPress={() => router.replace('/new-game/review')} /> : null}
        </View>
        {!error ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: 0.7 }}>
            <Icon name="map-marker-radius-outline" size={16} color={t.colors.textMuted} />
            <Text variant="caption" muted>
              Real places, real hours, real distances.
            </Text>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
