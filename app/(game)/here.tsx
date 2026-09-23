import React, { useMemo, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useGame } from '@/store/gameStore';
import { useActions, useActiveSim, useEngine, useVenueOf } from '@/store/selectors';
import type { ObjectId, SimId } from '@engine/core/types';
import { positionOf, roomAt, objectAt } from '@engine/space/nav';
import { CONTENT } from '@engine/content';
import { crowdAt, extrasAt, whereLabel } from '@engine/systems/crowd';
import { Screen, Text, Card, Chip, ChipRow, EmptyState, PlaceMap, ActionSheet, Icon, IconButton } from '@/ui/components';
import { ARCHETYPE_ICON } from '@/ui/icons';
import { useTheme } from '@/ui/theme';
import { haptic } from '@/ui/haptics';

export default function HereScreen(): React.ReactElement {
  const t = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const engine = useEngine();
  const sim = useActiveSim();
  const venue = useVenueOf(sim);
  const actions = useActions();
  const version = useGame((s) => s.version);
  const busy = useGame((s) => s.busy);
  const moveTo = useGame((s) => s.moveTo);
  const walkToObject = useGame((s) => s.walkToObject);
  const startConversation = useGame((s) => s.startConversation);
  const meetStranger = useGame((s) => s.meetStranger);
  const perform = useGame((s) => s.perform);
  const [objectSheet, setObjectSheet] = useState<ObjectId | null>(null);
  const [help, setHelp] = useState(true);

  const model = useMemo(() => {
    if (!engine || !sim || !venue) return null;
    const layout = engine.layoutOf(venue.id);
    if (!layout) return null;
    const state = engine.state;
    const objects = venue.objectIds
      .map((id) => state.objects[id])
      .filter((o) => o && !o.carriedBy && layout.objects[o.id])
      .map((o) => {
        const def = CONTENT.objects[o.defId];
        return { obj: o, name: o.name ?? def?.name ?? o.defId, icon: def?.icon ?? '▪️', pos: layout.objects[o.id] };
      });
    const controlled = new Set(state.player.controlledSimIds);
    const people = engine
      .ctx()
      .query.simsAt(venue.id)
      .map((s) => ({ sim: s, pos: positionOf(state, layout, s), isPlayer: s.id === sim.id, controlled: controlled.has(s.id) }));
    const me = people.find((p) => p.isPlayer)?.pos ?? positionOf(state, layout, sim);
    const room = layout.rooms.find((r) => r.id === me.roomId);
    const crowd = crowdAt(state, CONTENT, venue.id);
    const extras = extrasAt(layout, crowd, people.map((p) => p.pos), state.time.minute);
    const byRoom = layout.rooms.map((r) => ({ room: r, people: people.filter((p) => !p.isPlayer && p.pos.roomId === r.id), extras: extras.filter((e) => e.roomId === r.id).length, objects: objects.filter((o) => roomAt(layout, o.pos.x, o.pos.y)?.id === r.id) }));
    return { layout, objects, people, me, room, byRoom, crowd, extras };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, sim, venue, version]);

  if (!engine || !sim || !venue || !model) {
    return (
      <Screen padded>
        <EmptyState icon="floor-plan" title="No place to show" body={sim?.travel ? 'You are on the way somewhere.' : 'Load a life first.'} />
      </Screen>
    );
  }
  const { layout, objects, people, me, room, byRoom, crowd, extras } = model;
  const presentIds = new Set(people.map((p) => p.sim.id));
  const seen = new Set<SimId>();
  const staffAndRegulars = [
    ...venue.staffSimIds
      .map((id) => engine.state.sims[id])
      .filter((s) => s && s.body.alive)
      .map((s) => {
        const shifts = s.career.job?.employerVenueId === venue.id ? s.career.job.shifts : [];
        const days = [...new Set(shifts.map((sh) => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][sh.day]))].join(' ');
        const hours = shifts.length ? `${Math.floor(shifts[0].start / 60)}–${Math.floor(shifts[0].end / 60)}h` : '';
        return { sim: s, note: `${s.career.job?.title ?? 'staff'}${days ? ` · ${days} ${hours}` : ''}${presentIds.has(s.id) ? ' · here now' : ''}` };
      }),
    ...venue.regularSimIds
      .filter((id) => !venue.staffSimIds.includes(id))
      .map((id) => engine.state.sims[id])
      .filter((s) => s && s.body.alive && (sim.relationships[s.id]?.familiarity ?? 0) > 0)
      .slice(0, 6)
      .map((s) => ({ sim: s, note: `regular${presentIds.has(s.id) ? ' · here now' : ''}` })),
  ]
    .filter((p) => (seen.has(p.sim.id) ? false : (seen.add(p.sim.id), true)))
    .slice(0, 10);
  const here = people.filter((p) => !p.isPlayer);
  const objectActions = objectSheet ? actions.filter((a) => a.action.target?.kind === 'object' && a.action.target.id === objectSheet) : [];
  const sheetObject = objectSheet ? objects.find((o) => o.obj.id === objectSheet) : undefined;

  const onTapTile = (tile: { x: number; y: number }) => {
    if (busy) return;
    const oid = objectAt(layout, tile.x, tile.y);
    if (oid) {
      setObjectSheet(oid);
      return;
    }
    const who = people.find((p) => !p.isPlayer && p.pos.x === tile.x && p.pos.y === tile.y);
    if (who) {
      onTapSim(who.sim.id);
      return;
    }
    if (extras.some((e) => e.x === tile.x && e.y === tile.y)) {
      onTapExtra(tile);
      return;
    }
    moveTo(tile.x, tile.y);
  };
  const onTapExtra = (tile: { x: number; y: number }) => {
    if (busy) return;
    const cid = meetStranger(tile);
    if (cid) router.push('/(game)/live');
  };
  const onTapSim = (id: SimId) => {
    if (id === sim.id || busy) return;
    haptic.select();
    const cid = startConversation(id, 'in_person');
    if (cid) router.push('/(game)/live');
  };

  return (
    <Screen edges={['top']} gradient={false}>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={ARCHETYPE_ICON[venue.archetype] ?? 'map-marker'} size={22} color={t.colors.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="title" numberOfLines={1}>
              {venue.name}
            </Text>
            <Text variant="caption" muted numberOfLines={1}>
              {room ? `You're ${whereLabel(room)}` : 'Somewhere inside'} · {crowd.count > here.length ? `${crowd.label}, about ${crowd.count} people` : here.length ? `${here.length} ${here.length === 1 ? 'person' : 'people'} here` : 'nobody else here'}
            </Text>
          </View>
          <IconButton icon={help ? 'help-circle' : 'help-circle-outline'} accessibilityLabel="Toggle help" onPress={() => setHelp((v) => !v)} />
        </View>
        {help ? (
          <Text variant="caption" faint>
            Tap a floor tile to walk there. Tap a thing to use it. Tap a person to talk. The small grey figures are the crowd: tap one to pick someone out. Walking across the building takes a minute or two.
          </Text>
        ) : null}
        <View style={{ borderRadius: 14, overflow: 'hidden', backgroundColor: t.colors.background, borderWidth: 1, borderColor: t.colors.border, paddingVertical: 4 }}>
          <PlaceMap layout={layout} objects={objects} sims={people} extras={extras} width={width - 26} onTapTile={onTapTile} onTapObject={(id) => setObjectSheet(id)} onTapSim={onTapSim} onTapExtra={onTapExtra} />
        </View>
        <ChipRow>
          {layout.rooms.map((r) => {
            const inside = me.roomId === r.id;
            return (
              <Chip
                key={r.id}
                label={r.name}
                size="sm"
                selected={inside}
                onPress={() => {
                  if (inside || busy) return;
                  // walk to the middle of the room
                  moveTo(r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2));
                }}
              />
            );
          })}
        </ChipRow>
        {staffAndRegulars.length ? (
          <Card title="Who you'd expect here" icon="account-clock-outline">
            {staffAndRegulars.map((p) => (
              <Text key={p.sim.id} variant="caption" muted numberOfLines={1}>
                {p.sim.identity.firstName} · {p.note}
              </Text>
            ))}
          </Card>
        ) : null}
        {byRoom.map(({ room: r, people: ppl, extras: n, objects: objs }) => (
          <Card key={r.id} title={r.name} subtitle={n ? `${ppl.length ? 'and ' : ''}${n >= 8 ? 'full of people' : n === 1 ? 'someone' : 'a few people'} you don't know` : undefined} icon={me.roomId === r.id ? 'map-marker-account' : undefined}>
            {ppl.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: objs.length ? 8 : 0 }}>
                {ppl.map((p) => (
                  <Chip key={p.sim.id} label={`${p.sim.identity.firstName}${p.sim.currentAction ? ` · ${p.sim.currentAction.label.toLowerCase()}` : ''}`} size="sm" onPress={() => onTapSim(p.sim.id)} />
                ))}
              </View>
            ) : null}
            {objs.length ? (
              <Text variant="caption" muted>
                {objs.map((o) => `${o.icon} ${o.name}`).join(' · ')}
              </Text>
            ) : (
              <Text variant="caption" faint>
                Nothing in here.
              </Text>
            )}
          </Card>
        ))}
      </ScrollView>
      <ActionSheet
        visible={!!objectSheet}
        onClose={() => setObjectSheet(null)}
        actions={objectActions}
        onPerform={(id, params) => {
          setObjectSheet(null);
          const res = perform(id, params);
          if (res?.ok) router.push('/(game)/live');
        }}
        onFreeform={() => {
          setObjectSheet(null);
          if (sheetObject) walkToObject(sheetObject.obj.id);
        }}
      />
    </Screen>
  );
}
