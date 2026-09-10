import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { Relationship, RelationshipFlag } from '@engine/core/types';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Pill } from './Chip';
import { titleCase } from '../format';

const FLAG_COLORS: Partial<Record<RelationshipFlag, string>> = {
  best_friend: '#F5B84A',
  good_friend: '#4CD4A0',
  friend: '#4CD4A0',
  enemy: '#FF6B6B',
  rival: '#FF8A5B',
  crush: '#F28482',
  dating: '#F28482',
  partner: '#F28482',
  engaged: '#F28482',
  married: '#F28482',
  ex: '#9AA6B8',
  affair: '#C2255C',
  blocked: '#FF6B6B',
  boss: '#6EA8FE',
  coworker: '#6EA8FE',
  employee: '#6EA8FE',
};

function Axis({ label, value, color, bipolar = true }: { label: string; value: number; color: string; bipolar?: boolean }): React.ReactElement {
  const t = useTheme();
  const v = Math.max(-100, Math.min(100, value));
  const frac = bipolar ? Math.abs(v) / 100 : v / 100;
  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption" muted>
          {label}
        </Text>
        <Text variant="caption" color={v < 0 ? t.colors.danger : color} weight="600" style={{ fontVariant: ['tabular-nums'] }}>
          {bipolar && v > 0 ? `+${Math.round(v)}` : Math.round(v)}
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceOverlay, overflow: 'hidden', flexDirection: 'row' }}>
        {bipolar ? (
          <>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>{v < 0 ? <View style={{ width: `${frac * 100}%`, height: 6, backgroundColor: t.colors.danger }} /> : null}</View>
            <View style={{ width: 1, backgroundColor: t.colors.borderStrong }} />
            <View style={{ flex: 1 }}>{v > 0 ? <View style={{ width: `${frac * 100}%`, height: 6, backgroundColor: color, borderTopRightRadius: 3, borderBottomRightRadius: 3 }} /> : null}</View>
          </>
        ) : (
          <View style={{ width: `${frac * 100}%`, height: 6, backgroundColor: color, borderRadius: 3 }} />
        )}
      </View>
    </View>
  );
}

export function RelationshipMeter({ rel, compact, style, showFlags = true }: { rel: Relationship | undefined; compact?: boolean; style?: StyleProp<ViewStyle>; showFlags?: boolean }): React.ReactElement {
  const t = useTheme();
  if (!rel) {
    return (
      <View style={style}>
        <Text variant="caption" faint>
          You haven’t met.
        </Text>
      </View>
    );
  }
  if (compact) {
    return (
      <View style={[{ flexDirection: 'row', gap: 10, alignItems: 'center' }, style]}>
        <View style={{ flex: 1, gap: 4 }}>
          <MiniBar value={rel.friendship} color={t.colors.success} />
          <MiniBar value={rel.romance} color="#F28482" />
        </View>
        {showFlags ? (
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {rel.flags.slice(0, 2).map((f) => (
              <Pill key={f} label={titleCase(f)} color={FLAG_COLORS[f] ?? t.colors.textMuted} size="xs" />
            ))}
          </View>
        ) : null}
      </View>
    );
  }
  return (
    <View style={[{ gap: 8 }, style]}>
      <Axis label="Friendship" value={rel.friendship} color={t.colors.success} />
      <Axis label="Romance" value={rel.romance} color="#F28482" />
      <Axis label="Trust" value={rel.trust} color={t.colors.accent2} />
      <Axis label="Familiarity" value={rel.familiarity} color={t.colors.accent} bipolar={false} />
      {showFlags && rel.flags.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
          {rel.flags.map((f) => (
            <Pill key={f} label={titleCase(f)} color={FLAG_COLORS[f] ?? t.colors.textMuted} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function MiniBar({ value, color }: { value: number; color: string }): React.ReactElement {
  const t = useTheme();
  const v = Math.max(-100, Math.min(100, value));
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: t.colors.surfaceOverlay, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: '50%', width: 1, height: 4, backgroundColor: t.colors.borderStrong }} />
      {v >= 0 ? <View style={{ position: 'absolute', left: '50%', width: `${v / 2}%`, height: 4, backgroundColor: color }} /> : <View style={{ position: 'absolute', right: '50%', width: `${-v / 2}%`, height: 4, backgroundColor: t.colors.danger }} />}
    </View>
  );
}

export function relationshipSummary(rel: Relationship | undefined): string {
  if (!rel) return 'Stranger';
  const f = rel.flags;
  const pri: RelationshipFlag[] = ['married', 'engaged', 'partner', 'dating', 'affair', 'crush', 'ex', 'best_friend', 'good_friend', 'friend', 'enemy', 'rival', 'parent', 'child', 'sibling', 'roommate', 'boss', 'coworker', 'neighbor', 'landlord', 'doctor', 'teacher', 'acquaintance'];
  for (const p of pri) if (f.includes(p)) return titleCase(p);
  if (rel.familiarity < 10) return 'Stranger';
  return 'Acquaintance';
}

export default RelationshipMeter;
