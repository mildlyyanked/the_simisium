import React, { useMemo, useState } from 'react';
import { ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';
import { useGame } from '@/store/gameStore';
import { useActions, useActiveSim, useEngine, useVenueOf } from '@/store/selectors';
import type { Venue, VenueId } from '@engine/core/types';
import { haversineKm } from '@engine/core/util';
import { Screen, Text, Button, Chip, ChipRow, Sheet, VenueCard, SectionHeader, KeyValue, Icon, EmptyState, SimAvatar, Pill } from '@/ui/components';
import { ARCHETYPE_GROUP, ARCHETYPE_ICON, GROUP_ORDER, TRAVEL_ICON, TRAVEL_LABEL, type ArchetypeGroup } from '@/ui/icons';
import { useTheme } from '@/ui/theme';
import { duration, hoursByDay, km, openStatus, priceLevel } from '@/ui/format';

type Filter = 'all' | 'open' | 'nearby' | 'favorites';

function Radar({ venues, center, hereId, onPick, selectedId }: { venues: Venue[]; center: Venue; hereId: VenueId; onPick: (id: VenueId) => void; selectedId: VenueId | null }): React.ReactElement {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const size = Math.min(width - 32, 360);
  const r = size / 2;
  const maxKm = Math.max(1.5, ...venues.map((v) => haversineKm(center.location, v.location)));
  const pts = venues.map((v) => {
    const dLat = v.location.lat - center.location.lat;
    const dLng = (v.location.lng - center.location.lng) * Math.cos((center.location.lat * Math.PI) / 180);
    const d = haversineKm(center.location, v.location);
    const ang = Math.atan2(dLng, dLat);
    const rr = Math.sqrt(Math.min(1, d / maxKm)) * (r - 14);
    return { v, x: r + Math.sin(ang) * rr, y: r - Math.cos(ang) * rr, d };
  });
  return (
    <View style={{ alignItems: 'center', marginVertical: 6 }}>
      <Svg width={size} height={size}>
        {[0.33, 0.66, 1].map((k) => (
          <Circle key={k} cx={r} cy={r} r={(r - 14) * k} stroke={t.colors.border} strokeWidth={1} fill="none" />
        ))}
        <Line x1={r} y1={14} x2={r} y2={size - 14} stroke={t.colors.border} strokeWidth={1} />
        <Line x1={14} y1={r} x2={size - 14} y2={r} stroke={t.colors.border} strokeWidth={1} />
        <SvgText x={r} y={11} fill={t.colors.textFaint} fontSize={9} textAnchor="middle">
          N
        </SvgText>
        {pts.map(({ v, x, y }) => {
          const sel = v.id === selectedId;
          const here = v.id === hereId;
          return (
            <G key={v.id} onPress={() => onPick(v.id)}>
              <Circle cx={x} cy={y} r={sel ? 9 : here ? 8 : 5.5} fill={here ? t.colors.accent : sel ? t.colors.text : v.discovered ? t.colors.textMuted : t.colors.surfaceOverlay} opacity={v.discovered ? 1 : 0.6} />
              {sel || here ? (
                <SvgText x={x} y={y - 12} fill={t.colors.text} fontSize={10} textAnchor="middle">
                  {v.name.length > 22 ? `${v.name.slice(0, 21)}…` : v.name}
                </SvgText>
              ) : null}
            </G>
          );
        })}
      </Svg>
      <Text variant="caption" faint>
        Outer ring ≈ {km(maxKm)} · you are the amber dot
      </Text>
    </View>
  );
}

export default function MapScreen(): React.ReactElement {
  const t = useTheme();
  const engine = useEngine();
  const sim = useActiveSim();
  const here = useVenueOf(sim);
  const actions = useActions();
  const perform = useGame((s) => s.perform);
  const toggleFavorite = useGame((s) => s.toggleFavorite);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [group, setGroup] = useState<ArchetypeGroup | 'All'>('All');
  const [selected, setSelected] = useState<VenueId | null>(null);
  const [showRadar, setShowRadar] = useState(true);

  const venues = useMemo(() => {
    if (!engine || !here) return [] as (Venue & { d: number })[];
    const favs = new Set(engine.state.player.favorites);
    const q = query.trim().toLowerCase();
    const list = Object.values(engine.state.venues)
      .filter((v) => v.archetype !== 'home' || v.ownerHouseholdId === engine.state.player.householdId)
      .filter((v) => v.discovered || q.length >= 2)
      .filter((v) => !q || v.name.toLowerCase().includes(q) || v.archetype.replace(/_/g, ' ').includes(q))
      .filter((v) => group === 'All' || ARCHETYPE_GROUP[v.archetype] === group)
      .map((v) => Object.assign({ d: haversineKm(here.location, v.location) }, v))
      .filter((v) => (filter === 'open' ? engine.ctx().query.isVenueOpen(v.id) : filter === 'favorites' ? favs.has(v.id) : filter === 'nearby' ? v.d <= 2.5 : true))
      .sort((a, b) => a.d - b.d);
    return list;
  }, [engine, here, query, filter, group, useGame.getState().version]);

  if (!engine || !sim || !here) {
    return (
      <Screen padded>
        <EmptyState icon="map-outline" title="No world loaded" />
      </Screen>
    );
  }
  const sel = selected ? engine.state.venues[selected] : undefined;
  const travelActions = sel ? actions.filter((a) => a.action.id.startsWith(`travel:${sel.id}:`)) : [];
  const known = sel ? engine.ctx().query.simsAt(sel.id).filter((s) => s.id !== sim.id && sim.relationships[s.id]) : [];
  const staff = sel ? sel.staffSimIds.map((id) => engine.state.sims[id]).filter((s) => s && sim.relationships[s.id]) : [];
  const isFav = sel ? engine.state.player.favorites.includes(sel.id) : false;
  const groups = ['All', ...GROUP_ORDER] as (ArchetypeGroup | 'All')[];

  return (
    <Screen edges={['top']} gradient={false}>
      <View style={{ paddingHorizontal: 14, paddingTop: 8, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, paddingHorizontal: 10 }}>
            <Icon name="magnify" size={18} color={t.colors.textMuted} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Find a place" placeholderTextColor={t.colors.textFaint} style={{ flex: 1, color: t.colors.text, paddingVertical: 8, fontSize: 15 }} accessibilityLabel="Find a place" />
          </View>
          <Button title={showRadar ? 'List' : 'Radar'} size="sm" variant="secondary" icon={showRadar ? 'view-list' : 'radar'} onPress={() => setShowRadar((v) => !v)} />
        </View>
        <ChipRow>
          {(['all', 'open', 'nearby', 'favorites'] as Filter[]).map((f) => (
            <Chip key={f} label={f === 'all' ? 'All' : f === 'open' ? 'Open now' : f === 'nearby' ? 'Walkable' : 'Favorites'} size="sm" selected={filter === f} onPress={() => setFilter(f)} />
          ))}
        </ChipRow>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {groups.map((g) => (
            <Chip key={g} label={g} size="sm" selected={group === g} onPress={() => setGroup(g)} />
          ))}
        </ScrollView>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        {showRadar && venues.length ? <Radar venues={venues.slice(0, 60)} center={here} hereId={here.id} selectedId={selected} onPick={setSelected} /> : null}
        {venues.length === 0 ? <EmptyState icon="map-search-outline" title="Nothing here yet" body="Places appear on the map as you discover them. Type two letters to search everything in town." compact /> : null}
        {venues.slice(0, 80).map((v) => (
          <VenueCard key={v.id} venue={v} epoch={engine.state.epoch} minute={engine.state.time.minute} isOpen={engine.ctx().query.isVenueOpen(v.id)} distanceKm={v.d} favorite={engine.state.player.favorites.includes(v.id)} here={v.id === here.id} onPress={() => setSelected(v.id)} onFavorite={() => toggleFavorite(v.id)} style={{ marginBottom: 8 }} compact knownCount={Object.keys(sim.relationships).filter((id) => v.staffSimIds.includes(id as never) || v.regularSimIds.includes(id as never)).length} />
        ))}
      </ScrollView>

      <Sheet visible={!!sel} onClose={() => setSelected(null)} title={sel?.name} subtitle={sel ? `${sel.archetype.replace(/_/g, ' ')} · ${km(haversineKm(here.location, sel.location))} away` : undefined} headerRight={sel ? <Button title={isFav ? 'Saved' : 'Save'} size="sm" variant={isFav ? 'secondary' : 'ghost'} icon={isFav ? 'heart' : 'heart-outline'} onPress={() => toggleFavorite(sel.id)} /> : null}>
        {sel ? (
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Icon name={ARCHETYPE_ICON[sel.archetype]} size={22} color={t.colors.accent} />
              {sel.google?.rating ? <Pill label={`★ ${sel.google.rating.toFixed(1)} · ${sel.google.userRatingCount ?? 0}`} color={t.colors.accent} /> : null}
              {sel.google?.priceLevel !== undefined ? <Pill label={priceLevel(sel.google.priceLevel)} /> : null}
              {(() => {
                const s = openStatus(sel.google?.openingPeriods, engine.state.epoch, engine.state.time.minute, engine.ctx().query.isVenueOpen(sel.id));
                return <Pill label={s.label} color={s.open ? t.colors.success : t.colors.danger} />;
              })()}
              {sel.tags.includes('holiday_closed') ? <Pill label="Closed for the holiday" color={t.colors.warning} /> : null}
            </View>
            {sel.description || sel.google?.editorialSummary ? (
              <Text variant="prose">{sel.description ?? sel.google?.editorialSummary}</Text>
            ) : null}
            {sel.google?.reviewSnippets?.length ? (
              <View style={{ gap: 6 }}>
                <Text variant="label" faint>
                  What people say
                </Text>
                {sel.google.reviewSnippets.slice(0, 3).map((r, i) => (
                  <Text key={i} variant="caption" muted>
                    “{r}”
                  </Text>
                ))}
                {sel.google.reviewThemes?.length ? (
                  <ChipRow>
                    {sel.google.reviewThemes.slice(0, 5).map((th) => (
                      <Chip key={th} label={th} size="sm" />
                    ))}
                  </ChipRow>
                ) : null}
              </View>
            ) : null}
            {sel.id !== here.id ? (
              <View style={{ gap: 8 }}>
                <SectionHeader title="Go here" />
                {travelActions.length === 0 ? (
                  <Text variant="caption" muted>
                    No way to get there right now.
                  </Text>
                ) : (
                  travelActions.map(({ action, available, reasons }) => {
                    const mode = action.id.split(':')[2] as keyof typeof TRAVEL_ICON;
                    return (
                      <Button
                        key={action.id}
                        title={`${TRAVEL_LABEL[mode] ?? mode} · ${duration(action.durationMinutes)}${action.cost?.amount ? ` · $${action.cost.amount.toFixed(2)}` : ''}${!available ? ` — ${reasons[0]}` : ''}`}
                        icon={TRAVEL_ICON[mode]}
                        variant={available ? 'primary' : 'outline'}
                        disabled={!available}
                        full
                        onPress={() => {
                          setSelected(null);
                          perform(action.id);
                        }}
                      />
                    );
                  })
                )}
              </View>
            ) : (
              <Pill label="You are here" color={t.colors.accent} />
            )}
            {known.length || staff.length ? (
              <View style={{ gap: 8 }}>
                <SectionHeader title="People you know here" />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {[...new Map([...known, ...staff].map((s) => [s.id, s])).values()].slice(0, 8).map((s) => (
                    <View key={s.id} style={{ alignItems: 'center', width: 64 }}>
                      <SimAvatar sim={s} size={44} />
                      <Text variant="caption" numberOfLines={1}>
                        {s.identity.firstName}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            {sel.google?.openingPeriods?.length ? (
              <View>
                <SectionHeader title="Hours" />
                {hoursByDay(sel.google.openingPeriods).map((h, i, arr) => (
                  <KeyValue key={h.day} label={h.day} value={h.hours} last={i === arr.length - 1} />
                ))}
              </View>
            ) : null}
            {sel.google?.formattedAddress || sel.google?.phone || sel.google?.website ? (
              <View>
                <SectionHeader title="Details" />
                {sel.google?.formattedAddress ? <KeyValue label="Address" value={sel.google.formattedAddress} /> : null}
                {sel.google?.phone ? <KeyValue label="Phone" value={sel.google.phone} /> : null}
                {sel.google?.website ? <KeyValue label="Web" value={sel.google.website.replace(/^https?:\/\//, '')} last /> : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
