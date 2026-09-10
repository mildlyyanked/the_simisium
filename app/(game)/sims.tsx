import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGame } from '@/store/gameStore';
import { useActiveSim, useControlledSims, useEngine, useHousehold } from '@/store/selectors';
import type { BioCategory, Sim, SimId } from '@engine/core/types';
import { CONTENT } from '@engine/content';
import { Screen, Text, Button, Card, Tabs, KeyValue, SimAvatar, Chip, ChipRow, SkillRing, NeedsGrid, MoodBadge, MoodletList, RelationshipMeter, relationshipSummary, Sheet, SectionHeader, EmptyState, Pill, MoneyText, ProgressBar, Icon } from '@/ui/components';
import { NEED_META, useTheme } from '@/ui/theme';
import { clockShort, dayLabelShort, money } from '@/ui/format';

type Tab = 'household' | 'people' | 'pets' | 'vehicles';
const BIO_LABEL: Record<BioCategory, string> = { origin: 'Origins', family: 'Family', childhood: 'Childhood', education: 'Education', career: 'Work', romance: 'Romance', health: 'Health', money: 'Money', hobby: 'Hobbies', belief: 'Beliefs', secret: 'Secrets', fear: 'Fears', dream: 'Dreams', habit: 'Habits', quirk: 'Quirks', relationship: 'Relationships', trauma: 'Hard times', achievement: 'Achievements', daily_life: 'Daily life', opinion: 'Opinions' };

