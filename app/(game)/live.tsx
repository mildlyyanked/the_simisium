import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import { useGame } from '@/store/gameStore';
import { useActions, useActiveSim, useControlledSims, useEngine, useOpenConversation, usePendingInterrupt, useVenueOf } from '@/store/selectors';
import type { LogEntry, SimId } from '@engine/core/types';
import { Screen, Text, Button, IconButton, NeedsGrid, NeedsDots, MoodBadge, MoodletList, NarrativeFeed, Composer, ActionSheet, TimeBar, InterruptModal, BusyOverlay, Pill, RelationshipMeter, SimAvatar, Icon } from '@/ui/components';
import { ARCHETYPE_ICON } from '@/ui/icons';
import { useTheme } from '@/ui/theme';
import { openStatus } from '@/ui/format';
import { haptic } from '@/ui/haptics';

export default function LiveScreen(): React.ReactElement {
  const t = useTheme();
  const router = useRouter();
  const engine = useEngine();
  const sim = useActiveSim();
  const venue = useVenueOf(sim);
  const controlled = useControlledSims();
  const actions = useActions();
  const interrupt = usePendingInterrupt();
  const conversation = useOpenConversation();
  const busy = useGame((s) => s.busy);
  const busyLabel = useGame((s) => s.busyLabel);
  const followUps = useGame((s) => s.followUps);
  const recentIds = useGame((s) => s.recentActionIds);
  const perform = useGame((s) => s.perform);
  const freeform = useGame((s) => s.freeform);
  const say = useGame((s) => s.say);
  const wait = useGame((s) => s.wait);
  const waitUntilMorning = useGame((s) => s.waitUntilMorning);
  const skipToNextEvent = useGame((s) => s.skipToNextEvent);
  const endConversation = useGame((s) => s.endConversation);
  const resolveInterrupt = useGame((s) => s.resolveInterrupt);
  const switchSim = useGame((s) => s.switchSim);
  const toggleAutonomy = useGame((s) => s.toggleAutonomy);
  const version = useGame((s) => s.version);
  const [sheet, setSheet] = useState(false);
  const [needsOpen, setNeedsOpen] = useState(true);

  const partnerId = conversation?.participantIds.find((p) => p !== sim?.id) as SimId | undefined;
  const partner = partnerId && engine ? engine.state.sims[partnerId] : undefined;
  const feedFilter = useMemo(() => {
    if (!sim) return undefined;
    if (conversation) return (e: LogEntry) => e.at >= conversation.startedAt && (e.kind === 'dialogue' || e.kind === 'llm' || e.simId === sim.id);
    return (e: LogEntry) => !e.simId || e.simId === sim.id || e.kind === 'event' || e.kind === 'alert' || e.importance >= 2;
  }, [sim, conversation]);

  const nextEvent = useMemo(() => engine?.state.scheduled.find((e) => e.visible && e.atMinute > engine.state.time.minute), [engine, version]);

  const onSubmit = useCallback(
    (text: string, mode: 'do' | 'say') => {
      if (!text.trim()) return;
      if (mode === 'say' && conversation) void say(conversation.id, text.trim());
      else void freeform(text.trim());
    },
    [conversation, say, freeform],
  );

  if (!engine || !sim || !venue) {
    return (
      <Screen padded>
        <Text muted>No life loaded.</Text>
        <Button title="Back to title" onPress={() => router.replace('/')} />
      </Screen>
    );
  }
  const status = openStatus(venue.google?.openingPeriods, engine.state.epoch, engine.state.time.minute, engine.ctx().query.isVenueOpen(venue.id));
  const here = engine.ctx().query.simsAt(venue.id).filter((s) => s.id !== sim.id);
  const autonomy = sim.flags.autonomy === true;
  const holidays = engine.clock.day.holidays;

  return (
    <Screen edges={['top']} gradient={false} style={{ backgroundColor: t.colors.background }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      {/* header */}
      <View style={{ paddingHorizontal: 14, paddingTop: 6, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: t.colors.border, backgroundColor: t.colors.backgroundElevated }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.push('/(game)/sims')} accessibilityLabel="Open character sheet">
            <SimAvatar sim={sim} size={48} ring={t.colors.accent} badge={autonomy ? 'robot-outline' : null} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
                {sim.identity.firstName} {sim.identity.lastName}
              </Text>
              <MoodBadge emotion={sim.mind.dominantEmotion} mood={sim.mind.mood} size="sm" />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Icon name={ARCHETYPE_ICON[venue.archetype] ?? 'map-marker'} size={13} color={t.colors.textMuted} />
              <Text variant="caption" muted numberOfLines={1} style={{ flexShrink: 1 }}>
                {sim.travel ? `On the way to ${engine.state.venues[sim.travel.toVenueId]?.name ?? 'somewhere'}` : venue.name}
              </Text>
              {venue.archetype !== 'home' ? <Pill label={status.label} color={status.open ? t.colors.success : t.colors.danger} size="xs" /> : null}
              {here.length ? <Pill label={`${here.length} here`} size="xs" /> : null}
            </View>
          </View>
          {controlled.length > 1 ? (
            <View style={{ flexDirection: 'row', gap: -6 }}>
              {controlled
                .filter((c) => c.id !== sim.id)
                .slice(0, 4)
                .map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => switchSim(c.id)}
                    onLongPress={() => {
                      haptic.medium();
                      toggleAutonomy(c.id);
                    }}
                    accessibilityLabel={`Switch to ${c.identity.firstName}`}
                    style={{ marginLeft: -6 }}
                  >
                    <SimAvatar sim={c} size={34} ring={c.flags.autonomy ? t.colors.success : t.colors.border} dim={!c.body.alive} badge={c.flags.autonomy ? 'robot-outline' : null} />
                  </Pressable>
                ))}
            </View>
          ) : null}
          <IconButton icon={needsOpen ? 'chevron-up' : 'chevron-down'} size={34} accessibilityLabel={needsOpen ? 'Hide needs' : 'Show needs'} onPress={() => setNeedsOpen((v) => !v)} />
        </View>
        {needsOpen ? (
          <View style={{ marginTop: 10 }}>
            <NeedsGrid needs={sim.needs} compact columns={4} />
            {sim.mind.moodlets.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 6 }}>
                <MoodletList mind={sim.mind} now={engine.state.time.minute} max={6} />
              </ScrollView>
            ) : null}
          </View>
        ) : (
          <View style={{ marginTop: 8 }}>
            <NeedsDots needs={sim.needs} />
          </View>
        )}
      </View>

      {/* conversation banner */}
      {conversation && partner ? (
        <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: t.colors.surface, borderBottomWidth: 1, borderBottomColor: t.colors.border, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <SimAvatar sim={partner} size={36} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {conversation.channel === 'text' ? 'Texting ' : conversation.channel === 'phone' ? 'On the phone with ' : 'Talking with '}
              {partner.identity.firstName}
            </Text>
            <RelationshipMeter rel={sim.relationships[partner.id]} compact showFlags={false} />
          </View>
          <Button title="End" size="sm" variant="ghost" icon="close" onPress={endConversation} />
        </View>
      ) : null}

      {/* feed */}
      <View style={{ flex: 1 }}>
        <NarrativeFeed state={engine.state} filter={feedFilter} version={version} animateAfterMinute={engine.state.time.minute - 30} emptyText={conversation ? `Say something to ${partner?.identity.firstName ?? 'them'}.` : 'Your story starts here.'} />
      </View>

      {/* composer + actions */}
      <View style={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 6, backgroundColor: t.colors.backgroundElevated, borderTopWidth: 1, borderTopColor: t.colors.border }}>
        <Composer
          mode={conversation ? 'say' : 'do'}
          lockMode
          suggestions={conversation ? followUps : followUps.length ? followUps : ['Look around', 'Check my phone', 'Make something to eat']}
          onSubmit={onSubmit}
          disabled={busy || !!interrupt}
          placeholder={conversation ? `Say something to ${partner?.identity.firstName ?? 'them'}…` : 'What do you do?'}
          leftAccessory={<IconButton icon="view-grid-outline" accessibilityLabel="Actions" onPress={() => setSheet(true)} active={sheet} />}
        />
        <TimeBar clock={engine.clock} weather={engine.state.weather} onWait={(m) => wait(m)} onWaitUntilMorning={waitUntilMorning} onSkipToNextEvent={skipToNextEvent} nextEventLabel={nextEvent?.label} disabled={busy || !!interrupt || !!conversation} holidays={holidays} />
      </View>
      </KeyboardAvoidingView>

      <ActionSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        actions={actions}
        recentIds={recentIds}
        onPerform={(id, params) => {
          setSheet(false);
          const res = perform(id, params);
          if (res?.conversationOpened) haptic.select();
        }}
        onFreeform={() => setSheet(false)}
      />
      <InterruptModal interrupt={interrupt} fromSim={interrupt?.fromSimId ? engine.state.sims[interrupt.fromSimId] : null} onResolve={(id, actionId, params) => resolveInterrupt(id, actionId, params)} />
      <BusyOverlay visible={busy} label={busyLabel || 'The world is thinking…'} />
    </Screen>
  );
}
