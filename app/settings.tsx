import React, { useState } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSettings, maskKey, type ModelPreset } from '@/store/settings';
import { useGame } from '@/store/gameStore';
import { buildLLM, buildPlaces } from '@/store/engineFactory';
import type { LLMTask } from '@engine/core/llmTypes';
import { Screen, Text, Button, Card, SectionHeader, Chip, ChipRow, SegmentedControl, ListRow, Dialog, IconButton, Icon, KeyValue, ModelPicker } from '@/ui/components';
import { modelFor } from '@engine/llm/router';
import { useTheme } from '@/ui/theme';

const TASKS: { id: LLMTask; label: string; hint: string }[] = [
  { id: 'dialogue', label: 'Dialogue', hint: 'NPC replies in conversation' },
  { id: 'adjudicate', label: 'Adjudicate', hint: 'Freeform action outcomes' },
  { id: 'bio', label: 'Biographies', hint: 'Hidden NPC life stories' },
  { id: 'narrate', label: 'Narration', hint: 'Flavor text for scenes' },
  { id: 'summarize', label: 'Summaries', hint: 'Memory compaction' },
  { id: 'director', label: 'Director', hint: 'Weekly story beats' },
];

function KeyField({ label, value, placeholder, onSave, onTest, hint }: { label: string; value: string; placeholder: string; onSave: (v: string) => Promise<void>; onTest?: () => Promise<string>; hint: string }): React.ReactElement {
  const t = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  return (
    <Card icon="key-variant" title={label} subtitle={hint}>
      {editing ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.colors.surfaceRaised, borderRadius: t.radii.md, borderWidth: 1, borderColor: t.colors.borderStrong, paddingHorizontal: 12 }}>
            <TextInput value={draft} onChangeText={setDraft} placeholder={placeholder} placeholderTextColor={t.colors.textFaint} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} accessibilityLabel={`${label} input`} style={{ flex: 1, color: t.colors.text, height: 44, fontFamily: t.fonts.mono, fontSize: 13 }} />
            <Pressable onPress={() => setShow((s) => !s)} accessibilityLabel={show ? 'Hide key' : 'Show key'} hitSlop={8}>
              <Icon name={show ? 'eye-off' : 'eye'} size={18} color={t.colors.textMuted} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
            <Button title="Cancel" variant="ghost" size="sm" onPress={() => setEditing(false)} />
            <Button
              title="Save"
              size="sm"
              onPress={async () => {
                await onSave(draft);
                setEditing(false);
                setResult(null);
              }}
            />
          </View>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text variant="mono" muted style={{ flex: 1 }} numberOfLines={1}>
              {value ? maskKey(value) : 'Not set — offline fallback in use'}
            </Text>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: value ? t.colors.success : t.colors.textFaint }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button
              title={value ? 'Change' : 'Add key'}
              variant="secondary"
              size="sm"
              icon="pencil"
              onPress={() => {
                setDraft('');
                setEditing(true);
              }}
            />
            {value ? <Button title="Remove" variant="ghost" size="sm" onPress={() => void onSave('')} /> : null}
            {onTest && value ? (
              <Button
                title="Test connection"
                variant="outline"
                size="sm"
                icon="connection"
                loading={testing}
                onPress={async () => {
                  setTesting(true);
                  try {
                    setResult(await onTest());
                  } catch (err) {
                    setResult(`Failed: ${(err as Error).message}`);
                  } finally {
                    setTesting(false);
                  }
                }}
              />
            ) : null}
          </View>
          {result ? (
            <Text variant="caption" color={result.startsWith('Failed') ? t.colors.danger : t.colors.success}>
              {result}
            </Text>
          ) : null}
        </View>
      )}
    </Card>
  );
}

function ToggleRow({ label, sub, value, onChange, last }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }): React.ReactElement {
  const t = useTheme();
  return <ListRow title={label} subtitle={sub} last={last} right={<Switch value={value} onValueChange={onChange} trackColor={{ true: t.colors.accent, false: t.colors.surfaceOverlay }} thumbColor={'#fff'} accessibilityLabel={label} />} />;
}