function CharacterSheet({ sim }: { sim: Sim }): React.ReactElement {
  const t = useTheme();
  const engine = useEngine()!;
  const toggleAutonomy = useGame((s) => s.toggleAutonomy);
  const switchSim = useGame((s) => s.switchSim);
  const age = engine.ctx().query.ageOf(sim);
  const job = sim.career.job;
  const skills = Object.entries(sim.skills).filter(([, v]) => v.level > 0 || v.xp > 0).sort((a, b) => b[1].level - a[1].level);
  const active = engine.state.player.activeSimId === sim.id;
  const week = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <SimAvatar sim={sim} size={72} ring={active ? t.colors.accent : undefined} badge={sim.flags.autonomy ? 'robot-outline' : null} />
        <View style={{ flex: 1 }}>
          <Text variant="title">
            {sim.identity.firstName} {sim.identity.lastName}
          </Text>
          <Text variant="caption" muted>
            {age} · {sim.identity.pronouns} · {sim.lifeStage.replace('_', ' ')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, alignItems: 'center' }}>
            <MoodBadge emotion={sim.mind.dominantEmotion} mood={sim.mind.mood} size="sm" />
            {!sim.body.alive ? <Pill label="Deceased" color={t.colors.danger} /> : null}
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {!active ? <Button title="Control" icon="gamepad-variant-outline" size="sm" onPress={() => switchSim(sim.id)} /> : <Pill label="Controlling" color={t.colors.accent} />}
        <Button title={sim.flags.autonomy ? 'Autonomy on' : 'Autonomy off'} icon={sim.flags.autonomy ? 'robot' : 'robot-off-outline'} size="sm" variant={sim.flags.autonomy ? 'secondary' : 'outline'} onPress={() => toggleAutonomy(sim.id)} />
      </View>
      <Text variant="prose" muted>
        {sim.identity.appearance.hair} hair, {sim.identity.appearance.eyes} eyes, {sim.identity.appearance.build} build. Usually in {sim.identity.appearance.style}. {sim.identity.appearance.distinguishing.join(', ')}.
      </Text>
      <ChipRow>
        {sim.personality.traits.map((tr) => (
          <Chip key={tr} label={CONTENT.traits[tr]?.name ?? tr} icon={CONTENT.traits[tr]?.icon} size="sm" />
        ))}
      </ChipRow>
      <Card title="Needs">
        <NeedsGrid needs={sim.needs} />
        {sim.mind.moodlets.length ? (
          <View style={{ marginTop: 10 }}>
            <MoodletList mind={sim.mind} now={engine.state.time.minute} max={10} />
          </View>
        ) : null}
      </Card>
      <Card title="Skills">
        {skills.length === 0 ? (
          <Text variant="caption" muted>
            Nothing yet. Skills grow by doing.
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {skills.map(([id, s]) => {
              const def = CONTENT.skills[id];
              const need = def?.xpCurve[s.level] ?? 1;
              return <SkillRing key={id} level={s.level} progress={s.level >= 10 ? 1 : s.xp / need} label={def?.name ?? id} icon={def?.icon} size={60} />;
            })}
          </View>
        )}
      </Card>
      <Card title="Work" icon="briefcase">
        {job ? (
          <>
            <KeyValue label="Job" value={`${job.title} at ${job.employerName}`} />
            <KeyValue label="Pay" value={job.annualSalary ? `${money(job.annualSalary, { cents: false })}/yr` : `${money(job.hourlyRate ?? 0)}/hr`} />
            <KeyValue label="Performance" value={`${Math.round(job.performance)}/100${job.warnings ? ` · ${job.warnings} warning${job.warnings > 1 ? 's' : ''}` : ''}`} />
            <View style={{ marginVertical: 6 }}>
              <Text variant="label" faint>
                Promotion
              </Text>
              <ProgressBar value={job.promotionProgress / 100} color={t.colors.accent} />
            </View>
            <KeyValue label="Shifts" value={job.shifts.map((s) => `${week[s.day]} ${clockShort(s.start)}–${clockShort(s.end)}`).join(', ')} last />
          </>
        ) : (
          <Text variant="caption" muted>
            {sim.career.retired ? 'Retired.' : sim.education.enrollment ? `Studying ${sim.education.enrollment.program}.` : 'Between jobs. Check the Jobs app.'}
          </Text>
        )}
      </Card>
      <Card title="Education" icon="school-outline">
        <KeyValue label="Highest" value={sim.education.highestLevel.replace(/_/g, ' ')} />
        {sim.education.enrollment ? <KeyValue label="Enrolled" value={`${sim.education.enrollment.program} · GPA ${sim.education.enrollment.gpa.toFixed(2)}`} /> : null}
        <KeyValue label="Degrees" value={sim.education.degrees.length ? sim.education.degrees.map((d) => `${d.level} ${d.field}`).join(', ') : 'none'} last />
      </Card>
      <Card title="Health" icon="heart-pulse">
        <KeyValue label="Health" value={`${Math.round(sim.body.health)}/100`} color={sim.body.health < 40 ? t.colors.danger : undefined} />
        <KeyValue label="Fitness" value={`${Math.round(sim.body.fitness)}/100 · ${Math.round(sim.body.weight * 2.2)} lb`} />
        <KeyValue label="Insurance" value={sim.body.insurance.kind === 'none' ? 'Uninsured' : `${sim.body.insurance.kind} · ${money(sim.body.insurance.monthlyPremium)}/mo`} color={sim.body.insurance.kind === 'none' ? t.colors.warning : undefined} />
        <KeyValue label="Conditions" value={[...sim.body.illnesses.map((i) => i.name), ...sim.body.injuries.map((i) => i.name), ...sim.mind.conditions].join(', ') || 'none'} />
        <KeyValue label="Stress" value={`${Math.round(sim.mind.stress)}/100`} last />
      </Card>
      <Card title="Money" icon="cash">
        <KeyValue label="Liquid" value={money(sim.finance.accounts.filter((a) => a.kind !== 'credit_card').reduce((s, a) => s + a.balance, 0))} />
        <KeyValue label="Debt" value={money(sim.finance.accounts.filter((a) => a.kind === 'credit_card').reduce((s, a) => s + a.balance, 0) + sim.finance.loans.reduce((s, l) => s + l.balance, 0))} />
        <KeyValue label="Credit score" value={String(sim.finance.creditScore)} last />
      </Card>
      {sim.legal.charges.length || sim.legal.tickets.some((x) => !x.paid) || sim.legal.license.status !== 'valid' ? (
        <Card title="Legal" icon="gavel">
          <KeyValue label="License" value={sim.legal.license.status} />
          {sim.legal.tickets.filter((x) => !x.paid).map((x) => (
            <KeyValue key={x.id} label={x.kind} value={money(x.amount)} color={t.colors.warning} />
          ))}
          {sim.legal.charges.map((c, i, arr) => (
            <KeyValue key={c.id} label={c.label} value={c.status} color={c.status === 'pending' ? t.colors.danger : undefined} last={i === arr.length - 1} />
          ))}
        </Card>
      ) : null}
      {sim.aspirations.length ? (
        <Card title="Aspirations" icon="star-outline">
          {sim.aspirations.map((a) => (
            <View key={a.id} style={{ marginBottom: 8 }}>
              <Text variant="bodyStrong">{a.text}</Text>
              <ProgressBar value={a.progress / 100} color={a.completed ? t.colors.success : t.colors.accent} style={{ marginVertical: 4 }} />
              <Text variant="caption" muted>
                {a.milestones.map((m) => (m.done ? '✓ ' : '○ ') + m.text).join('  ')}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
      {Object.keys(sim.inventory.consumables).length ? (
        <Card title="Carrying" icon="bag-personal-outline">
          <ChipRow>
            {Object.entries(sim.inventory.consumables).map(([id, q]) => (
              <Chip key={id} label={`${CONTENT.items[id]?.name ?? id} ×${q}`} size="sm" />
            ))}
          </ChipRow>
        </Card>
      ) : null}
      {sim.schedule.length ? (
        <Card title="Routine" icon="calendar-clock">
          {sim.schedule
            .filter((b) => b.kind !== 'sleep')
            .slice(0, 12)
            .map((b, i, arr) => (
              <KeyValue key={i} label={`${typeof b.day === 'number' ? week[b.day] : b.day} · ${b.kind}`} value={`${clockShort(b.start)}–${clockShort(b.end)}${b.venueId && engine.state.venues[b.venueId] ? ` · ${engine.state.venues[b.venueId].name}` : ''}`} last={i === arr.length - 1} />
            ))}
        </Card>
      ) : null}
    </View>
  );
}

function Profile({ sim, viewer }: { sim: Sim; viewer: Sim }): React.ReactElement {
  const t = useTheme();
  const router = useRouter();
  const engine = useEngine()!;
  const startConversation = useGame((s) => s.startConversation);
  const rel = viewer.relationships[sim.id];
  const revealed = sim.bio.facts.filter((f) => f.revealedTo.includes(viewer.id));
  const hidden = sim.bio.facts.length - revealed.length;
  const byCat = new Map<BioCategory, string[]>();
  for (const f of revealed) (byCat.get(f.category) ?? byCat.set(f.category, []).get(f.category)!).push(f.text);
  const memories = viewer.memory.filter((m) => m.participants.includes(sim.id)).slice(-6).reverse();
  const where = engine.state.venues[sim.location.venueId];
  const age = engine.ctx().query.ageOf(sim);
  const sameVenue = sim.location.venueId === viewer.location.venueId;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <SimAvatar sim={sim} size={72} />
        <View style={{ flex: 1 }}>
          <Text variant="title">
            {sim.identity.firstName} {sim.identity.lastName}
          </Text>
          <Text variant="caption" muted>
            {age} · {sim.role?.title ?? sim.career.job?.title ?? (sim.career.retired ? 'retired' : sim.lifeStage.replace('_', ' '))}
            {sim.role?.venueId && engine.state.venues[sim.role.venueId] ? ` at ${engine.state.venues[sim.role.venueId].name}` : ''}
          </Text>
          <Text variant="caption" faint>
            {relationshipSummary(rel)} · {sameVenue ? 'Here with you' : sim.travel ? 'On the move' : `Last seen: ${where?.name ?? 'unknown'}`}
          </Text>
        </View>
      </View>
      <RelationshipMeter rel={rel} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {sameVenue ? (
          <Button title="Talk" icon="chat" size="sm" onPress={() => { const cid = startConversation(sim.id, 'in_person'); if (cid) router.push('/(game)/live'); }} />
        ) : null}
        {viewer.phone.contacts.includes(sim.id) ? (
          <>
            <Button title="Call" icon="phone" size="sm" variant="secondary" onPress={() => { const cid = startConversation(sim.id, 'phone'); if (cid) router.push('/(game)/live'); }} />
            <Button title="Text" icon="message-text" size="sm" variant="secondary" onPress={() => { const cid = startConversation(sim.id, 'text'); if (cid) router.push('/(game)/live'); }} />
          </>
        ) : null}
      </View>
      <Text variant="prose" muted>
        {sim.identity.appearance.hair} hair, {sim.identity.appearance.eyes} eyes, {sim.identity.appearance.build} build. {sim.identity.appearance.distinguishing.join(', ')}. Voice: {sim.identity.voice}.
      </Text>
      {rel && rel.familiarity >= 15 ? (
        <ChipRow>
          {sim.personality.traits.slice(0, rel.familiarity >= 40 ? 4 : 2).map((tr) => (
            <Chip key={tr} label={CONTENT.traits[tr]?.name ?? tr} icon={CONTENT.traits[tr]?.icon} size="sm" />
          ))}
        </ChipRow>
      ) : null}
      <Card title="What you know" subtitle={hidden > 0 ? `${hidden} thing${hidden === 1 ? '' : 's'} you haven't learned yet` : sim.bio.generated ? 'You know their whole story' : 'You barely know them'} icon="book-account-outline">
        {revealed.length === 0 ? (
          <Text variant="caption" muted>
            Talk to them. Ask about their life. Facts you learn are recorded here, and they'll remember what you said too.
          </Text>
        ) : (
          [...byCat.entries()].map(([cat, facts]) => (
            <View key={cat} style={{ marginBottom: 8 }}>
              <Text variant="label" faint>
                {BIO_LABEL[cat]}
              </Text>
              {facts.map((f, i) => (
                <Text key={i} variant="body">
                  · {f}
                </Text>
              ))}
            </View>
          ))
        )}
        {hidden > 0 ? (
          <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
            {Array.from({ length: Math.min(hidden, 12) }).map((_, i) => (
              <View key={i} style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: t.colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="caption" faint>
                  ?
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
      {rel?.promises.length ? (
        <Card title="Promises" icon="handshake-outline">
          {rel.promises.map((p, i, arr) => (
            <KeyValue key={p.id} label={p.text} value={p.kept === true ? 'kept' : p.kept === false ? 'broken' : 'open'} last={i === arr.length - 1} />
          ))}
        </Card>
      ) : null}
      {memories.length ? (
        <Card title="Memories" icon="brain">
          {memories.map((m) => (
            <Text key={m.id} variant="caption" muted style={{ marginBottom: 4 }}>
              {dayLabelShort(engine.state.epoch, m.at)} — {m.text}
            </Text>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

export default function SimsScreen(): React.ReactElement {
  const t = useTheme();
  const engine = useEngine();
  const active = useActiveSim();
  const household = useHousehold();
  const controlled = useControlledSims();
  const params = useLocalSearchParams<{ sim?: string }>();
  const [tab, setTab] = useState<Tab>('household');
  const [sheetId, setSheetId] = useState<SimId | null>(null);
  const [memberId, setMemberId] = useState<SimId | null>(null);
  useEffect(() => {
    if (params.sim) {
      setTab('people');
      setSheetId(params.sim as SimId);
    }
  }, [params.sim]);

  const people = useMemo(() => {
    if (!engine || !active) return [] as Sim[];
    return Object.values(active.relationships)
      .map((r) => engine.state.sims[r.simId])
      .filter((s): s is Sim => !!s && !engine.state.player.controlledSimIds.includes(s.id))
      .sort((a, b) => (active.relationships[b.id]?.familiarity ?? 0) - (active.relationships[a.id]?.familiarity ?? 0));
  }, [engine, active, useGame.getState().version]);

  if (!engine || !active || !household) {
    return (
      <Screen padded>
        <EmptyState icon="account-group-outline" title="No world loaded" />
      </Screen>
    );
  }
  const member = controlled.find((c) => c.id === (memberId ?? active.id)) ?? active;
  const pets = household.petIds.map((id) => engine.state.pets[id]).filter(Boolean);
  const vehicles = household.vehicleIds.map((id) => engine.state.vehicles[id]).filter(Boolean);
  const sheetSim = sheetId ? engine.state.sims[sheetId] : undefined;

  return (
    <Screen edges={['top']} gradient={false}>
      <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>
        <Tabs<Tab> tabs={[{ id: 'household', label: 'Household', icon: 'home-account' }, { id: 'people', label: 'People', icon: 'account-multiple', badge: people.length || undefined }, { id: 'pets', label: 'Pets', icon: 'paw', badge: pets.length || undefined }, { id: 'vehicles', label: 'Garage', icon: 'car', badge: vehicles.length || undefined }]} value={tab} onChange={setTab} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        {tab === 'household' ? (
          <>
            {controlled.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 12 }}>
                {controlled.map((c) => (
                  <Pressable key={c.id} onPress={() => setMemberId(c.id)} style={{ alignItems: 'center', gap: 4 }} accessibilityLabel={`Show ${c.identity.firstName}`}>
                    <SimAvatar sim={c} size={52} ring={member.id === c.id ? t.colors.accent : t.colors.border} dim={!c.body.alive} />
                    <Text variant="caption" color={member.id === c.id ? t.colors.accent : t.colors.textMuted}>
                      {c.identity.firstName}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            <CharacterSheet sim={member} />
            <Card title={household.name} subtitle={engine.state.venues[household.homeVenueId]?.name} icon="home-outline" style={{ marginTop: 12 }}>
              <KeyValue label="Pantry" value={`${Object.values(household.pantry).reduce((a, b) => a + b, 0)} items`} />
              <KeyValue label="Chores" value={household.chores.length ? household.chores.map((c) => c.label).join(', ') : 'all done'} />
              <KeyValue label="Mail" value={`${household.mail.filter((m) => !m.read).length} unread`} last />
            </Card>
          </>
        ) : null}
        {tab === 'people' ? (
          people.length === 0 ? (
            <EmptyState icon="account-search-outline" title="You don't know anyone yet" body="Go somewhere. Introduce yourself." />
          ) : (
            people.map((p) => (
              <Card key={p.id} onPress={() => setSheetId(p.id)} style={{ marginBottom: 8 }} accessibilityLabel={`Open ${p.identity.firstName}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <SimAvatar sim={p} size={46} dim={!p.body.alive} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {p.identity.firstName} {p.identity.lastName}
                    </Text>
                    <Text variant="caption" muted numberOfLines={1}>
                      {relationshipSummary(active.relationships[p.id])} · {p.role?.title ?? p.career.job?.title ?? p.lifeStage.replace('_', ' ')}
                    </Text>
                    <RelationshipMeter rel={active.relationships[p.id]} compact showFlags={false} />
                  </View>
                  {p.location.venueId === active.location.venueId ? <Pill label="Here" color={t.colors.success} size="xs" /> : null}
                  <Icon name="chevron-right" size={18} color={t.colors.textFaint} />
                </View>
              </Card>
            ))
          )
        ) : null}
        {tab === 'pets' ? (
          pets.length === 0 ? (
            <EmptyState icon="paw-off" title="No pets" body="Shelters and pet stores have adoptable animals." />
          ) : (
            pets.map((p) => (
              <Card key={p.id} title={p.name} subtitle={`${p.breed} · ${p.species}${p.alive ? '' : ' · deceased'}`} icon={p.species === 'dog' ? 'dog' : p.species === 'cat' ? 'cat' : 'paw'} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(Object.entries(p.needs) as [string, number][]).map(([k, v]) => (
                    <Pill key={k} label={`${k} ${Math.round(v)}`} color={v < 25 ? t.colors.danger : v < 50 ? t.colors.warning : undefined} size="xs" />
                  ))}
                </View>
                <KeyValue label="Health" value={`${Math.round(p.health)}/100`} />
                <KeyValue label="Training" value={`${Math.round(p.training)}/100`} />
                <KeyValue label="Bond with you" value={`${Math.round(p.bonds[active.id] ?? 0)}/100`} />
                <KeyValue label="Quirks" value={p.quirks.filter((q) => !q.startsWith('__')).join(', ') || '—'} last />
              </Card>
            ))
          )
        ) : null}
        {tab === 'vehicles' ? (
          vehicles.length === 0 ? (
            <EmptyState icon="car-off" title="No vehicle" body="Dealerships sell cars. Bikes are cheaper." />
          ) : (
            vehicles.map((v) => (
              <Card key={v.id} title={`${v.year} ${v.make} ${v.model}`} subtitle={`${v.color} ${v.kind}`} icon="car" style={{ marginBottom: 8 }}>
                <KeyValue label={v.fuelType === 'electric' ? 'Charge' : 'Fuel'} value={`${Math.round(v.fuel)}%`} color={v.fuel < 15 ? t.colors.danger : undefined} />
                <KeyValue label="Condition" value={`${Math.round(v.condition)}/100${v.issues.length ? ` · ${v.issues.join(', ')}` : ''}`} />
                <KeyValue label="Mileage" value={`${v.mileage.toLocaleString()} mi`} />
                <KeyValue label="Value" value={money(v.value, { cents: false })} />
                <KeyValue label="Insurance" value={v.insurance ? `${v.insurance.provider} · ${money(v.insurance.monthly)}/mo` : 'none'} color={!v.insurance && v.kind !== 'bicycle' ? t.colors.warning : undefined} />
                <KeyValue label="Where" value={engine.state.venues[v.location.venueId]?.name ?? '—'} last />
              </Card>
            ))
          )
        ) : null}
      </ScrollView>
      <Sheet visible={!!sheetSim} onClose={() => setSheetId(null)} title={sheetSim ? `${sheetSim.identity.firstName} ${sheetSim.identity.lastName}` : undefined}>
        {sheetSim ? <Profile sim={sheetSim} viewer={active} /> : null}
      </Sheet>
      {sheetSim && false ? <MoneyText amount={0} /> : null}
      <View style={{ display: 'none' }}>
        <SectionHeader title="" />
      </View>
    </Screen>
  );
}
