import React, { useMemo, useState } from 'react';
import { Image, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';
import { useGame } from '@/store/gameStore';
import { useSettings } from '@/store/settings';
import { useActions, useActiveSim, useEngine, useVenueOf } from '@/store/selectors';
import type { Venue, VenueId } from '@engine/core/types';
import { haversineKm } from '@engine/core/util';
import { Screen, Text, Button, Chip, ChipRow, Sheet, VenueCard, SectionHeader, KeyValue, Icon, EmptyState, SimAvatar, Pill } from '@/ui/components';
import { ARCHETYPE_GROUP, ARCHETYPE_ICON, GROUP_ORDER, TRAVEL_ICON, TRAVEL_LABEL, type ArchetypeGroup } from '@/ui/icons';
import { useTheme } from '@/ui/theme';
import { duration, hoursByDay, km, openStatus, priceLevel } from '@/ui/format';

type Filter = 'all' | 'open' | 'nearby' | 'favorites';

/** Web Mercator pixel coordinates at a zoom level (256px world tiles). */
function mercator(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
  return { x, y };
}

const STATIC_STYLE = [
  'element:geometry|color:0x141a27',
  'element:labels.text.fill|color:0x8b97aa',
  'element:labels.text.stroke|color:0x0b0e14',
  'feature:road|element:geometry|color:0x2a3346',
  'feature:road.arterial|element:geometry|color:0x334159',
  'feature:road.highway|element:geometry|color:0x3d4d6b',
  'feature:water|element:geometry|color:0x0f1a2b',
  'feature:landscape.natural|element:geometry|color:0x172230',
  'feature:poi|visibility:off',
  'feature:transit|visibility:off',
]
  .map((x) => `style=${encodeURIComponent(x)}`)
  .join('&');

/**
 * The neighbourhood: real streets from Google's Static Maps API underneath when a key is set
 * (one cached image per view), otherwise a bearing/distance radar. Markers are projected the
 * same way in both cases so the amber dot is always you.
 */
function Radar({ venues, center, hereId, onPick, selectedId, mapKey }: { venues: Venue[]; center: Venue; hereId: VenueId; onPick: (id: VenueId) => void; selectedId: VenueId | null; mapKey?: string }): React.ReactElement {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const [imgFailed, setImgFailed] = useState(false);
  const size = Math.min(width - 32, 360);
  const r = size / 2;
  const maxKm = Math.max(1.5, ...venues.map((v) => haversineKm(center.location, v.location)));
  const useMap = !!mapKey && !imgFailed;
  // zoom so the farthest place still fits inside the circle
  const metersPerPxWanted = (maxKm * 1000) / (r - 14);
  const zoom = Math.max(10, Math.min(17, Math.floor(Math.log2((156543.03392 * Math.cos((center.location.lat * Math.PI) / 180)) / metersPerPxWanted))));
  const c = mercator(center.location.lat, center.location.lng, zoom);
  const pts = venues.map((v) => {
    const d = haversineKm(center.location, v.location);
    if (useMap) {
      const p = mercator(v.location.lat, v.location.lng, zoom);
      return { v, x: r + (p.x - c.x), y: r + (p.y - c.y), d };
    }
    const dLat = v.location.lat - center.location.lat;
    const dLng = (v.location.lng - center.location.lng) * Math.cos((center.location.lat * Math.PI) / 180);
    const ang = Math.atan2(dLng, dLat);
    const rr = Math.sqrt(Math.min(1, d / maxKm)) * (r - 14);
    return { v, x: r + Math.sin(ang) * rr, y: r - Math.cos(ang) * rr, d };
  });
  const imgSize = Math.min(640, Math.round(size));
  const url = useMap ? `https://maps.googleapis.com/maps/api/staticmap?center=${center.location.lat},${center.location.lng}&zoom=${zoom}&size=${imgSize}x${imgSize}&scale=2&maptype=roadmap&${STATIC_STYLE}&key=${mapKey}` : undefined;
  return (
    <View style={{ alignItems: 'center', marginVertical: 6 }}>
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: t.colors.background }}>
        {url ? <Image source={{ uri: url }} style={{ position: 'absolute', width: size, height: size, opacity: 0.9 }} onError={() => setImgFailed(true)} accessibilityIgnoresInvertColors /> : null}
        <Svg width={size} height={size}>
          {!useMap
            ? [0.33, 0.66, 1].map((k) => <Circle key={k} cx={r} cy={r} r={(r - 14) * k} stroke={t.colors.border} strokeWidth={1} fill="none" />)
            : <Circle cx={r} cy={r} r={r - 1} stroke={t.colors.border} strokeWidth={1.5} fill="none" />}
          {!useMap ? <Line x1={r} y1={14} x2={r} y2={size - 14} stroke={t.colors.border} strokeWidth={1} /> : null}
          {!useMap ? <Line x1={14} y1={r} x2={size - 14} y2={r} stroke={t.colors.border} strokeWidth={1} /> : null}
          <SvgText x={r} y={11} fill={t.colors.textFaint} fontSize={9} textAnchor="middle">
            N
          </SvgText>
          {pts.map(({ v, x, y }) => {
            if (x < 6 || y < 6 || x > size - 6 || y > size - 6) return null;
            const sel = v.id === selectedId;
            const here = v.id === hereId;
            return (
              <G key={v.id} onPress={() => onPick(v.id)}>
                {useMap ? <Circle cx={x} cy={y} r={sel ? 12 : here ? 11 : 8.5} fill={t.colors.background} opacity={0.75} /> : null}
                <Circle cx={x} cy={y} r={sel ? 9 : here ? 8 : 5.5} fill={here ? t.colors.accent : sel ? t.colors.text : v.discovered ? t.colors.textMuted : t.colors.surfaceOverlay} opacity={v.discovered || here || sel ? 1 : 0.6} />
                {sel || here ? (
                  <SvgText x={x} y={y - 12} fill={t.colors.text} fontSize={10} textAnchor="middle">
                    {v.name.length > 22 ? `${v.name.slice(0, 21)}…` : v.name}
                  </SvgText>
                ) : null}
              </G>
            );
          })}
        </Svg>
      </View>
      <Text variant="caption" faint style={{ marginTop: 4 }}>
        {useMap ? `Map data ©Google · circle ≈ ${km(maxKm)} across from you` : `Outer ring ≈ ${km(maxKm)} · you are the amber dot`}
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
  const mapKey = useSettings((st) => st.googlePlacesKey);
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
  const carElsewhere = useMemo(() => {
    if (!engine || !sim || !sel) return null;
    const hh = sim.householdId ? engine.state.households[sim.householdId] : undefined;
    if (!hh) return null;
    const car = hh.vehicleIds.map((id) => engine.state.vehicles[id]).find((v) => v && (v.kind === 'car' || v.kind === 'suv' || v.kind === 'truck' || v.kind === 'van') && v.location.venueId !== sim.location.venueId);
    if (!car) return null;
    return { vehicle: `${car.make} ${car.model}`, where: engine.state.venues[car.location.venueId]?.name ?? 'somewhere else' };
  }, [engine, sim, sel]);
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
        {showRadar && venues.length ? <Radar venues={venues.slice(0, 60)} center={here} hereId={here.id} selectedId={selected} onPick={setSelected} mapKey={mapKey || undefined} /> : null}
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
                {carElsewhere ? (
                  <Text variant="caption" faint style={{ marginBottom: 6 }}>
                    Your {carElsewhere.vehicle} is parked at {carElsewhere.where}. Get back to it to drive.
                  </Text>
                ) : null}
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
