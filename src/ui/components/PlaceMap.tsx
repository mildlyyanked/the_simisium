/**
 * Top-down tile map of the venue the active sim is in: rooms, walls, doors, objects (emoji) and
 * people (avatars). Tap a floor tile to walk there, an object to use it, a person to talk.
 */
import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text as RNText, View, type GestureResponderEvent } from 'react-native';
import Svg, { Rect, G } from 'react-native-svg';
import type { ObjectInstance, Sim, SimId, VenueLayout, ObjectId } from '@engine/core/types';
import { gridOf, type Tile } from '@engine/space/nav';
import { SimAvatar } from '../avatar/Avatar';
import { useTheme } from '../theme';

export interface PlaceMapProps {
  layout: VenueLayout;
  objects: { obj: ObjectInstance; name: string; icon: string; pos: Tile }[];
  sims: { sim: Sim; pos: Tile; isPlayer: boolean; controlled: boolean }[];
  /** tile the player is walking to, drawn as a target */
  target?: Tile | null;
  /** the anonymous crowd: figures with no name until the player picks one out */
  extras?: (Tile & { seed: number })[];
  onTapTile?: (tile: Tile) => void;
  onTapObject?: (id: ObjectId) => void;
  onTapSim?: (id: SimId) => void;
  onTapExtra?: (tile: Tile) => void;
  /** available width in px */
  width: number;
  maxHeight?: number;
}

const ROOM_HUES: [RegExp, string][] = [
  [/bath|restroom|toilet|shower|locker/, '#1E3A48'],
  [/bed|dorm|cell|holding|room\b|ward/, '#2B2F55'],
  [/kitchen|deli|food|counter|bar\b|café|cafe/, '#4A3324'],
  [/living|lounge|lobby|waiting|seating|reading|fellowship|hall|concourse/, '#2F3A2A'],
  [/office|clerk|booking|intake|conference|classroom|lab|computers|break/, '#33333F'],
  [/yard|patio|grounds|trail|playground|quad|courtyard|garden|field|pool|balcony/, '#1F4A2E'],
  [/aisle|produce|stall|sales|floor|checkout|anchor|stack|galler|exhibit|auditor|sanctuary|court|gym|cardio|weights|studio|boulder|rope|training|lanes|range|rink|track|garage|bay/, '#3A2E4A'],
];

function roomFill(name: string, index: number): string {
  const n = name.toLowerCase();
  for (const [re, c] of ROOM_HUES) if (re.test(n)) return c;
  const palette = ['#2A3040', '#2E3A3A', '#3A2E3A', '#333A2E'];
  return palette[index % palette.length];
}

const EXTRA_TONES = ['#6B7A90', '#7A6B90', '#907A6B', '#6B9080', '#8A8A6B', '#6B7F90'];

