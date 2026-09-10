/**
 * Civic system: jury duty, elections and voting, benefits enrollment (SNAP, Medicaid,
 * marketplace insurance), volunteering, worship, donations, community reputation,
 * passports, and the small rituals of being a resident of somewhere.
 *
 * Events emitted:  civic:jury_summons, civic:election, civic:tax_deadline, civic:census, life:event
 * Events consumed: time:day, time:year, calendar:holiday, custom (civic:*), scheduled:fired
 *                  (jury_duty, election, tax_deadline)
 * Action ids:      civic:*
 *
 * Sim flags: `civic:registered`, `civic:votedYear`, `civic:jurySummonsAt`, `civic:juryDone`,
 *            `civic:volunteerHours`, `snap_enrolled`, `civic:medicaid`, `civic:worshipStreak`.
 * World flags: `civic:electionYear`, `civic:openEnrollment`.
 */
import type { ActionDef, Sim } from '../core/types';
import type { ActionResult, System, SystemContext } from '../core/systems';
import { shortId } from '../core/ids';
import { clamp, DAY, formatMoney, round2 } from '../core/util';

export const JURY_PAY_PER_DAY = 40;
export const SNAP_INCOME_LIMIT_MONTHLY = 2510; // 1-person household, 2026-ish
export const SNAP_PER_PERSON = 292;
export const MEDICAID_INCOME_LIMIT_MONTHLY = 1800;
export const PASSPORT_DAYS = 42;

function monthlyIncome(sim: Sim): number {
  const j = sim.career.job;
  if (!j) return sim.career.unemployment ? sim.career.unemployment.weeklyBenefit * 4.33 : 0;
  if (j.payType === 'salary' && j.annualSalary) return j.annualSalary / 12;
  if (j.hourlyRate) return j.hourlyRate * (j.shifts.reduce((s, sh) => s + (sh.end - sh.start) / 60, 0)) * 4.33;
  return 0;
}

function householdSize(ctx: SystemContext, sim: Sim): number {
  return ctx.query.householdOf(sim.id)?.simIds.length ?? 1;
}

function isAdultCitizen(ctx: SystemContext, sim: Sim): boolean {
  return ctx.query.ageOf(sim) >= 18 && sim.body.alive;
}

function enrollSnap(ctx: SystemContext, sim: Sim): boolean {
  const size = householdSize(ctx, sim);
  const limit = SNAP_INCOME_LIMIT_MONTHLY + (size - 1) * 880;
  if (monthlyIncome(sim) > limit) return false;
  sim.flags.snap_enrolled = true;
  sim.finance.benefits.snap = round2(SNAP_PER_PERSON * Math.min(size, 4) * 0.8);
  return true;
}

function enrollMedicaid(ctx: SystemContext, sim: Sim): boolean {
  const size = householdSize(ctx, sim);
  if (monthlyIncome(sim) > MEDICAID_INCOME_LIMIT_MONTHLY + (size - 1) * 620) return false;
  sim.body.insurance = { kind: 'medicaid', monthlyPremium: 0, deductible: 0, deductibleMet: 0, copay: 4, coinsurance: 0 };
  sim.flags['civic:medicaid'] = true;
  return true;
}

function marketplacePremium(ctx: SystemContext, sim: Sim): number {
  const age = ctx.query.ageOf(sim);
  const base = 320 + Math.max(0, age - 25) * 9;
  const income = monthlyIncome(sim) * 12;
  const subsidy = income < 60000 ? clamp(1 - income / 60000, 0, 0.85) : 0;
  return round2(base * (1 - subsidy) * ctx.state.region.costOfLiving);
}

