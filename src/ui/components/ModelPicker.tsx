/**
 * Searchable picker over OpenRouter's model catalog (GET /models), cached for a day.
 * Used by Settings for per-task model overrides.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OpenRouterClient, type OpenRouterModelInfo } from '@engine/llm/client';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { Icon } from '../icons';
import { useTheme } from '../theme';

const CACHE_KEY = 'simisium:openrouter:models:v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let memory: { at: number; models: OpenRouterModelInfo[] } | null = null;

export async function loadOpenRouterModels(apiKey?: string, force = false): Promise<OpenRouterModelInfo[]> {
  const now = Date.now();
  if (!force && memory && now - memory.at < CACHE_TTL_MS) return memory.models;
  if (!force) {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { at: number; models: OpenRouterModelInfo[] };
        if (parsed && Array.isArray(parsed.models) && now - parsed.at < CACHE_TTL_MS) {
          memory = parsed;
          return parsed.models;
        }
      }
    } catch {
      /* cache miss */
    }
  }
  const client = new OpenRouterClient({ apiKey: apiKey || 'anonymous' });
  const models = (await client.listModels()).filter((m) => !!m.id).sort((a, b) => a.id.localeCompare(b.id));
  memory = { at: now, models };
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(memory));
  } catch {
    /* ignore */
  }
  return models;
}

function perMillion(v?: number): string {
  if (v === undefined || !Number.isFinite(v)) return '–';
  const m = v * 1_000_000;
  if (m === 0) return 'free';
  return m < 1 ? `$${m.toFixed(2)}` : m < 10 ? `$${m.toFixed(1)}` : `$${Math.round(m)}`;
}

function ctxLabel(n?: number): string {
  if (!n) return '';
  return n >= 1_000_000 ? `${Math.round(n / 1_000_000)}M ctx` : `${Math.round(n / 1000)}k ctx`;
}

export interface ModelPickerProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** currently selected model id, or undefined for the preset default */
  value?: string;
  /** the preset's model id for this task (shown as the "default" row) */
  presetModel: string;
  apiKey?: string;
  onSelect: (modelId: string | undefined) => void;
  /** only list models that can output images */
  imagesOnly?: boolean;
}

export function ModelPicker({ visible, onClose, title, value, presetModel, apiKey, onSelect, imagesOnly }: ModelPickerProps): React.ReactElement | null {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [models, setModels] = useState<OpenRouterModelInfo[] | null>(memory?.models ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadOpenRouterModels(apiKey)
      .then((m) => {
        if (!cancelled) setModels(m);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, apiKey]);

  const filtered = useMemo(() => {
    if (!models) return [];
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const pool = imagesOnly ? models.filter((m) => m.outputModalities?.includes('image')) : models;
    const list = terms.length ? pool.filter((m) => terms.every((term) => m.id.toLowerCase().includes(term) || (m.name ?? '').toLowerCase().includes(term))) : pool;
    // structured-output capable models first, then the rest; both alphabetical
    return [...list].sort((a, b) => {
      const sa = a.supportedParameters?.includes('response_format') ? 0 : 1;
      const sb = b.supportedParameters?.includes('response_format') ? 0 : 1;
      return sa - sb || a.id.localeCompare(b.id);
    });
  }, [models, query, imagesOnly]);

  const Row = ({ id, name, sub, selected, onPress, icon }: { id: string; name?: string; sub?: string; selected: boolean; onPress: () => void; icon?: string }) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: pressed ? t.colors.surfaceRaised : selected ? t.colors.accentSoft : 'transparent' })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={1} color={selected ? t.colors.accent : undefined}>
          {name ?? id}
        </Text>
        <Text variant="caption" muted numberOfLines={1}>
          {name ? `${id}${sub ? ` · ${sub}` : ''}` : sub}
        </Text>
      </View>
      {icon ? <Icon name={icon} size={16} color={t.colors.textMuted} /> : null}
      {selected ? <Icon name="check" size={18} color={t.colors.accent} /> : null}
    </Pressable>
  );

  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={imagesOnly ? 'OpenRouter models that output images' : 'OpenRouter catalog · tap a model to use it for this task'} flush maxHeight={0.92}>
      <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.colors.surfaceRaised, borderRadius: t.radii.lg, borderWidth: 1, borderColor: t.colors.border, paddingHorizontal: 12, height: 42 }}>
          <Icon name="magnify" size={18} color={t.colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search models (e.g. claude, gemini flash, deepseek)"
            placeholderTextColor={t.colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, color: t.colors.text, fontSize: 15, paddingVertical: 0 }}
            accessibilityLabel="Search models"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityLabel="Clear search">
              <Icon name="close-circle" size={18} color={t.colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <Row id={presetModel} name="Preset default" sub={presetModel} selected={!value} onPress={() => { onSelect(undefined); onClose(); }} />
      <View style={{ height: 1, backgroundColor: t.colors.border, marginHorizontal: 14 }} />
      {error ? (
        <View style={{ padding: 16 }}>
          <Text variant="body" color={t.colors.danger}>
            Could not load the catalog: {error}
          </Text>
          <Text variant="caption" muted style={{ marginTop: 6 }}>
            Check your connection, then close and reopen this picker.
          </Text>
        </View>
      ) : null}
      {loading && !models ? (
        <View style={{ padding: 16 }}>
          <Text muted>Loading the catalog…</Text>
        </View>
      ) : null}
      {models ? (
        <FlatList
          data={filtered}
          keyExtractor={(m) => m.id}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          style={{ maxHeight: 520 }}
          ListEmptyComponent={
            <View style={{ padding: 16 }}>
              <Text muted>No models match “{query}”.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Row
              id={item.id}
              name={item.name}
              sub={item.outputModalities?.includes('image') && item.pricing?.image ? `~$${(item.pricing.image * 1000).toFixed(3)} per image · ${perMillion(item.pricing?.prompt)} in per 1M` : `${perMillion(item.pricing?.prompt)} in · ${perMillion(item.pricing?.completion)} out per 1M${item.contextLength ? ` · ${ctxLabel(item.contextLength)}` : ''}`}
              selected={value === item.id}
              icon={item.supportedParameters?.includes('response_format') ? 'code-json' : undefined}
              onPress={() => {
                onSelect(item.id);
                onClose();
              }}
            />
          )}
        />
      ) : null}
      <View style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
        <Text variant="caption" faint>
          Models marked with a JSON icon support structured output, which makes conversations and adjudication more reliable.
        </Text>
      </View>
    </Sheet>
  );
}