export function PlaceMap({ layout, objects, sims, target, extras = [], onTapTile, onTapObject, onTapSim, onTapExtra, width, maxHeight = 520 }: PlaceMapProps): React.ReactElement {
  const t = useTheme();
  const tile = Math.max(16, Math.min(36, Math.floor((width - 8) / layout.width)));
  const W = layout.width * tile;
  const H = layout.height * tile;
  const grid = useMemo(() => gridOf(layout), [layout, objects.length]);

  const onPress = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    const x = Math.floor(locationX / tile);
    const y = Math.floor(locationY / tile);
    if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) return;
    onTapTile?.({ x, y });
  };

  // group people standing on the same tile so they fan out a little
  const stacks = new Map<string, number>();

  const body = (
    <View style={{ width: W, height: H }}>
      <Pressable onPress={onPress} accessibilityLabel="Floor plan" style={{ width: W, height: H }}>
        <Svg width={W} height={H}>
          {layout.rooms.map((r, i) => (
            <G key={r.id}>
              <Rect x={r.x * tile} y={r.y * tile} width={r.w * tile} height={r.h * tile} fill={roomFill(r.name, i)} />
            </G>
          ))}
          {/* floor grid */}
          {grid.map((row, y) =>
            row.map((c, x) => {
              if (c === 'floor' || c === 'object') return <Rect key={`${x},${y}`} x={x * tile + 0.5} y={y * tile + 0.5} width={tile - 1} height={tile - 1} fill="#FFFFFF" opacity={0.035} />;
              if (c === 'wall') return <Rect key={`${x},${y}`} x={x * tile} y={y * tile} width={tile} height={tile} fill="#0B0E14" />;
              if (c === 'door') return <Rect key={`${x},${y}`} x={x * tile} y={y * tile} width={tile} height={tile} fill="#0B0E14" />;
              return null;
            }),
          )}
          {layout.doors.map((d) => (
            <Rect key={`d${d.x},${d.y}`} x={d.x * tile + tile * 0.15} y={d.y * tile + tile * 0.15} width={tile * 0.7} height={tile * 0.7} rx={3} fill={t.colors.surfaceOverlay} />
          ))}
          <Rect x={layout.entrance.x * tile + tile * 0.15} y={layout.entrance.y * tile + tile * 0.15} width={tile * 0.7} height={tile * 0.7} rx={3} fill={t.colors.accent} opacity={0.85} />
          {target ? <Rect x={target.x * tile + 2} y={target.y * tile + 2} width={tile - 4} height={tile - 4} rx={4} fill="none" stroke={t.colors.accent} strokeWidth={2} strokeDasharray="4 3" /> : null}
        </Svg>
      </Pressable>
      {layout.rooms.map((r) => (
        <View key={`label-${r.id}`} pointerEvents="none" style={{ position: 'absolute', left: r.x * tile + tile * 0.6, top: r.y * tile + tile * 0.55, backgroundColor: 'rgba(11,14,20,0.72)', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, zIndex: 4 }}>
          <RNText style={{ color: t.colors.textMuted, fontSize: Math.max(8, Math.min(11, tile * 0.38)), fontWeight: '700', letterSpacing: 0.5 }}>{r.name.toUpperCase()}</RNText>
        </View>
      ))}
      {objects.map(({ obj, name, icon, pos }) => (
        <Pressable
          key={obj.id}
          onPress={() => onTapObject?.(obj.id)}
          accessibilityRole="button"
          accessibilityLabel={name}
          style={{ position: 'absolute', left: pos.x * tile + 1, top: pos.y * tile + 1, width: tile - 2, height: tile - 2, borderRadius: 5, backgroundColor: obj.state.broken ? '#4A2A2A' : t.colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', borderWidth: obj.state.occupiedBy ? 1 : 0, borderColor: t.colors.accent }}
        >
          <RNText style={{ fontSize: Math.max(10, tile * 0.6), lineHeight: Math.max(12, tile * 0.75) }} accessible={false}>
            {icon}
          </RNText>
        </Pressable>
      ))}
      {extras.map((e) => {
        const size = Math.round(tile * 0.62);
        const dx = ((e.seed % 7) - 3) * (tile * 0.05);
        const dy = (((e.seed >> 3) % 7) - 3) * (tile * 0.05);
        return (
          <Pressable
            key={`x${e.x},${e.y}`}
            onPress={() => onTapExtra?.({ x: e.x, y: e.y })}
            accessibilityRole="button"
            accessibilityLabel="Someone in the crowd"
            style={{ position: 'absolute', left: e.x * tile + (tile - size) / 2 + dx, top: e.y * tile + (tile - size) / 2 + dy, width: size, height: size, borderRadius: size / 2, backgroundColor: EXTRA_TONES[e.seed % EXTRA_TONES.length], opacity: 0.8, borderWidth: 1, borderColor: 'rgba(11,14,20,0.6)', zIndex: 1 }}
          />
        );
      })}
      {sims.map(({ sim, pos, isPlayer, controlled }) => {
        const key = `${pos.x},${pos.y}`;
        const n = stacks.get(key) ?? 0;
        stacks.set(key, n + 1);
        const size = Math.round(tile * 1.15);
        const left = pos.x * tile + (tile - size) / 2 + n * 6;
        const top = pos.y * tile + (tile - size) / 2 - n * 4;
        return (
          <Pressable key={sim.id} onPress={() => onTapSim?.(sim.id)} accessibilityRole="button" accessibilityLabel={isPlayer ? 'You' : sim.identity.firstName} style={{ position: 'absolute', left, top, alignItems: 'center', zIndex: isPlayer ? 3 : 2 }}>
            <SimAvatar sim={sim} size={size} ring={isPlayer ? t.colors.accent : controlled ? t.colors.success : t.colors.border} ringWidth={isPlayer ? 2.5 : 1.5} />
            <RNText numberOfLines={1} style={{ color: isPlayer ? t.colors.accent : t.colors.text, fontSize: Math.max(8, Math.min(11, tile * 0.42)), fontWeight: '700', backgroundColor: 'rgba(11,14,20,0.75)', paddingHorizontal: 3, borderRadius: 3, marginTop: -2, maxWidth: tile * 3 }}>
              {isPlayer ? 'You' : sim.identity.firstName}
            </RNText>
          </Pressable>
        );
      })}
    </View>
  );

  const needsScroll = W > width || H > maxHeight;
  if (!needsScroll) return <View style={{ alignItems: 'center' }}>{body}</View>;
  return (
    <ScrollView horizontal={W > width} style={{ maxHeight }} contentContainerStyle={{ padding: 2 }} showsHorizontalScrollIndicator={false}>
      <ScrollView style={{ maxHeight }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
        {body}
      </ScrollView>
    </ScrollView>
  );
}