export default function SettingsScreen(): React.ReactElement {
  const t = useTheme();
  const router = useRouter();
  const s = useSettings();
  const saves = useGame((g) => g.saves);
  const deleteSave = useGame((g) => g.deleteSave);
  const llmUsage = useGame((g) => g.llmUsage);
  const lastLlm = useGame((g) => g.lastLlm);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [overrideTask, setOverrideTask] = useState<LLMTask | null>(null);
  const [imagePicker, setImagePicker] = useState(false);

  const testLLM = async () => {
    const { llm, warning } = buildLLM();
    if (warning || !llm) throw new Error(warning ?? 'LLM layer unavailable');
    if (!llm.isLive()) throw new Error('Service reports it is not live. Check the key.');
    return 'Connected. Live model responses enabled.';
  };
  const testPlaces = async () => {
    const { places, warning } = buildPlaces();
    if (warning || !places) throw new Error(warning ?? 'Places layer unavailable');
    const preds = await places.autocomplete('Austin');
    return `${places.id === 'google' ? 'Google Places' : 'Mock provider'} responded (${preds.length} suggestions).`;
  };

  return (
    <Screen scroll padded edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6, marginTop: 6 }}>
        <IconButton icon="arrow-left" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityLabel="Back" />
        <Text variant="title" style={{ flex: 1 }}>
          Settings
        </Text>
      </View>

      <SectionHeader title="API keys" />
      <View style={{ gap: 12 }}>
        <KeyField label="OpenRouter" hint="Powers every conversation and freeform action. Stored securely on device." value={s.openRouterKey} placeholder="sk-or-v1-…" onSave={(v) => s.setKey('openRouterKey', v)} onTest={testLLM} />
        <KeyField label="Google Places" hint="Builds your world from real places nearby. Without it, a curated fixture city is used." value={s.googlePlacesKey} placeholder="AIza…" onSave={(v) => s.setKey('googlePlacesKey', v)} onTest={testPlaces} />
      </View>

      <SectionHeader title="Models" />
      <Card>
        <SegmentedControl<ModelPreset>
          segments={[
            { id: 'budget', label: 'Budget', icon: 'piggy-bank' },
            { id: 'balanced', label: 'Balanced', icon: 'scale-balance' },
            { id: 'quality', label: 'Quality', icon: 'diamond-stone' },
          ]}
          value={s.modelPreset}
          onChange={(v) => void s.update({ modelPreset: v })}
        />
        <Text variant="caption" muted style={{ marginTop: 10 }}>
          {s.modelPreset === 'budget' ? 'Cheapest models everywhere. Snappier, less nuanced.' : s.modelPreset === 'quality' ? 'Frontier models for dialogue and judgment. Slower and pricier.' : 'Fast models for chatter, stronger models for consequences.'}
        </Text>
        <View style={{ marginTop: 12 }}>
          {TASKS.map((task, i) => (
            <ListRow
              key={task.id}
              title={task.label}
              subtitle={s.modelOverrides[task.id] ? `${s.modelOverrides[task.id]} · ${task.hint}` : `${modelFor(task.id, { preset: s.modelPreset })} · ${task.hint}`}
              chevron
              last={i === TASKS.length - 1}
              onPress={() => setOverrideTask(task.id)}
            />
          ))}
        </View>
      </Card>
      <SectionHeader title="Portraits" />
      <Card>
        <ListRow title="Portrait model" subtitle={`${s.imageModel} · generates a realistic photo of a character on demand (Sims tab)`} chevron last onPress={() => setImagePicker(true)} />
      </Card>

      <SectionHeader title="Spending cap" />
      <Card>
        <Text variant="body" muted>
          Pause live model calls once a save has spent this much. The offline fallback keeps the game playable.
        </Text>
        <ChipRow style={{ marginTop: 12 }}>
          {[1, 2, 5, 10, 25, 50].map((v) => (
            <Chip key={v} label={`$${v}`} selected={s.budgetUsd === v} onPress={() => void s.update({ budgetUsd: v })} />
          ))}
        </ChipRow>
        <KeyValue label="This session" value={`${llmUsage.calls} calls · $${llmUsage.costUsd.toFixed(3)} · ${(llmUsage.tokens / 1000).toFixed(1)}k tokens`} last={!lastLlm} />
        {lastLlm ? <KeyValue label="Last call" value={`${lastLlm.task} · ${(lastLlm.ms / 1000).toFixed(1)} s · ${lastLlm.model.split('/').pop()}${lastLlm.streamed ? ' · streamed' : ''}${lastLlm.ok ? '' : ` · failed: ${(lastLlm.error ?? '').slice(0, 60)}`}`} last /> : null}
      </Card>

      <SectionHeader title="Reading" />
      <Card>
        <Text variant="label" muted style={{ marginBottom: 8 }}>
          Text size
        </Text>
        <ChipRow>
          {[
            { v: 0.9, l: 'Small' },
            { v: 1, l: 'Default' },
            { v: 1.12, l: 'Large' },
            { v: 1.25, l: 'Larger' },
          ].map((o) => (
            <Chip key={o.v} label={o.l} selected={Math.abs(s.textSize - o.v) < 0.01} onPress={() => void s.update({ textSize: o.v })} />
          ))}
        </ChipRow>
        <Text variant="prose" style={{ marginTop: 12 }}>
          The kettle clicks off. Outside, the 7:40 bus sighs past your window without stopping.
        </Text>
      </Card>

      <SectionHeader title="Feel" />
      <Card padded={12}>
        <ToggleRow label="Haptics" sub="Small taps on key actions" value={s.haptics} onChange={(v) => void s.update({ haptics: v })} />
        <ToggleRow label="Reduce motion" sub="Fewer animations and transitions" value={s.reduceMotion} onChange={(v) => void s.update({ reduceMotion: v })} />
        <ToggleRow label="Auto-advance when idle" sub="Let minutes pass while you read" value={s.autoAdvanceWhenIdle} onChange={(v) => void s.update({ autoAdvanceWhenIdle: v })} />
        <ToggleRow label="Household autonomy by default" sub="Sims you are not controlling act on their own" value={s.autonomyDefault} onChange={(v) => void s.update({ autonomyDefault: v })} last />
      </Card>

      <SectionHeader title="Danger zone" />
      <Card>
        <Text variant="body" muted>
          {saves.length ? `${saves.length} saved ${saves.length === 1 ? 'life' : 'lives'} on this device.` : 'No saves on this device.'}
        </Text>
        <Button title="Delete all saves" variant="danger" icon="delete-forever" style={{ marginTop: 12 }} disabled={!saves.length} onPress={() => setConfirmWipe(true)} />
      </Card>

      <SectionHeader title="About" />
      <Card>
        <Text variant="title">The Simisium</Text>
        <Text variant="body" muted style={{ marginTop: 4 }}>
          A hardcore, text-based life simulation of present-day America. Every character is played by a language model with a hidden biography; every place is a real place.
        </Text>
        <Text variant="caption" faint style={{ marginTop: 10 }}>
          Version 0.1.0 · Expo SDK 57 · Map data via Google Places · Models via OpenRouter. Icons by Material Design Icons.
        </Text>
      </Card>
      <View style={{ height: 24 }} />

      <Dialog visible={confirmWipe} onClose={() => setConfirmWipe(false)} title="Delete every save?">
        <Text variant="body" muted style={{ marginBottom: 16 }}>
          All {saves.length} lives will be gone for good.
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Keep them" variant="ghost" onPress={() => setConfirmWipe(false)} />
          <Button
            title="Delete all"
            variant="danger"
            onPress={async () => {
              for (const sv of saves) await deleteSave(sv.saveId);
              setConfirmWipe(false);
            }}
          />
        </View>
      </Dialog>

      <ModelPicker
        visible={imagePicker}
        onClose={() => setImagePicker(false)}
        title="Portrait model"
        value={s.imageModel}
        presetModel="google/gemini-2.5-flash-image"
        apiKey={s.openRouterKey || undefined}
        imagesOnly
        onSelect={(id) => void s.update({ imageModel: id ?? 'google/gemini-2.5-flash-image' })}
      />
      <ModelPicker
        visible={!!overrideTask}
        onClose={() => setOverrideTask(null)}
        title={`Model for ${TASKS.find((x) => x.id === overrideTask)?.label ?? ''}`}
        value={overrideTask ? s.modelOverrides[overrideTask] : undefined}
        presetModel={overrideTask ? modelFor(overrideTask, { preset: s.modelPreset }) : ''}
        apiKey={s.openRouterKey || undefined}
        onSelect={(id) => {
          if (!overrideTask) return;
          const next = { ...s.modelOverrides };
          if (id) next[overrideTask] = id;
          else delete next[overrideTask];
          void s.update({ modelOverrides: next });
        }}
      />
    </Screen>
  );
}
