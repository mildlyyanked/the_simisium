import React, { useMemo, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import Svg, { Path, Line } from 'react-native-svg';
import { useGame } from '@/store/gameStore';
import { useActiveSim, useEngine } from '@/store/selectors';
import { netWorth } from '@/store/selectors';
import type { LogEntry } from '@engine/core/types';
import { Screen, Text, Card, Chip, ChipRow, Stat, StatRow, EmptyState, MoneyText, KeyValue, SimAvatar } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { clockShort, dayLabel, dayNumber, money } from '@/ui/format';

type Filter = 'all' | 'money' | 'people' | 'work' | 'alerts';

function Sparkline({ points, color }: { points: number[]; color: string }): React.ReactElement | null {
  const { width } = useWindowDimensions();
  const t = useTheme();
  const w = Math.min(width - 60, 380);
  const h = 64;
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((p - min) / span) * (h - 8) - 4).toFixed(1)}`).join(' ');
  const zeroY = h - ((0 - min) / span) * (h - 8) - 4;
  return (
    <Svg width={w} height={h}>
      {min < 0 && max > 0 ? <Line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke={t.colors.border} strokeWidth={1} /> : null}
      <Path d={d} stroke={color} strokeWidth={2} fill="none" />
    </Svg>
  );
}

export default function JournalScreen(): React.ReactElement {
  const t = useTheme();
  const engine = useEngine();
  const sim = useActiveSim();
  const usage = useGame((s) => s.llmUsage);
  const [filter, setFilter] = useState<Filter>('all');
  const entries = useMemo(() => {
    if (!engine) return [] as LogEntry[];
    const pass = (e: LogEntry) => {
      if (e.importance < 2 && e.kind !== 'money' && e.kind !== 'relationship') return false;
      switch (filter) {
        case 'money': return e.kind === 'money' || /\$/.test(e.text);
        case 'people': return e.kind === 'relationship' || e.kind === 'dialogue' || /met|friend|date|kiss|married|broke up|text/i.test(e.text);
        case 'work': return /shift|job|work|promot|fired|hired|interview|raise|review/i.test(e.text);
        case 'alerts': return e.kind === 'alert';
        default: return true;
      }
    };
    return engine.state.log.filter(pass).slice(-120).reverse();
  }, [engine, filter, useGame.getState().version]);

  if (!engine || !sim) {
    return (
      <Screen padded>
        <EmptyState icon="notebook-outline" title="No world loaded" />
      </Screen>
    );
  }
  const st = engine.state.stats;
  const nw = sim.finance.netWorthHistory.map((p) => p.value);
  const currentNw = netWorth(sim, engine.state);
  const days = Math.floor(engine.state.time.minute / 1440) + 1;
  let lastDay = -1;

  return (
    <Screen edges={['top']} gradient={false}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <SimAvatar sim={sim} size={48} ring={t.colors.accent} />
          <View style={{ flex: 1 }}>
            <Text variant="title">{engine.state.meta.name}</Text>
            <Text variant="caption" muted>
              Day {days} · {engine.state.region.name}, {engine.state.region.stateCode} · {engine.clock.dateLabel}
            </Text>
          </View>
        </View>
        <Card>
          <StatRow>
            <Stat label="Day" value={days} icon="calendar" size="sm" />
            <Stat label="Met" value={st.simsMet} icon="account-multiple" size="sm" />
            <Stat label="Places" value={st.placesVisited} icon="map-marker" size="sm" />
            <Stat label="Talks" value={st.conversations} icon="chat" size="sm" />
          </StatRow>
          <View style={{ marginTop: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <Text variant="label" faint>
                Net worth
              </Text>
              <MoneyText amount={currentNw} variant="heading" cents={false} />
            </View>
            <Sparkline points={nw.length >= 2 ? nw : [currentNw, currentNw]} color={currentNw >= 0 ? t.colors.success : t.colors.danger} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="caption" faint>
                earned {money(st.moneyEarned, { cents: false })}
              </Text>
              <Text variant="caption" faint>
                spent {money(st.moneySpent, { cents: false })}
              </Text>
            </View>
          </View>
        </Card>
        <ChipRow>
          {(['all', 'money', 'people', 'work', 'alerts'] as Filter[]).map((f) => (
            <Chip key={f} label={f[0].toUpperCase() + f.slice(1)} size="sm" selected={filter === f} onPress={() => setFilter(f)} />
          ))}
        </ChipRow>
        {entries.length === 0 ? <EmptyState icon="feather" title="Nothing written yet" body="Important moments land here as you live them." compact /> : null}
        {entries.map((e) => {
          const d = dayNumber(e.at);
          const header = d !== lastDay;
          lastDay = d;
          return (
            <View key={e.id}>
              {header ? (
                <Text variant="label" faint style={{ marginTop: 6, marginBottom: 6 }}>
                  {dayLabel(engine.state.epoch, e.at)}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
                <Text variant="caption" faint style={{ width: 58, paddingTop: 2 }}>
                  {clockShort(e.at)}
                </Text>
                <View style={{ flex: 1, borderLeftWidth: 2, borderLeftColor: e.kind === 'alert' ? t.colors.danger : e.kind === 'money' ? t.colors.success : e.importance >= 3 ? t.colors.accent : t.colors.border, paddingLeft: 10 }}>
                  <Text variant={e.importance >= 3 ? 'bodyStrong' : 'body'}>{e.text}</Text>
                </View>
              </View>
            </View>
          );
        })}
        <Card title="Behind the curtain" icon="robot-outline">
          <KeyValue label="LLM calls this save" value={String(engine.state.meta.llmCalls)} />
          <KeyValue label="Estimated spend" value={money(engine.state.meta.llmCostUsd)} />
          <KeyValue label="This session" value={`${usage.calls} calls · ${money(usage.costUsd)}`} />
          <KeyValue label="Seed" value={engine.state.meta.seed} last />
        </Card>
      </ScrollView>
    </Screen>
  );
}
