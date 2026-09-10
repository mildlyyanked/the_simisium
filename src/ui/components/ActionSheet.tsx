import React, { useMemo, useState } from 'react';
import { Pressable, SectionList, TextInput, View } from 'react-native';
import type { ActionAvailability } from '@engine/core/actions';
import type { ActionCategory } from '@engine/core/types';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon, CATEGORY_ICON, CATEGORY_LABEL } from '../icons';
import { Sheet } from './Sheet';
import { Chip } from './Chip';
import { duration, money } from '../format';
import { haptic } from '../haptics';

export interface ActionSheetProps {
  visible: boolean;
  onClose: () => void;
  actions: ActionAvailability[];
  recentIds?: string[];
  onPerform: (actionId: string, params?: Record<string, unknown>) => void;
  onFreeform?: () => void;
}

interface Section {
  title: string;
  icon: string;
  data: ActionAvailability[];
  category: ActionCategory | 'recent';
}

const CATEGORY_ORDER: ActionCategory[] = ['needs', 'social', 'romance', 'family', 'pet', 'object', 'hobby', 'entertainment', 'fitness', 'chores', 'shop', 'work', 'school', 'finance', 'health', 'legal', 'civic', 'travel', 'phone', 'freeform', 'system'];

function ActionRow({ a, onPerform, onFreeform }: { a: ActionAvailability; onPerform: (id: string) => void; onFreeform?: () => void }): React.ReactElement {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);
  const act = a.action;
  const disabled = !a.available;
  const isFreeform = act.id === 'freeform';
  const cost = act.cost?.amount ? money(act.cost.amount) : undefined;
  return (
    <Pressable
      onPress={() => {
        if (isFreeform) {
          onFreeform?.();
          return;
        }
        if (disabled) {
          haptic.warning();
          setExpanded((e) => !e);
          return;
        }
        onPerform(act.id);
      }}
      onLongPress={() => setExpanded((e) => !e)}
      accessibilityRole="button"
      accessibilityLabel={`${act.label}${disabled ? `, unavailable: ${a.reasons.join(', ')}` : ''}`}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 16, opacity: pressed ? 0.7 : 1, backgroundColor: pressed ? t.colors.surfaceRaised : 'transparent' })}
    >
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: disabled ? t.colors.surfaceRaised : isFreeform ? t.colors.accentSoft : t.colors.surfaceOverlay, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={act.icon ?? CATEGORY_ICON[act.category]} size={19} color={disabled ? t.colors.textFaint : isFreeform ? t.colors.accent : t.colors.text} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" weight="500" color={disabled ? t.colors.textFaint : t.colors.text} numberOfLines={1}>
          {act.label}
        </Text>
        {act.target?.name && act.group !== act.target.name ? (
          <Text variant="caption" faint numberOfLines={1}>
            {act.target.name}
          </Text>
        ) : act.description && (expanded || isFreeform) ? (
          <Text variant="caption" muted numberOfLines={2}>
            {act.description}
          </Text>
        ) : null}
        {disabled && expanded ? (
          <Text variant="caption" color={t.colors.warning} numberOfLines={3}>
            {a.reasons.join(' · ')}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        {cost ? (
          <Text variant="caption" color={disabled ? t.colors.textFaint : t.colors.success} weight="600">
            {cost}
          </Text>
        ) : null}
        {!isFreeform ? (
          <Text variant="caption" faint>
            {duration(act.durationMinutes)}
          </Text>
        ) : null}
      </View>
      {disabled ? <Icon name="lock-outline" size={14} color={t.colors.textFaint} /> : null}
    </Pressable>
  );
}

export function ActionSheet({ visible, onClose, actions, recentIds = [], onPerform, onFreeform }: ActionSheetProps): React.ReactElement {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<ActionCategory | 'all'>('all');

  const sections = useMemo<Section[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered = actions.filter((a) => {
      if (cat !== 'all' && a.action.category !== cat) return false;
      if (!q) return true;
      const act = a.action;
      return act.label.toLowerCase().includes(q) || (act.group ?? '').toLowerCase().includes(q) || (act.target?.name ?? '').toLowerCase().includes(q) || (act.description ?? '').toLowerCase().includes(q);
    });
    const out: Section[] = [];
    if (!q && cat === 'all' && recentIds.length) {
      const recent = recentIds.map((id) => filtered.find((a) => a.action.id === id)).filter((a): a is ActionAvailability => !!a && a.available);
      if (recent.length) out.push({ title: 'Recent', icon: 'history', data: recent, category: 'recent' });
    }
    // group by category, then by group label inside (sorted available first)
    const byCat = new Map<ActionCategory, ActionAvailability[]>();
    for (const a of filtered) {
      const list = byCat.get(a.action.category) ?? [];
      list.push(a);
      byCat.set(a.action.category, list);
    }
    for (const c of CATEGORY_ORDER) {
      const list = byCat.get(c);
      if (!list?.length) continue;
      list.sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        const ga = a.action.group ?? '';
        const gb = b.action.group ?? '';
        if (ga !== gb) return ga.localeCompare(gb);
        return a.action.label.localeCompare(b.action.label);
      });
      out.push({ title: CATEGORY_LABEL[c], icon: CATEGORY_ICON[c], data: list, category: c });
    }
    return out;
  }, [actions, query, cat, recentIds]);

  const cats = useMemo(() => {
    const present = new Set(actions.map((a) => a.action.category));
    return CATEGORY_ORDER.filter((c) => present.has(c) && c !== 'freeform' && c !== 'system');
  }, [actions]);

  const availableCount = actions.filter((a) => a.available).length;

  return (
    <Sheet visible={visible} onClose={onClose} title="What do you do?" subtitle={`${availableCount} things you can do right now`} flush maxHeight={0.9} keyboard={false}>
      <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.colors.surfaceRaised, borderRadius: t.radii.md, borderWidth: 1, borderColor: t.colors.border, paddingHorizontal: 12, height: 42 }}>
          <Icon name="magnify" size={18} color={t.colors.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search actions" placeholderTextColor={t.colors.textFaint} accessibilityLabel="Search actions" style={{ flex: 1, color: t.colors.text, fontSize: 15, fontFamily: t.fonts.sans, paddingVertical: 0 }} />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityLabel="Clear search" hitSlop={8}>
              <Icon name="close-circle" size={16} color={t.colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'nowrap', gap: 6 }}>
          <Chip label="All" size="sm" selected={cat === 'all'} onPress={() => setCat('all')} />
          {cats.slice(0, 5).map((c) => (
            <Chip key={c} label={CATEGORY_LABEL[c]} icon={CATEGORY_ICON[c]} size="sm" selected={cat === c} onPress={() => setCat(cat === c ? 'all' : c)} />
          ))}
        </View>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(a, i) => `${a.action.id}_${i}`}
        renderItem={({ item }) => <ActionRow a={item} onPerform={(id) => onPerform(id)} onFreeform={onFreeform} />}
        renderSectionHeader={({ section }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, backgroundColor: t.colors.surface }}>
            <Icon name={section.icon} size={13} color={t.colors.accent} />
            <Text variant="label" muted>
              {section.title}
            </Text>
            <Text variant="caption" faint>
              {section.data.length}
            </Text>
          </View>
        )}
        stickySectionHeadersEnabled
        style={{ maxHeight: 520 }}
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={{ padding: 32, alignItems: 'center' }}>
            <Text variant="body" muted center>
              Nothing matches. Try the freeform composer — you can attempt anything.
            </Text>
          </View>
        }
        initialNumToRender={20}
      />
    </Sheet>
  );
}

export default ActionSheet;
