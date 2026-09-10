import React, { memo, useMemo } from 'react';
import { FlatList, View, type ListRenderItemInfo } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { LogEntry, Sim, SimId, WorldState } from '@engine/core/types';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon } from '../icons';
import { SimAvatar } from '../avatar/Avatar';
import { clockShort, dayLabel, dayNumber } from '../format';

type FeedItem = { type: 'entry'; entry: LogEntry; showTime: boolean; key: string } | { type: 'day'; label: string; day: number; key: string };

const KIND_META: Partial<Record<LogEntry['kind'], { icon: string; color: string }>> = {
  system: { icon: 'information-outline', color: '#9AA6B8' },
  money: { icon: 'currency-usd', color: '#4CD4A0' },
  relationship: { icon: 'heart', color: '#F28482' },
  alert: { icon: 'alert', color: '#FF6B6B' },
  need: { icon: 'alert-circle', color: '#FFB454' },
  event: { icon: 'calendar-star', color: '#F5B84A' },
  travel: { icon: 'map-marker', color: '#6EA8FE' },
  phone: { icon: 'cellphone', color: '#6EA8FE' },
};

export function buildFeed(log: LogEntry[], epoch: string, filter?: (e: LogEntry) => boolean): FeedItem[] {
  const items: FeedItem[] = [];
  let lastDay = -1;
  let lastAt = -Infinity;
  for (const e of log) {
    if (filter && !filter(e)) continue;
    if (e.importance <= 0) continue;
    const d = dayNumber(e.at);
    if (d !== lastDay) {
      items.push({ type: 'day', label: dayLabel(epoch, e.at), day: d, key: `day_${d}` });
      lastDay = d;
      lastAt = -Infinity;
    }
    const showTime = e.at - lastAt >= 20;
    items.push({ type: 'entry', entry: e, showTime, key: e.id });
    lastAt = e.at;
  }
  return items;
}

const Entry = memo(function Entry({ entry, showTime, state, controlled, recent }: { entry: LogEntry; showTime: boolean; state: WorldState; controlled: Set<SimId>; recent: boolean }): React.ReactElement {
  const t = useTheme();
  const time = showTime ? (
    <Text variant="caption" faint style={{ marginBottom: 4, marginTop: 6, fontVariant: ['tabular-nums'] }}>
      {clockShort(entry.at)}
    </Text>
  ) : null;
  const Wrapper = recent ? Animated.View : View;
  const wrapperProps = recent ? { entering: FadeInDown.duration(260) } : {};

  if (entry.kind === 'dialogue') {
    const speaker: Sim | undefined = entry.speakerId ? state.sims[entry.speakerId] : undefined;
    const mine = !!entry.speakerId && controlled.has(entry.speakerId);
    return (
      <Wrapper {...wrapperProps} style={{ paddingHorizontal: 14 }}>
        {time}
        <View style={{ flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8, marginVertical: 3 }}>
          {speaker ? <SimAvatar sim={speaker} size={28} /> : <View style={{ width: 28 }} />}
          <View style={{ maxWidth: '82%' }}>
            {!mine && speaker ? (
              <Text variant="caption" muted style={{ marginBottom: 2, marginLeft: 6 }}>
                {speaker.identity.firstName}
              </Text>
            ) : null}
            <View
              style={{
                backgroundColor: mine ? t.colors.accent : t.colors.surfaceRaised,
                borderRadius: 18,
                borderBottomRightRadius: mine ? 6 : 18,
                borderBottomLeftRadius: mine ? 18 : 6,
                paddingHorizontal: 14,
                paddingVertical: 9,
                borderWidth: mine ? 0 : 1,
                borderColor: t.colors.border,
              }}
            >
              <Text variant="body" color={mine ? t.colors.accentText : t.colors.text}>
                {entry.text}
              </Text>
            </View>
          </View>
        </View>
      </Wrapper>
    );
  }

  if (entry.kind === 'narrative' || entry.kind === 'llm') {
    const llm = entry.kind === 'llm';
    const major = entry.importance >= 3;
    return (
      <Wrapper {...wrapperProps} style={{ paddingHorizontal: 16 }}>
        {time}
        <View style={{ flexDirection: 'row', marginVertical: 4 }}>
          {llm ? <View style={{ width: 3, borderRadius: 2, backgroundColor: t.colors.accent, opacity: 0.8, marginRight: 12, marginVertical: 3 }} /> : null}
          <Text variant="prose" style={{ flex: 1, color: major ? t.colors.text : llm ? t.colors.text : '#D5DCE6', fontStyle: entry.meta?.needsLlm ? 'italic' : 'normal' }}>
            {entry.text}
          </Text>
        </View>
        {major ? <View style={{ height: 1, backgroundColor: t.colors.accent, opacity: 0.35, marginVertical: 8, width: 48 }} /> : null}
      </Wrapper>
    );
  }

  const meta = KIND_META[entry.kind] ?? KIND_META.system!;
  return (
    <Wrapper {...wrapperProps} style={{ paddingHorizontal: 16 }}>
      {time}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginVertical: 3, backgroundColor: entry.kind === 'alert' ? t.colors.dangerSoft : 'transparent', borderRadius: 10, paddingVertical: entry.kind === 'alert' ? 6 : 1, paddingHorizontal: entry.kind === 'alert' ? 8 : 0 }}>
        <Icon name={meta.icon} size={14} color={meta.color} style={{ marginTop: 3 }} />
        <Text variant="caption" style={{ flex: 1, color: entry.kind === 'alert' ? t.colors.text : t.colors.textMuted, fontSize: 13.5, lineHeight: 19 }}>
          {entry.text}
        </Text>
      </View>
    </Wrapper>
  );
});