// ---------------------------------------------------------------------------
export const civicSystem: System = {
  id: 'civic',
  intervalMinutes: 1440,

  onInit(ctx) {
    const y = ctx.clock.day.year;
    ctx.state.flags['civic:electionYear'] = y % 2 === 0 ? 1 : 0;
    const m = ctx.clock.day.month;
    ctx.state.flags['civic:openEnrollment'] = m === 11 || m === 12 || m === 1 ? 1 : 0;
  },

  onTick(ctx) {
    const now = ctx.state.time.minute;
    const m = ctx.clock.day.month;
    ctx.state.flags['civic:openEnrollment'] = m === 11 || m === 12 || m === 1 ? 1 : 0;
    for (const sim of ctx.query.controlledSims()) {
      if (!isAdultCitizen(ctx, sim)) continue;
      // jury summons roughly once every 2.5 years per adult
      if (!sim.flags['civic:jurySummonsAt'] && ctx.rng.chance(1 / 900)) {
        const at = now + ctx.rng.int(21, 45) * DAY;
        sim.flags['civic:jurySummonsAt'] = at;
        ctx.schedule({ atMinute: at, kind: 'jury_duty', label: 'Jury duty', simId: sim.id });
        ctx.emit({ type: 'civic:jury_summons', simId: sim.id, at });
        const hh = ctx.query.householdOf(sim.id);
        hh?.mail.push({ id: shortId(ctx.rng, 'mail'), at: now, from: 'County Clerk', subject: 'Summons for jury service', body: `You are summoned to report for jury duty. Report to the courthouse by 8:00 AM on the date shown. Failure to appear may result in a fine.`, kind: 'summons', read: false });
        ctx.log({ text: 'A jury summons came in the mail.', kind: 'event', simId: sim.id, importance: 2 });
      }
      // SNAP recertification every 6 months
      if (sim.flags.snap_enrolled && ctx.rng.chance(1 / 180)) {
        if (!enrollSnap(ctx, sim)) {
          sim.flags.snap_enrolled = false;
          sim.finance.benefits.snap = 0;
          ctx.log({ text: 'Your SNAP benefits were not renewed — your income is now over the limit.', kind: 'alert', simId: sim.id, importance: 2 });
        }
      }
      // reputation drifts toward 0 slowly
      if (Math.abs(sim.reputation) > 1) sim.reputation = round2(sim.reputation * 0.995);
    }
  },

  onEvent(ctx, e) {
    const now = ctx.state.time.minute;
    if (e.type === 'time:year') {
      ctx.state.flags['civic:electionYear'] = e.year % 2 === 0 ? 1 : 0;
      for (const sim of ctx.query.controlledSims()) {
        if (!isAdultCitizen(ctx, sim)) continue;
        ctx.schedule({ inMinutes: (105 - ctx.clock.day.dayOfYear) * DAY, kind: 'tax_deadline', label: 'Tax day', simId: sim.id });
        if (e.year % 10 === 0) ctx.emit({ type: 'civic:census' });
      }
      return;
    }
    if (e.type === 'calendar:holiday' && e.holidayId === 'election_day') {
      ctx.emit({ type: 'civic:election', at: now, label: ctx.state.flags['civic:electionYear'] ? 'General election' : 'Local election' });
      for (const sim of ctx.query.controlledSims()) {
        if (isAdultCitizen(ctx, sim)) ctx.log({ text: sim.flags['civic:registered'] ? 'Election day. Polls are open until 7 PM.' : 'Election day. You never registered, so this one goes on without you.', kind: 'event', simId: sim.id, importance: 2 });
      }
      return;
    }
    if (e.type === 'scheduled:fired') {
      const ev = e.event;
      const sim = ev.simId ? ctx.query.simMaybe(ev.simId) : undefined;
      if (!sim) return;
      if (ev.kind === 'jury_duty' && ctx.query.isControlled(sim.id)) {
        ctx.interrupt({
          kind: 'reminder', title: 'Jury duty today', simId: sim.id,
          body: 'You were summoned to report to the courthouse this morning. Your employer has to excuse you; the county pays $40 a day.',
          options: [{ label: 'Report for duty', actionId: 'civic:report_jury' }, { label: 'Ignore it', actionId: 'civic:skip_jury' }],
        });
      }
      if (ev.kind === 'tax_deadline') {
        ctx.emit({ type: 'civic:tax_deadline', simId: sim.id });
        if (!sim.finance.taxes.filedYears.includes(ctx.clock.day.year - 1)) {
          ctx.log({ text: 'Tax day. You have not filed yet — penalties start accruing tomorrow.', kind: 'alert', simId: sim.id, importance: 2 });
        }
      }
      return;
    }
    if (e.type === 'custom' && e.simId) {
      const sim = ctx.query.simMaybe(e.simId);
      if (!sim) return;
      const p = e.payload ?? {};
      switch (e.kind) {
        case 'civic:volunteer': {
          const hours = Number(p.hours ?? 2);
          sim.flags['civic:volunteerHours'] = Number(sim.flags['civic:volunteerHours'] ?? 0) + hours;
          sim.reputation = clamp(sim.reputation + hours * 1.5, -100, 100);
          ctx.applyEffects(sim.id, { skills: { charisma: hours * 6 } }, 'civic:volunteer');
          ctx.emit({ type: 'life:event', simId: sim.id, kind: 'volunteered', label: `${hours}h volunteering` });
          break;
        }
        case 'civic:service':
        case 'civic:pray': {
          if (e.kind === 'civic:service') sim.flags['civic:worshipStreak'] = Number(sim.flags['civic:worshipStreak'] ?? 0) + 1;
          if (sim.personality.traits.includes('spiritual')) ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'grateful', label: 'Fed the spirit', intensity: 8, durationMinutes: 720 }] }, 'civic:worship');
          break;
        }
        case 'civic:vote': {
          const year = ctx.clock.day.year;
          if (!sim.flags['civic:registered']) {
            ctx.log({ text: 'You are not registered to vote here. The poll worker hands you a form for next time.', kind: 'system', simId: sim.id, importance: 1 });
            sim.flags['civic:registered'] = true;
            break;
          }
          if (sim.flags['civic:votedYear'] === year) {
            ctx.log({ text: 'You already voted this cycle.', kind: 'system', simId: sim.id, importance: 0 });
            break;
          }
          sim.flags['civic:votedYear'] = year;
          sim.reputation = clamp(sim.reputation + 2, -100, 100);
          ctx.emit({ type: 'life:event', simId: sim.id, kind: 'voted', label: 'Voted' });
          break;
        }
        case 'civic:meeting':
          sim.reputation = clamp(sim.reputation + 1, -100, 100);
          break;
        case 'civic:donate': {
          const amount = Number(p.amount ?? 0);
          if (amount > 0) ctx.applyEffects(sim.id, { money: { amount: -amount, memo: 'Donation', category: 'charity' } }, 'civic:donate');
          sim.reputation = clamp(sim.reputation + Math.min(5, amount / 20 + 1), -100, 100);
          break;
        }
        case 'civic:benefits': {
          const snap = enrollSnap(ctx, sim);
          const medicaid = sim.body.insurance.kind === 'none' || sim.body.insurance.kind === 'marketplace' ? enrollMedicaid(ctx, sim) : false;
          if (snap || medicaid) ctx.log({ text: `Approved${snap ? ` for SNAP (${formatMoney(sim.finance.benefits.snap)}/month)` : ''}${snap && medicaid ? ' and' : ''}${medicaid ? ' for Medicaid' : ''}. The card arrives in the mail in a week.`, kind: 'money', simId: sim.id, importance: 2 });
          else ctx.log({ text: 'Denied — your income is over the limit. They give you a pamphlet.', kind: 'system', simId: sim.id, importance: 1 });
          break;
        }
        default:
          break;
      }
    }
  },

  actions(ctx, simId) {
    const sim = ctx.query.sim(simId);
    const out: ActionDef[] = [];
    if (!isAdultCitizen(ctx, sim)) return out;
    const venue = ctx.query.venueMaybe(sim.location.venueId);
    const arch = venue?.archetype;
    const year = ctx.clock.day.year;
    const holiday = ctx.clock.day.holidays.includes('election_day');
    const early = ctx.clock.day.month === 10 && ctx.clock.day.day >= 20;

    if (!sim.flags['civic:registered'] && (arch === 'dmv' || arch === 'library' || arch === 'city_hall' || arch === 'home')) {
      out.push({ id: 'civic:register', label: arch === 'home' ? 'Register to vote online' : 'Register to vote', category: 'civic', icon: '🗳️', durationMinutes: 10, effects: {}, group: 'Civic', autonomyWeight: 0.1 });
    }
    if (sim.flags['civic:registered'] && sim.flags['civic:votedYear'] !== year && (holiday || early) && (arch === 'community_center' || arch === 'school' || arch === 'library' || arch === 'city_hall' || arch === 'church')) {
      out.push({ id: 'civic:vote', label: holiday ? 'Vote' : 'Vote early', category: 'civic', icon: '🗳️', durationMinutes: 25, effects: {}, group: 'Civic', autonomyWeight: 0.3 });
    }
    if ((arch === 'city_hall' || arch === 'home') && !sim.flags.snap_enrolled && monthlyIncome(sim) < SNAP_INCOME_LIMIT_MONTHLY * 1.5) {
      out.push({ id: 'civic:apply_benefits', label: 'Apply for SNAP / Medicaid', description: 'Food and health coverage for lower incomes.', category: 'civic', icon: '🤝', durationMinutes: 55, effects: {}, llm: 'narrate', group: 'Civic', autonomyWeight: 0.2 });
    }
    if (ctx.state.flags['civic:openEnrollment'] && sim.body.insurance.kind === 'none' && (arch === 'home' || arch === 'insurance' || arch === 'library')) {
      const premium = marketplacePremium(ctx, sim);
      out.push({ id: 'civic:buy_insurance', label: `Buy marketplace health insurance (${formatMoney(premium, { cents: false })}/mo)`, category: 'health', icon: '🏥', durationMinutes: 45, effects: {}, group: 'Civic', params: { premium } });
    }
    if (sim.flags['civic:jurySummonsAt'] && arch === 'courthouse' && Number(sim.flags['civic:jurySummonsAt']) <= ctx.state.time.minute + DAY) {
      out.push({ id: 'civic:serve_jury', label: 'Report for jury duty', category: 'civic', icon: '👥', durationMinutes: 420, effects: {}, group: 'Court', interruptible: false });
    }
    if (arch === 'post_office' && !sim.flags['legal:passport']) {
      out.push({ id: 'civic:passport', label: 'Apply for a passport', category: 'civic', icon: '🛂', durationMinutes: 45, cost: { amount: 165, memo: 'Passport application', category: 'civic' }, effects: {}, group: 'Civic' });
    }
    if (arch === 'home') {
      out.push({ id: 'civic:report_pothole', label: 'Report a pothole to the city', category: 'civic', icon: '🕳️', durationMinutes: 8, effects: { moodlets: [{ emotion: 'proud', label: 'Did your part', intensity: 3, durationMinutes: 240 }] }, group: 'Civic', autonomyWeight: 0.02 });
    }
    return out;
  },

  handles(actionId) {
    return actionId.startsWith('civic:');
  },

  execute(ctx, simId, action, params): ActionResult {
    const sim = ctx.query.sim(simId);
    const now = ctx.state.time.minute;
    switch (action.id) {
      case 'civic:register':
        sim.flags['civic:registered'] = true;
        return { ok: true, text: 'Registered. A voter card will come in the mail.', effects: { moodlets: [{ emotion: 'proud', label: 'Registered to vote', intensity: 5, durationMinutes: DAY }] } };
      case 'civic:vote':
        ctx.emit({ type: 'custom', kind: 'civic:vote', simId, payload: {} });
        return { ok: true, text: 'You fill in the ovals, feed the sheet into the machine, and take the sticker.', effects: { moodlets: [{ emotion: 'proud', label: 'I voted', intensity: 8, durationMinutes: DAY }] } };
      case 'civic:apply_benefits':
        ctx.emit({ type: 'custom', kind: 'civic:benefits', simId, payload: { action: 'apply' } });
        return { ok: true, effects: { stress: 8 } };
      case 'civic:buy_insurance': {
        const premium = Number(params.premium ?? marketplacePremium(ctx, sim));
        sim.body.insurance = { kind: 'marketplace', monthlyPremium: premium, deductible: 3200, deductibleMet: 0, copay: 35, coinsurance: 0.2 };
        sim.finance.bills.push({ id: shortId(ctx.rng, 'bill'), name: 'Health insurance premium', amount: premium, dueDayOfMonth: 1, category: 'insurance', autopay: true, missed: 0 });
        return { ok: true, text: `Enrolled in a silver plan — ${formatMoney(premium)} a month, ${formatMoney(3200)} deductible.`, effects: { moodlets: [{ emotion: 'relaxed', label: 'Covered', intensity: 6, durationMinutes: DAY * 2 }] } };
      }
      case 'civic:report_jury': {
        const court = ctx.query.nearestVenue(sim.location.venueId, 'courthouse');
        if (!court) return { ok: false, text: 'There is no courthouse in this world.' };
        return { ok: true, effects: { moveTo: { venueId: court.id } }, text: 'You head down to the courthouse and find the jury assembly room.' };
      }
      case 'civic:skip_jury': {
        delete sim.flags['civic:jurySummonsAt'];
        if (ctx.rng.chance(0.35)) {
          sim.legal.tickets.push({ id: shortId(ctx.rng, 'tkt'), kind: 'Failure to appear for jury service', amount: 250, issuedAt: now, dueAt: now + 30 * DAY, paid: false, contested: false });
          ctx.log({ text: 'A notice arrives: $250 fine for failing to appear for jury service.', kind: 'alert', simId, importance: 2 });
        }
        return { ok: true, text: 'You do not go. Most people don\'t.' };
      }
      case 'civic:serve_jury': {
        delete sim.flags['civic:jurySummonsAt'];
        sim.flags['civic:juryDone'] = now;
        const selected = ctx.rng.chance(0.3);
        const days = selected ? ctx.rng.int(2, 4) : 1;
        ctx.applyEffects(simId, { money: { amount: JURY_PAY_PER_DAY * days, memo: 'Juror pay', category: 'income' }, needs: { fun: -18, comfort: -20, social: 12 }, skills: { law: 30 * days }, moodlets: [{ emotion: 'proud', label: 'Civic duty done', intensity: 6, durationMinutes: DAY * 2 }] }, 'civic:jury');
        ctx.emit({ type: 'life:event', simId, kind: 'jury_duty', label: selected ? `Served ${days} days on a jury` : 'Jury duty, not selected' });
        return { ok: true, text: selected ? `You get picked. ${days} days of testimony, a deliberation that runs long, a verdict you will think about for a while.` : 'A morning of waiting, a video about the justice system, and you are dismissed before lunch.', outcomeLabel: selected ? 'Selected' : 'Dismissed', durationMinutes: selected ? days * 420 : 240 };
      }
      case 'civic:passport':
        sim.flags['legal:passport'] = now + PASSPORT_DAYS * DAY;
        ctx.schedule({ inMinutes: PASSPORT_DAYS * DAY, kind: 'delivery', label: 'Passport arrives', simId, payload: { kind: 'passport' } });
        return { ok: true, text: 'Photo taken, forms stamped. Six weeks.' };
      default:
        return { ok: true };
    }
  },
};
