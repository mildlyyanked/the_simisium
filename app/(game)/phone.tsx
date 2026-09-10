import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useGame } from '@/store/gameStore';
import { useActions, useActiveSim, useEngine } from '@/store/selectors';
import type { ActionAvailability } from '@engine/core/actions';
import type { SimId } from '@engine/core/types';
import { Screen, Text, Button, Card, ListRow, PhoneShell, Dial, MoneyText, KeyValue, EmptyState, SimAvatar, RelationshipMeter, relationshipSummary, Pill, type PhoneApp } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { clockShort, dayLabelShort, money, relativeMinutes, duration } from '@/ui/format';
import { WEATHER_ICON } from '@/ui/icons';
import { Icon } from '@/ui/components';

const APPS: PhoneApp[] = [
  { id: 'messages', label: 'Messages', icon: 'message-text', color: '#4CD4A0' },
  { id: 'contacts', label: 'Contacts', icon: 'account-box', color: '#9AA6B8' },
  { id: 'bank', label: 'Bank', icon: 'bank', color: '#6EA8FE' },
  { id: 'jobs', label: 'Jobs', icon: 'briefcase', color: '#F5B84A' },
  { id: 'shop', label: 'Shop', icon: 'shopping', color: '#F28482' },
  { id: 'delivery', label: 'Delivery', icon: 'moped', color: '#F4A261' },
  { id: 'rideshare', label: 'Ride', icon: 'car', color: '#B388FF' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar-month', color: '#FF6B6B' },
  { id: 'social', label: 'Social', icon: 'heart-multiple', color: '#EC4899' },
  { id: 'weather', label: 'Weather', icon: 'weather-partly-cloudy', color: '#5BC0EB' },
  { id: 'school', label: 'School', icon: 'school', color: '#90BE6D' },
  { id: 'settings', label: 'Settings', icon: 'cog', color: '#64748B' },
];

function ActionList({ items, onPerform, empty }: { items: ActionAvailability[]; onPerform: (id: string) => void; empty: string }): React.ReactElement {
  const t = useTheme();
  if (!items.length) return <EmptyState icon="dots-horizontal" title={empty} compact />;
  return (
    <View style={{ gap: 6 }}>
      {items.map(({ action, available, reasons }) => (
        <ListRow key={action.id} title={action.label} subtitle={!available ? reasons[0] : action.description ?? (action.cost?.amount ? `${money(action.cost.amount)} · ${duration(action.durationMinutes)}` : duration(action.durationMinutes))} icon={action.icon ?? 'chevron-right'} iconColor={available ? t.colors.accent : t.colors.textFaint} onPress={available ? () => onPerform(action.id) : undefined} disabled={!available} chevron={available} />
      ))}
    </View>
  );
}

export default function PhoneScreen(): React.ReactElement {
  const t = useTheme();
  const router = useRouter();
  const engine = useEngine();
  const sim = useActiveSim();
  const actions = useActions();
  const perform = useGame((s) => s.perform);
  const startConversation = useGame((s) => s.startConversation);
  const [app, setApp] = useState<string | null>(null);
  const [thread, setThread] = useState<SimId | null>(null);
  const [contact, setContact] = useState<SimId | null>(null);

  const byPrefix = useMemo(() => {
    const m = new Map<string, ActionAvailability[]>();
    for (const a of actions) {
      const parts = a.action.id.split(':');
      if (parts[0] !== 'phone') continue;
      const key = parts[1];
      (m.get(key) ?? m.set(key, []).get(key)!).push(a);
    }
    return m;
  }, [actions]);

  if (!engine || !sim) {
    return (
      <Screen padded>
        <EmptyState icon="cellphone-off" title="No phone" />
      </Screen>
    );
  }
  const now = engine.state.time.minute;
  const epoch = engine.state.epoch;
  const notifications = sim.phone.notifications.filter((n) => !n.read).slice(-4).map((n) => ({ id: n.id, app: n.app, title: n.title, body: n.body }));
  const threads = Object.entries(sim.phone.threads)
    .map(([id, msgs]) => ({ id: id as SimId, other: engine.state.sims[id as SimId], last: msgs[msgs.length - 1], unread: msgs.filter((m) => !m.read && m.to === sim.id).length }))
    .filter((th) => th.other && th.last)
    .sort((a, b) => b.last.at - a.last.at);
  const contacts = sim.phone.contacts.map((id) => engine.state.sims[id]).filter(Boolean).sort((a, b) => (sim.relationships[b.id]?.familiarity ?? 0) - (sim.relationships[a.id]?.familiarity ?? 0));
  const openText = (id: SimId) => {
    const cid = startConversation(id, 'text');
    if (cid) router.push('/(game)/live');
  };
  const openCall = (id: SimId) => {
    const cid = startConversation(id, 'phone');
    if (cid) router.push('/(game)/live');
  };
  const markRead = () => {
    for (const n of sim.phone.notifications) n.read = true;
  };
  const appsWithBadges = APPS.map((a) => (a.id === 'messages' ? { ...a, badge: threads.reduce((n, th) => n + th.unread, 0) || undefined } : a));

  const renderApp = () => {
    switch (app) {
      case 'messages': {
        if (thread) {
          const other = engine.state.sims[thread];
          const msgs = sim.phone.threads[thread] ?? [];
          for (const m of msgs) if (m.to === sim.id) m.read = true;
          return (
            <View style={{ flex: 1 }}>
              <Pressable onPress={() => setThread(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 }}>
                <Icon name="chevron-left" size={20} color={t.colors.accent} />
                <SimAvatar sim={other} size={28} />
                <Text variant="bodyStrong">{other?.identity.firstName}</Text>
              </Pressable>
              <ScrollView contentContainerStyle={{ padding: 10, gap: 6 }}>
                {msgs.map((m) => {
                  const mine = m.from === sim.id;
                  return (
                    <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', backgroundColor: mine ? t.colors.accent : t.colors.surfaceRaised, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }}>
                      <Text color={mine ? t.colors.accentText : t.colors.text}>{m.text}</Text>
                      <Text variant="caption" color={mine ? 'rgba(0,0,0,0.5)' : t.colors.textFaint}>
                        {clockShort(m.at)}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
              <View style={{ padding: 10 }}>
                <Button title={`Text ${other?.identity.firstName ?? 'them'}`} icon="send" full onPress={() => openText(thread)} />
              </View>
            </View>
          );
        }
        return (
          <ScrollView contentContainerStyle={{ padding: 10 }}>
            {threads.length === 0 ? <EmptyState icon="message-outline" title="No messages yet" body="Exchange numbers with people you meet, and they'll text." compact /> : null}
            {threads.map((th) => (
              <ListRow key={th.id} title={th.other.identity.firstName} subtitle={th.last.text} left={<SimAvatar sim={th.other} size={40} />} value={relativeMinutes(now, th.last.at)} onPress={() => setThread(th.id)} right={th.unread ? <Pill label={String(th.unread)} color={t.colors.danger} size="xs" /> : undefined} />
            ))}
          </ScrollView>
        );
      }
      case 'contacts': {
        if (contact) {
          const other = engine.state.sims[contact];
          const rel = sim.relationships[contact];
          return (
            <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
              <Pressable onPress={() => setContact(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="chevron-left" size={20} color={t.colors.accent} />
                <Text color={t.colors.accent}>Contacts</Text>
              </Pressable>
              <View style={{ alignItems: 'center', gap: 6 }}>
                <SimAvatar sim={other} size={80} ring={t.colors.accent} />
                <Text variant="title">
                  {other?.identity.firstName} {other?.identity.lastName}
                </Text>
                <Text variant="caption" muted>
                  {relationshipSummary(rel)} · {other?.phone.number}
                </Text>
              </View>
              <RelationshipMeter rel={rel} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Call" icon="phone" full style={{ flex: 1 }} onPress={() => openCall(contact)} />
                <Button title="Text" icon="message-text" variant="secondary" full style={{ flex: 1 }} onPress={() => openText(contact)} />
              </View>
              <Button title="Profile" icon="account" variant="ghost" onPress={() => router.push({ pathname: '/(game)/sims', params: { sim: contact } })} />
            </ScrollView>
          );
        }
        return (
          <ScrollView contentContainerStyle={{ padding: 10 }}>
            {contacts.length === 0 ? <EmptyState icon="account-off-outline" title="No contacts" body="Ask people for their number." compact /> : null}
            {contacts.map((c) => (
              <ListRow key={c.id} title={`${c.identity.firstName} ${c.identity.lastName}`} subtitle={relationshipSummary(sim.relationships[c.id])} left={<SimAvatar sim={c} size={40} />} onPress={() => setContact(c.id)} chevron />
            ))}
          </ScrollView>
        );
      }
      case 'bank': {
        const f = sim.finance;
        const liquid = f.accounts.filter((a) => a.kind !== 'credit_card').reduce((s, a) => s + a.balance, 0);
        const owed = f.accounts.filter((a) => a.kind === 'credit_card').reduce((s, a) => s + a.balance, 0) + f.loans.reduce((s, l) => s + l.balance, 0);
        return (
          <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <Dial value={f.creditScore} min={300} max={850} label="Credit" sublabel={f.creditScore >= 740 ? 'Excellent' : f.creditScore >= 670 ? 'Good' : f.creditScore >= 580 ? 'Fair' : 'Poor'} size={104} />
              <View style={{ flex: 1, gap: 6 }}>
                <Text variant="label" faint>
                  Available
                </Text>
                <MoneyText amount={liquid} variant="title" />
                <Text variant="label" faint>
                  Owed
                </Text>
                <MoneyText amount={-owed} variant="bodyStrong" />
              </View>
            </View>
            <Card title="Accounts">
              {f.accounts.map((a, i) => (
                <KeyValue key={a.id} label={`${a.bankName} ${a.kind.replace('_', ' ')}${a.creditLimit ? ` (limit ${money(a.creditLimit, { cents: false })})` : ''}`} value={money(a.kind === 'credit_card' ? -a.balance : a.balance)} color={a.kind === 'credit_card' && a.balance > 0 ? t.colors.danger : undefined} last={i === f.accounts.length - 1} />
              ))}
            </Card>
            {f.loans.length ? (
              <Card title="Loans">
                {f.loans.map((l, i) => (
                  <KeyValue key={l.id} label={`${l.kind} · ${l.lender}`} value={`${money(l.balance, { cents: false })} · ${money(l.monthlyPayment)}/mo`} last={i === f.loans.length - 1} />
                ))}
              </Card>
            ) : null}
            <Card title="Bills">
              {f.bills.length === 0 ? (
                <Text variant="caption" muted>
                  No recurring bills.
                </Text>
              ) : (
                f.bills.map((b, i) => <KeyValue key={b.id} label={`${b.name} · due ${b.dueDayOfMonth}${b.autopay ? ' · autopay' : ''}`} value={money(b.amount)} color={b.missed ? t.colors.danger : undefined} last={i === f.bills.length - 1} />)
              )}
            </Card>
            <Card title="Banking">
              <ActionList items={byPrefix.get('bank') ?? []} onPerform={(id) => perform(id)} empty="Nothing to do right now" />
            </Card>
            <Card title="Recent">
              {f.transactions
                .slice(-12)
                .reverse()
                .map((tx, i, arr) => (
                  <KeyValue key={tx.id} label={`${tx.memo} · ${dayLabelShort(epoch, tx.at)}`} value={money(tx.amount, { sign: true })} color={tx.amount < 0 ? undefined : t.colors.success} last={i === arr.length - 1} />
                ))}
            </Card>
          </ScrollView>
        );
      }
      case 'jobs': {
        const job = sim.career.job;
        return (
          <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
            {job ? (
              <Card title={job.title} subtitle={job.employerName} icon="briefcase">
                <KeyValue label="Pay" value={job.annualSalary ? `${money(job.annualSalary, { cents: false })}/yr` : `${money(job.hourlyRate ?? 0)}/hr`} />
                <KeyValue label="Performance" value={`${Math.round(job.performance)}/100`} />
                <KeyValue label="Next shift" value={job.shifts.map((s) => `${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][s.day]} ${clockShort(s.start)}`).join(' · ')} last />
              </Card>
            ) : (
              <Card title="Unemployed" subtitle={sim.career.unemployment ? `Unemployment: ${money(sim.career.unemployment.weeklyBenefit)}/wk, ${sim.career.unemployment.weeksLeft} weeks left` : 'No income right now.'} icon="briefcase-off" />
            )}
            {sim.career.applications.filter((a) => a.status !== 'rejected' && a.status !== 'withdrawn').length ? (
              <Card title="Applications">
                {sim.career.applications
                  .filter((a) => a.status !== 'rejected' && a.status !== 'withdrawn')
                  .map((a, i, arr) => (
                    <KeyValue key={a.id} label={`${a.employerName}`} value={a.status === 'interview' && a.interviewAt ? `Interview ${dayLabelShort(epoch, a.interviewAt)} ${clockShort(a.interviewAt)}` : a.status} last={i === arr.length - 1} />
                  ))}
              </Card>
            ) : null}
            <Card title="Openings & actions">
              <ActionList items={byPrefix.get('jobs') ?? []} onPerform={(id) => perform(id)} empty="Check back later" />
            </Card>
          </ScrollView>
        );
      }
      case 'calendar': {
        const events = engine.state.scheduled.filter((e) => e.visible && e.atMinute >= now - 60).slice(0, 30);
        return (
          <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
            <Text variant="caption" muted>
              {engine.clock.dateLabel}
              {engine.clock.day.holidays.length ? ` · ${engine.clock.day.holidays.map((h) => h.replace(/_/g, ' ')).join(', ')}` : ''}
            </Text>
            {events.length === 0 ? <EmptyState icon="calendar-blank-outline" title="Nothing scheduled" compact /> : null}
            {events.map((e) => (
              <ListRow key={e.id} title={e.label} subtitle={`${dayLabelShort(epoch, e.atMinute)} · ${clockShort(e.atMinute)}${e.venueId && engine.state.venues[e.venueId] ? ` · ${engine.state.venues[e.venueId].name}` : ''}`} icon={e.kind === 'court_date' ? 'gavel' : e.kind.includes('shift') ? 'briefcase' : e.kind === 'party' ? 'party-popper' : e.kind === 'festival' ? 'ticket' : e.kind === 'bill_due' ? 'cash' : 'calendar'} />
            ))}
          </ScrollView>
        );
      }
      case 'weather': {
        const w = engine.state.weather;
        return (
          <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
            <View style={{ alignItems: 'center', gap: 4, paddingVertical: 10 }}>
              <Icon name={WEATHER_ICON[w.current.condition]} size={56} color={t.colors.accent} />
              <Text variant="display">{Math.round(w.current.tempF)}°</Text>
              <Text muted>{w.current.condition.replace(/_/g, ' ')} · humidity {w.current.humidity}% · wind {Math.round(w.current.windMph)} mph</Text>
              {w.current.alert ? <Pill label={w.current.alert} color={t.colors.danger} /> : null}
            </View>
            <Card title="This week">
              {w.forecast.map((d, i) => (
                <KeyValue key={d.isoDate} label={`${d.isoDate.slice(5)} · ${d.condition.replace(/_/g, ' ')}`} value={`${Math.round(d.hi)}° / ${Math.round(d.lo)}°  ${Math.round(d.precipChance * 100)}%`} last={i === w.forecast.length - 1} />
              ))}
            </Card>
          </ScrollView>
        );
      }
      case 'social': {
        const sm = sim.phone.socialMedia[0];
        return (
          <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
            <Card title={sm ? sm.platform : 'Not on social media'} subtitle={sm ? `${sm.followers.toLocaleString()} followers · ${sm.posts} posts` : 'Post something to start an account.'} icon="heart-multiple" />
            <ActionList items={[...(byPrefix.get('social') ?? []), ...(byPrefix.get('dating') ?? [])]} onPerform={(id) => perform(id)} empty="Nothing to post" />
          </ScrollView>
        );
      }
      case 'settings':
        router.push('/settings');
        setApp(null);
        return null;
      default: {
        const items = app ? byPrefix.get(app) ?? [] : [];
        return (
          <ScrollView contentContainerStyle={{ padding: 12 }}>
            <ActionList items={items} onPerform={(id) => perform(id)} empty="Nothing available here right now" />
          </ScrollView>
        );
      }
    }
  };

  return (
    <Screen edges={['top']} gradient={false} padded>
      <PhoneShell
        apps={appsWithBadges}
        activeApp={app}
        onOpenApp={(id) => {
          markRead();
          setThread(null);
          setContact(null);
          setApp(id);
        }}
        onHome={() => setApp(null)}
        clockLabel={clockShort(now)}
        battery={sim.phone.battery}
        carrier={sim.phone.plan.provider}
        title={APPS.find((a) => a.id === app)?.label}
        notifications={notifications}
      >
        {renderApp()}
      </PhoneShell>
    </Screen>
  );
}