export interface NarrativeFeedProps {
  state: WorldState;
  filter?: (e: LogEntry) => boolean;
  /** rendered above the newest entry (in inverted list terms, list header) */
  footer?: React.ReactNode;
  /** rendered at the very top (oldest) */
  header?: React.ReactNode;
  emptyText?: string;
  /** entries newer than this minute get an entering animation */
  animateAfterMinute?: number;
  version?: number;
}

/** Inverted FlatList: newest at bottom, auto-scrolls as entries arrive. */
export function NarrativeFeed({ state, filter, footer, header, emptyText, animateAfterMinute = Infinity, version }: NarrativeFeedProps): React.ReactElement {
  const t = useTheme();
  const controlled = useMemo(() => new Set(state.player.controlledSimIds), [state.player.controlledSimIds]);
  const items = useMemo(() => {
    const built = buildFeed(state.log, state.epoch, filter);
    return built.reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.log.length, version, filter, state.epoch]);
  const renderItem = ({ item }: ListRenderItemInfo<FeedItem>) => {
    if (item.type === 'day') {
      return (
        <View style={{ alignItems: 'center', marginVertical: 14, flexDirection: 'row', gap: 12, paddingHorizontal: 24 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: t.colors.border }} />
          <Text variant="label" muted>
            Day {item.day} · {item.label}
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: t.colors.border }} />
        </View>
      );
    }
    return <Entry entry={item.entry} showTime={item.showTime} state={state} controlled={controlled} recent={item.entry.at >= animateAfterMinute} />;
  };
  return (
    <FlatList
      data={items}
      inverted
      keyExtractor={(i) => i.key}
      renderItem={renderItem}
      ListHeaderComponent={footer ? <View>{footer}</View> : null}
      ListFooterComponent={header ? <View>{header}</View> : null}
      ListEmptyComponent={
        <View style={{ padding: 32, alignItems: 'center', transform: [{ scaleY: -1 }] }}>
          <Text variant="prose" muted center style={{ fontStyle: 'italic' }}>
            {emptyText ?? 'Your story starts here.'}
          </Text>
        </View>
      }
      contentContainerStyle={{ paddingVertical: 12 }}
      initialNumToRender={24}
      maxToRenderPerBatch={16}
      windowSize={9}
      removeClippedSubviews={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    />
  );
}

export default NarrativeFeed;
