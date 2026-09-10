import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useGame } from '@/store/gameStore';
import { useNewGameDraft } from '@/store/newGameDraft';
import type { SaveIndexEntry } from '@/store/persistence';
import { Screen, Text, Button, Card, Dialog, EmptyState, Icon, MoneyText } from '@/ui/components';
import { LogoMark, Wordmark } from '@/ui/components/Wordmark';
import { useTheme } from '@/ui/theme';

function AnimatedBackdrop(): React.ReactElement {
  const { width, height } = useWindowDimensions();
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 14000, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [p]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: -width * 0.25 + p.value * width * 0.5 }, { translateY: p.value * -40 }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ translateX: width * 0.2 - p.value * width * 0.4 }, { translateY: 60 - p.value * 90 }], opacity: 0.6 + p.value * 0.3 }));
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[{ position: 'absolute', top: height * 0.05, left: width * 0.2, width: width * 0.9, height: width * 0.9, borderRadius: width, backgroundColor: 'rgba(245,184,74,0.10)' }, a]} />
      <Animated.View style={[{ position: 'absolute', top: height * 0.45, left: -width * 0.2, width: width * 0.8, height: width * 0.8, borderRadius: width, backgroundColor: 'rgba(110,168,254,0.10)' }, b]} />
      <LinearGradient colors={['rgba(11,14,20,0)', 'rgba(11,14,20,0.6)', '#0B0E14']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
    </View>
  );
}

function SaveCard({ s, onLoad, onDelete, isLast }: { s: SaveIndexEntry; onLoad: () => void; onDelete: () => void; isLast: boolean }): React.ReactElement {
  const t = useTheme();
  const updated = new Date(s.updatedAt);
  const ago = Math.max(0, Date.now() - updated.getTime());
  const agoLabel = ago < 60_000 ? 'just now' : ago < 3_600_000 ? `${Math.round(ago / 60_000)} min ago` : ago < 86_400_000 ? `${Math.round(ago / 3_600_000)} h ago` : `${Math.round(ago / 86_400_000)} d ago`;
  return (
    <Card onPress={onLoad} onLongPress={onDelete} style={{ marginBottom: 10 }} accent={isLast ? t.colors.accent : undefined} accessibilityLabel={`Load ${s.simName} in ${s.city}, day ${s.day}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: t.colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="book-open-page-variant" size={22} color={t.colors.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {s.simName}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {s.city} · Day {s.day} · {agoLabel}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <MoneyText amount={s.money} cents={false} variant="body" colorize={false} />
          {isLast ? (
            <Text variant="caption" accent>
              Latest
            </Text>
          ) : null}
        </View>
        <Pressable onPress={onDelete} hitSlop={10} accessibilityLabel="Delete save" accessibilityRole="button" style={{ padding: 4 }}>
          <Icon name="trash-can-outline" size={18} color={t.colors.textFaint} />
        </Pressable>
      </View>
    </Card>
  );
}

export default function TitleScreen(): React.ReactElement {
  const t = useTheme();
  const router = useRouter();
  const saves = useGame((s) => s.saves);
  const lastSaveId = useGame((s) => s.lastSaveId);
  const load = useGame((s) => s.load);
  const deleteSave = useGame((s) => s.deleteSave);
  const listSaves = useGame((s) => s.listSaves);
  const engine = useGame((s) => s.engine);
  const resetDraft = useNewGameDraft((s) => s.reset);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [showLoad, setShowLoad] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SaveIndexEntry | null>(null);
  const { width } = useWindowDimensions();
  const wide = width > 640;

  useFocusEffect(
    React.useCallback(() => {
      void listSaves();
    }, [listSaves]),
  );

  const last = saves.find((s) => s.saveId === lastSaveId) ?? saves[0];

  const doLoad = async (id: string) => {
    setLoadingId(id);
    const ok = await load(id);
    setLoadingId(null);
    if (ok) {
      setShowLoad(false);
      router.replace('/(game)/live');
    }
  };

  const startNew = () => {
    resetDraft();
    router.push('/new-game');
  };

  return (
    <Screen gradient={false} edges={['top', 'bottom']}>
      <AnimatedBackdrop />
      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 20 }}>
        <Animated.View entering={FadeIn.duration(600)} style={{ alignItems: 'center', marginTop: wide ? 40 : 56, gap: 14 }}>
          <LogoMark size={wide ? 110 : 92} />
          <Wordmark size={wide ? 46 : 38} />
          <Text variant="prose" muted center style={{ maxWidth: 320, fontStyle: 'italic' }}>
            A life, written one day at a time. Real streets. Real stakes. Everyone remembers.
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(200).duration(500)} style={{ width: '100%', maxWidth: 440, marginTop: 36, gap: 10 }}>
          {engine ? <Button title="Back to your life" icon="play" full size="lg" onPress={() => router.replace('/(game)/live')} /> : null}
          {last && !engine ? <Button title={`Continue · ${last.simName}`} icon="play" full size="lg" loading={loadingId === last.saveId} onPress={() => void doLoad(last.saveId)} /> : null}
          <Button title="New Life" icon="creation" full size="lg" variant={last || engine ? 'secondary' : 'primary'} onPress={startNew} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Load" icon="folder-open-outline" variant="secondary" style={{ flex: 1 }} full onPress={() => setShowLoad(true)} disabled={saves.length === 0} />
            <Button title="Settings" icon="cog-outline" variant="secondary" style={{ flex: 1 }} full onPress={() => router.push('/settings')} />
          </View>
        </Animated.View>

        {saves.length ? (
          <Animated.View entering={FadeInDown.delay(350).duration(500)} style={{ width: '100%', maxWidth: 440, marginTop: 28, flex: 1 }}>
            <Text variant="label" muted style={{ marginBottom: 8 }}>
              Your lives
            </Text>
            <Animated.ScrollView showsVerticalScrollIndicator={false}>
              {saves.slice(0, 4).map((s) => (
                <SaveCard key={s.saveId} s={s} isLast={s.saveId === last?.saveId} onLoad={() => void doLoad(s.saveId)} onDelete={() => setConfirmDelete(s)} />
              ))}
            </Animated.ScrollView>
          </Animated.View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Text variant="caption" faint center style={{ marginBottom: 6 }}>
          v0.1 · Built on real places · Powered by language models
        </Text>
      </View>

      <Dialog visible={showLoad} onClose={() => setShowLoad(false)} title="Load a life">
        {saves.length ? (
          <Animated.ScrollView style={{ maxHeight: 380 }}>
            {saves.map((s) => (
              <SaveCard key={s.saveId} s={s} isLast={s.saveId === last?.saveId} onLoad={() => void doLoad(s.saveId)} onDelete={() => setConfirmDelete(s)} />
            ))}
          </Animated.ScrollView>
        ) : (
          <EmptyState compact icon="folder-open-outline" title="No saves yet" body="Start a new life and it will show up here." />
        )}
      </Dialog>

      <Dialog visible={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete this life?">
        <Text variant="body" muted style={{ marginBottom: 16 }}>
          {confirmDelete ? `${confirmDelete.simName} in ${confirmDelete.city}, day ${confirmDelete.day}. This can’t be undone.` : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Keep" variant="ghost" onPress={() => setConfirmDelete(null)} />
          <Button
            title="Delete"
            variant="danger"
            onPress={() => {
              if (confirmDelete) void deleteSave(confirmDelete.saveId);
              setConfirmDelete(null);
            }}
          />
        </View>
      </Dialog>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: t.colors.border, opacity: 0 }} />
    </Screen>
  );
}
