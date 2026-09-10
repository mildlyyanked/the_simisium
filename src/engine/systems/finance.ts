/**
 * Finance system — accounts, interest, bills, loans, credit score, taxes, benefits,
 * overdrafts, investing, lottery, peer payments, and the daily economy drift.
 *
 * Bill contract (used by property/amenities/transport which push RecurringBills onto
 * `sim.finance.bills`):
 *   - a bill becomes due on `dueDayOfMonth`; the sim flag `bill_due:<id>` holds the due minute
 *   - autopay or available funds → paid (`money:bill_paid`); else `money:bill_due` + phone notification
 *   - unpaid 5 days → `money:bill_missed`, `bill.missed++`, credit −25, amount moves to `bill_arrears:<id>`
 *   - `bill_paid_month:<id>` (year*12+month) marks which cycle was last settled
 *
 * Custom effect kinds handled: `finance:withdraw {amount?}`, `finance:deposit {amount?}`,
 * `finance:lottery_ticket`, `finance:charge {amount, memo}` (charge with overdraft), `finance:credit {amount, memo}`.
 */
import { dayIndex, parseIsoDate } from '../core/clock';
import { liquidCash, transact } from '../core/effects';
import type { GameEvent } from '../core/events';
import { shortId } from '../core/ids';
import type { System, SystemContext } from '../core/systems';
import type { Account, ActionDef, Household, LoanRef, RecurringBill, Requirement, Sim, SimId, VenueId } from '../core/types';
import { DAY, clamp, formatMoney, isFiniteNumber, round2 } from '../core/util';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const OVERDRAFT_LIMIT = 100;
export const OVERDRAFT_FEE = 35;
export const CC_LATE_FEE = 30;
export const LOAN_LATE_FEE = 25;
export const BILL_GRACE_DAYS = 5;
export const ATM_FEE = 3;
export const CASHIERS_CHECK_FEE = 10;
export const ACCOUNTANT_FEE = 150;
export const STD_DEDUCTION_2026 = 16100;
/** 2026 federal brackets, single filer: [upper bound, rate] */
export const FED_BRACKETS_2026: [number, number][] = [
  [12400, 0.1],
  [50400, 0.12],
  [105700, 0.22],
  [201775, 0.24],
  [256225, 0.32],
  [640600, 0.35],
  [Number.POSITIVE_INFINITY, 0.37],
];
export const FICA_RATE = 0.0765;
export const DEFAULT_401K_PCT = 0.04;
export const SNAP_BASE = 292;
export const SNAP_PER_EXTRA = 220;

// ---------------------------------------------------------------------------
// Exported helpers (other builders may replicate these; systems don't import each other)
// ---------------------------------------------------------------------------
export type BillSpec = Omit<RecurringBill, 'missed' | 'lastPaidAt'> & Partial<Pick<RecurringBill, 'missed' | 'lastPaidAt'>>;

/** Upsert a recurring bill by id. Returns the stored bill. */
export function addBill(sim: Sim, bill: BillSpec): RecurringBill {
  const existing = sim.finance.bills.find((b) => b.id === bill.id);
  if (existing) {
    existing.name = bill.name;
    existing.amount = round2(bill.amount);
    existing.dueDayOfMonth = bill.dueDayOfMonth;
    existing.category = bill.category;
    existing.linkedId = bill.linkedId ?? existing.linkedId;
    return existing;
  }
  const stored: RecurringBill = { missed: 0, ...bill, amount: round2(bill.amount) };
  sim.finance.bills.push(stored);
  return stored;
}

export function removeBill(sim: Sim, id: string): boolean {
  const before = sim.finance.bills.length;
  sim.finance.bills = sim.finance.bills.filter((b) => b.id !== id);
  delete sim.flags[`bill_due:${id}`];
  delete sim.flags[`bill_arrears:${id}`];
  delete sim.flags[`bill_paid_month:${id}`];
  return sim.finance.bills.length !== before;
}

export function federalTax(taxable: number): number {
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of FED_BRACKETS_2026) {
    if (taxable <= lower) break;
    const slice = Math.min(taxable, upper) - lower;
    tax += slice * rate;
    lower = upper;
  }
  return round2(tax);
}

/** Year-end reconciliation. Positive `owed` means the sim must pay; `refund` when withholding exceeded liability. */
export function computeTaxes(income: number, withheld: number, stateRate: number): { federal: number; state: number; fica: number; liability: number; owed: number; refund: number } {
  const taxable = Math.max(0, income - STD_DEDUCTION_2026);
  const federal = federalTax(taxable);
  const state = round2(taxable * Math.max(0, stateRate));
  const fica = round2(income * FICA_RATE);
  const liability = round2(federal + state);
  const incomeTaxWithheld = Math.max(0, withheld - fica);
  const diff = round2(liability - incomeTaxWithheld);
  return { federal, state, fica, liability, owed: diff > 0 ? diff : 0, refund: diff < 0 ? -diff : 0 };
}

export function monthlyPayment(principal: number, apr: number, termMonths: number): number {
  const r = apr / 12;
  if (r <= 0) return round2(principal / termMonths);
  return round2((principal * r) / (1 - Math.pow(1 + r, -termMonths)));
}

export function creditCardTerms(score: number): { limit: number; apr: number } | undefined {
  if (score < 600) return undefined;
  if (score >= 750) return { limit: 8000, apr: 0.189 };
  if (score >= 700) return { limit: 4000, apr: 0.219 };
  if (score >= 650) return { limit: 2000, apr: 0.249 };
  return { limit: 800, apr: 0.289 };
}

export function personalLoanTerms(score: number): { maxAmount: number; apr: number } | undefined {
  if (score < 600) return undefined;
  if (score >= 750) return { maxAmount: 20000, apr: 0.089 };
  if (score >= 700) return { maxAmount: 15000, apr: 0.119 };
  if (score >= 640) return { maxAmount: 7500, apr: 0.159 };
  return { maxAmount: 3000, apr: 0.229 };
}

export function autoLoanApr(score: number): number {
  if (score >= 780) return 0.055;
  if (score >= 720) return 0.069;
  if (score >= 660) return 0.089;
  if (score >= 600) return 0.129;
  return 0.189;
}

export function monthKeyAt(epoch: string, minute: number): number {
  const d = new Date(parseIsoDate(epoch).getTime() + minute * 60_000);
  return d.getUTCFullYear() * 12 + (d.getUTCMonth() + 1);
}

export function minuteOfIsoDate(epoch: string, iso: string): number {
  return Math.round((parseIsoDate(iso).getTime() - parseIsoDate(epoch).getTime()) / 60_000);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
type Ctx = SystemContext;

function account(sim: Sim, kind: Account['kind']): Account | undefined {
  return sim.finance.accounts.find((a) => a.kind === kind && !a.frozen);
}

function recordTx(ctx: Ctx, sim: Sim, accountId: string, amount: number, memo: string, category: string): void {
  sim.finance.transactions.push({ id: shortId(ctx.rng, 'tx'), at: ctx.state.time.minute, amount: round2(amount), accountId, memo, category });
  if (sim.finance.transactions.length > 400) sim.finance.transactions.splice(0, sim.finance.transactions.length - 400);
  ctx.emit({ type: 'money:transaction', simId: sim.id, amount: round2(amount), memo, accountId, category });
}

function notify(ctx: Ctx, sim: Sim, title: string, body: string, actionId?: string, app = 'bank'): void {
  sim.phone.notifications.push({ id: shortId(ctx.rng, 'ntf'), at: ctx.state.time.minute, app, title, body, read: false, actionId });
  if (sim.phone.notifications.length > 60) sim.phone.notifications.splice(0, sim.phone.notifications.length - 60);
  ctx.emit({ type: 'phone:notification', simId: sim.id, app, title, body });
}

function you(ctx: Ctx, sim: Sim): string {
  return ctx.query.isControlled(sim.id) ? 'You' : sim.identity.firstName;
}

function your(ctx: Ctx, sim: Sim): string {
  return ctx.query.isControlled(sim.id) ? 'your' : `${sim.identity.firstName}'s`;
}

function householdOf(ctx: Ctx, sim: Sim): Household | undefined {
  return sim.householdId ? ctx.state.households[sim.householdId] : undefined;
}

export function adjustCredit(ctx: Ctx, sim: Sim, delta: number, reason: string): void {
  const before = sim.finance.creditScore;
  const after = clamp(Math.round(before + delta), 300, 850);
  if (after === before) return;
  sim.finance.creditScore = after;
  if (Math.abs(after - before) >= 5) {
    ctx.emit({ type: 'money:credit_score', simId: sim.id, score: after, delta: after - before });
    if (ctx.query.isControlled(sim.id)) ctx.log({ text: `Your credit score ${after > before ? 'rose' : 'dropped'} to ${after} (${reason}).`, kind: 'money', simId: sim.id, importance: after < before ? 2 : 1 });
  }
}

/** Overdraft: drive checking negative (shortfall ≤ $100, once per day) and charge the fee. */
function overdraft(ctx: Ctx, sim: Sim, amount: number, memo: string, category: string): boolean {
  const chk = account(sim, 'checking');
  if (!chk || chk.balance < 0) return false;
  const shortfall = round2(amount - chk.balance);
  if (shortfall <= 0 || shortfall > OVERDRAFT_LIMIT) return false;
  const today = dayIndex(ctx.state.time.minute);
  if (sim.flags.overdraft_day === today) return false;
  chk.balance = round2(chk.balance - amount);
  recordTx(ctx, sim, chk.id, -amount, memo, category);
  chk.balance = round2(chk.balance - OVERDRAFT_FEE);
  chk.overdraftFeesThisMonth += 1;
  recordTx(ctx, sim, chk.id, -OVERDRAFT_FEE, 'Overdraft fee', 'fee');
  sim.flags.overdraft_day = today;
  ctx.state.stats.moneySpent = round2(ctx.state.stats.moneySpent + amount + OVERDRAFT_FEE);
  ctx.log({ text: `${you(ctx, sim)} overdrew ${your(ctx, sim)} checking account paying ${memo} (${formatMoney(amount)}). The bank charged a ${formatMoney(OVERDRAFT_FEE)} overdraft fee; balance is now ${formatMoney(chk.balance)}.`, kind: 'money', simId: sim.id, importance: 2 });
  return true;
}

/**
 * Charge a sim (no credit cards): own liquid accounts → other household members (shared finances) → overdraft.
 * Returns true when paid.
 */
export function chargeSim(ctx: Ctx, sim: Sim, amount: number, memo: string, category: string, opts: { allowOverdraft?: boolean; allowHousehold?: boolean; counterparty?: string } = {}): boolean {
  amount = round2(amount);
  if (amount <= 0) return true;
  const now = ctx.state.time.minute;
  const tryOne = (s: Sim): boolean => {
    const r = transact(s, -amount, memo, now, { allowCredit: false, category, counterparty: opts.counterparty, rng: ctx.rng });
    if (!r.ok) return false;
    ctx.emit({ type: 'money:transaction', simId: s.id, amount: -amount, memo, accountId: r.accountId!, category });
    ctx.state.stats.moneySpent = round2(ctx.state.stats.moneySpent + amount);
    return true;
  };
  if (tryOne(sim)) return true;
  if (opts.allowHousehold !== false) {
    const hh = householdOf(ctx, sim);
    if (hh?.sharedFinances) {
      for (const id of hh.simIds) {
        const other = ctx.state.sims[id];
        if (!other || other.id === sim.id || !other.body.alive) continue;
        if (tryOne(other)) {
          if (ctx.query.isControlled(other.id)) ctx.log({ text: `${other.identity.firstName} covered ${memo} (${formatMoney(amount)}).`, kind: 'money', simId: other.id, importance: 1 });
          return true;
        }
      }
    }
  }
  if (opts.allowOverdraft) return overdraft(ctx, sim, amount, memo, category);
  return false;
}

export function creditSim(ctx: Ctx, simId: SimId, amount: number, memo: string, category = 'income', accountKind?: Account['kind']): void {
  if (amount <= 0) return;
  ctx.applyEffects(simId, { money: { amount: round2(amount), memo, category, account: accountKind } }, 'finance');
}

function headOfHousehold(ctx: Ctx, hh: Household): Sim | undefined {
  const alive = hh.simIds.filter((id) => ctx.state.sims[id]?.body.alive);
  const controlled = alive.find((id) => ctx.query.isControlled(id));
  return ctx.state.sims[controlled ?? alive[0]];
}

/** sims whose finances matter: simulated (full/near) or anyone with bills/loans */
function financeSims(ctx: Ctx): Sim[] {
  return ctx.query.aliveSims().filter((s) => s.lod !== 'far' || s.finance.bills.length > 0 || s.finance.loans.length > 0 || ctx.query.isControlled(s.id));
}

// ---------------------------------------------------------------------------
// Daily processing
// ---------------------------------------------------------------------------
function accrueInterest(ctx: Ctx, sim: Sim): void {
  for (const acc of sim.finance.accounts) {
    if (acc.kind === 'savings' && acc.balance > 0) {
      const apy = acc.apy ?? ctx.state.economy.savingsApy;
      const interest = round2((acc.balance * apy) / 365);
      if (interest > 0) {
        acc.balance = round2(acc.balance + interest);
        sim.flags.savings_interest_accrued = round2(Number(sim.flags.savings_interest_accrued ?? 0) + interest);
      }
    } else if (acc.kind === 'credit_card' && acc.balance > 0) {
      const apr = acc.apr ?? 0.249;
      acc.balance = round2(acc.balance + (acc.balance * apr) / 365);
    } else if (acc.kind === 'checking' && acc.balance < 0) {
      // overdrawn: nothing accrues, but the bank freezes cards after 10 days
      const since = Number(sim.flags.overdrawn_since ?? ctx.state.time.minute);
      if (sim.flags.overdrawn_since === undefined) sim.flags.overdrawn_since = since;
      if (ctx.state.time.minute - since > 10 * DAY && !sim.flags.overdraft_warned) {
        sim.flags.overdraft_warned = true;
        notify(ctx, sim, 'Account overdrawn', `Your checking account has been negative for over 10 days. Deposit funds to avoid closure.`);
      }
    }
    if (acc.kind === 'checking' && acc.balance >= 0) {
      delete sim.flags.overdrawn_since;
      delete sim.flags.overdraft_warned;
    }
  }
  // brokerage tracks the index
  const units = Number(sim.flags.brokerage_units ?? 0);
  const brok = account(sim, 'brokerage');
  if (brok && units > 0) brok.balance = round2(units * ctx.state.economy.stockIndex);
}

function processCreditCards(ctx: Ctx, sim: Sim): void {
  const now = ctx.state.time.minute;
  for (const cc of sim.finance.accounts) {
    if (cc.kind !== 'credit_card') continue;
    if (cc.balance <= 0) {
      cc.minPaymentAmount = 0;
      continue;
    }
    if (cc.minPaymentDueAt === undefined) {
      cc.minPaymentAmount = round2(Math.min(cc.balance, Math.max(25, cc.balance * 0.02)));
      cc.minPaymentDueAt = now + 21 * DAY;
      continue;
    }
    if (cc.minPaymentDueAt > now) continue;
    // due today or overdue
    const due = cc.minPaymentAmount ?? 0;
    if (due > 0) {
      const autopay = sim.flags.cc_autopay === true;
      const paid = chargeSim(ctx, sim, due, `${cc.bankName} card minimum payment`, 'credit_card', { allowOverdraft: autopay });
      if (paid) {
        cc.balance = round2(Math.max(0, cc.balance - due));
        ctx.emit({ type: 'money:bill_paid', simId: sim.id, billId: cc.id, amount: due });
      } else {
        cc.balance = round2(cc.balance + CC_LATE_FEE);
        adjustCredit(ctx, sim, -40, 'missed credit card payment');
        ctx.emit({ type: 'money:bill_missed', simId: sim.id, billId: cc.id, amount: due });
        notify(ctx, sim, 'Payment missed', `${cc.bankName} card: minimum payment of ${formatMoney(due)} was missed. A ${formatMoney(CC_LATE_FEE)} late fee was added.`);
        if (ctx.query.isControlled(sim.id)) ctx.log({ text: `You missed the minimum payment on your ${cc.bankName} card. Late fee ${formatMoney(CC_LATE_FEE)}.`, kind: 'money', simId: sim.id, importance: 2 });
      }
    }
    cc.minPaymentAmount = round2(Math.min(cc.balance, Math.max(25, cc.balance * 0.02)));
    cc.minPaymentDueAt = now + 30 * DAY;
    if (cc.balance <= 0) cc.minPaymentAmount = 0;
  }
}

function payBillNow(ctx: Ctx, sim: Sim, bill: RecurringBill, opts: { allowOverdraft: boolean }): boolean {
  const dueKey = `bill_due:${bill.id}`;
  const dueAt = Number(sim.flags[dueKey] ?? ctx.state.time.minute);
  const label = bill.name;
  const ok = chargeSim(ctx, sim, bill.amount, label, bill.category, { allowOverdraft: opts.allowOverdraft, counterparty: bill.name });
  if (!ok) return false;
  bill.lastPaidAt = ctx.state.time.minute;
  sim.flags[`bill_paid_month:${bill.id}`] = monthKeyAt(ctx.state.epoch, dueAt);
  delete sim.flags[dueKey];
  ctx.emit({ type: 'money:bill_paid', simId: sim.id, billId: bill.id, amount: bill.amount });
  if (ctx.query.isControlled(sim.id)) ctx.log({ text: `Paid ${label}: ${formatMoney(bill.amount)}.`, kind: 'money', simId: sim.id, importance: 1 });
  return true;
}

function processBills(ctx: Ctx, sim: Sim): void {
  const c = ctx.clock;
  const now = ctx.state.time.minute;
  const mk = c.day.year * 12 + c.day.month;
  const lastDay = daysInMonth(c.day.year, c.day.month);
  for (const bill of [...sim.finance.bills]) {
    const dueKey = `bill_due:${bill.id}`;
    const dueDay = Math.min(Math.max(1, Math.round(bill.dueDayOfMonth)), lastDay);
    if (c.day.day === dueDay && sim.flags[dueKey] === undefined && sim.flags[`bill_paid_month:${bill.id}`] !== mk && bill.amount > 0) {
      sim.flags[dueKey] = now;
      const paid = payBillNow(ctx, sim, bill, { allowOverdraft: bill.autopay });
      if (!paid) {
        ctx.emit({ type: 'money:bill_due', simId: sim.id, billId: bill.id, amount: bill.amount });
        notify(ctx, sim, 'Bill due', `${bill.name}: ${formatMoney(bill.amount)} is due. ${BILL_GRACE_DAYS} days before it's reported late.`, `phone:bank:pay_bill:${bill.id}`);
        if (ctx.query.isControlled(sim.id)) ctx.log({ text: `${bill.name} (${formatMoney(bill.amount)}) is due and you couldn't cover it.`, kind: 'money', simId: sim.id, importance: 2 });
      }
      continue;
    }
    if (sim.flags[dueKey] === undefined) continue;
    // still due: retry, then miss after the grace period
    if (payBillNow(ctx, sim, bill, { allowOverdraft: bill.autopay })) continue;
    const dueAt = Number(sim.flags[dueKey]);
    if (now - dueAt >= BILL_GRACE_DAYS * DAY) {
      bill.missed += 1;
      sim.flags[`bill_paid_month:${bill.id}`] = monthKeyAt(ctx.state.epoch, dueAt);
      sim.flags[`bill_arrears:${bill.id}`] = round2(Number(sim.flags[`bill_arrears:${bill.id}`] ?? 0) + bill.amount);
      delete sim.flags[dueKey];
      adjustCredit(ctx, sim, -25, `missed ${bill.name}`);
      ctx.emit({ type: 'money:bill_missed', simId: sim.id, billId: bill.id, amount: bill.amount });
      notify(ctx, sim, 'Past due', `${bill.name}: ${formatMoney(bill.amount)} is now past due (missed ${bill.missed}×).`, `phone:bank:pay_bill:${bill.id}`);
      if (ctx.query.isControlled(sim.id)) ctx.log({ text: `You missed ${bill.name}. It has gone to past due.`, kind: 'money', simId: sim.id, importance: 2 });
    }
  }
}

function payArrears(ctx: Ctx, sim: Sim, bill: RecurringBill): boolean {
  const key = `bill_arrears:${bill.id}`;
  const owed = round2(Number(sim.flags[key] ?? 0));
  if (owed <= 0) return false;
  if (!chargeSim(ctx, sim, owed, `${bill.name} (past due)`, bill.category, { counterparty: bill.name })) return false;
  delete sim.flags[key];
  bill.lastPaidAt = ctx.state.time.minute;
  ctx.emit({ type: 'money:bill_paid', simId: sim.id, billId: bill.id, amount: owed });
  if (ctx.query.isControlled(sim.id)) ctx.log({ text: `Paid the past-due balance on ${bill.name}: ${formatMoney(owed)}.`, kind: 'money', simId: sim.id, importance: 1 });
  return true;
}

function loanCollateralVenue(ctx: Ctx, loan: LoanRef, sim: Sim): VenueId | undefined {
  if (loan.collateralId && ctx.state.venues[loan.collateralId as VenueId]) return loan.collateralId as VenueId;
  return ctx.query.homeOf(sim.id)?.id;
}

function processLoans(ctx: Ctx, sim: Sim): void {
  const now = ctx.state.time.minute;
  for (const loan of [...sim.finance.loans]) {
    if (loan.deferred || loan.nextDueAt > now) continue;
    const interest = round2((loan.balance * loan.apr) / 12);
    const payment = round2(Math.min(loan.monthlyPayment, loan.balance + interest));
    const paid = chargeSim(ctx, sim, payment, `${loan.lender} ${loan.kind} loan payment`, 'loan', { allowOverdraft: true, counterparty: loan.lender });
    if (paid) {
      loan.balance = round2(Math.max(0, loan.balance + interest - payment));
      loan.nextDueAt = now + 30 * DAY;
      if (loan.missedPayments > 0) loan.missedPayments = 0;
      loan.inDefault = false;
      if (loan.balance <= 0) {
        sim.finance.loans = sim.finance.loans.filter((l) => l.id !== loan.id);
        adjustCredit(ctx, sim, +10, 'loan paid off');
        ctx.log({ text: `${you(ctx, sim)} paid off the ${loan.lender} ${loan.kind} loan.`, kind: 'money', simId: sim.id, importance: 2 });
      }
      continue;
    }
    // missed
    loan.balance = round2(loan.balance + interest + LOAN_LATE_FEE);
    loan.missedPayments += 1;
    loan.nextDueAt = now + 30 * DAY;
    adjustCredit(ctx, sim, -50, `missed ${loan.kind} loan payment`);
    notify(ctx, sim, 'Loan payment missed', `${loan.lender}: ${formatMoney(payment)} payment missed (${loan.missedPayments} missed). Late fee ${formatMoney(LOAN_LATE_FEE)}.`, `phone:bank:pay_loan:${loan.id}`);
    if (ctx.query.isControlled(sim.id)) ctx.log({ text: `You missed a ${formatMoney(payment)} payment on your ${loan.lender} ${loan.kind} loan.`, kind: 'money', simId: sim.id, importance: 2 });
    if (loan.missedPayments >= 3 && !loan.inDefault) {
      loan.inDefault = true;
      ctx.emit({ type: 'money:loan_default', simId: sim.id, loanId: loan.id });
      ctx.log({ text: `${your(ctx, sim).replace(/^./, (ch) => ch.toUpperCase())} ${loan.kind} loan with ${loan.lender} is in default.`, kind: 'money', simId: sim.id, importance: 3 });
      if (ctx.query.isControlled(sim.id)) {
        ctx.interrupt({
          kind: 'phone_call',
          title: 'Collections',
          body: `"This is ${loan.lender} Recovery Services regarding your ${loan.kind} loan, ${loan.missedPayments} payments behind, balance ${formatMoney(loan.balance)}. We can take a payment right now."`,
          simId: sim.id,
          options: [{ label: `Make a payment (${formatMoney(payment)})`, actionId: `phone:bank:pay_loan:${loan.id}` }],
        });
      }
      notify(ctx, sim, 'Collections', `${loan.lender} has referred your ${loan.kind} loan to collections.`);
      if (loan.kind === 'auto' && loan.collateralId) {
        ctx.emit({ type: 'custom', kind: 'transport:repossess', simId: sim.id, payload: { vehicleId: loan.collateralId, loanId: loan.id } });
        sim.finance.loans = sim.finance.loans.filter((l) => l.id !== loan.id);
      }
      if (loan.kind === 'mortgage') {
        const v = loanCollateralVenue(ctx, loan, sim);
        if (v) ctx.emit({ type: 'money:eviction_warning', simId: sim.id, venueId: v });
      }
    } else if (loan.missedPayments >= 4 && loan.kind === 'mortgage') {
      const v = loanCollateralVenue(ctx, loan, sim);
      ctx.emit({ type: 'custom', kind: 'property:foreclose', simId: sim.id, payload: { venueId: v, loanId: loan.id, balance: loan.balance } });
      sim.finance.loans = sim.finance.loans.filter((l) => l.id !== loan.id);
    }
  }
}

export function netWorthOf(ctx: Ctx, sim: Sim): number {
  let assets = 0;
  let liabilities = 0;
  for (const a of sim.finance.accounts) {
    if (a.kind === 'credit_card') liabilities += a.balance;
    else assets += a.balance;
  }
  for (const l of sim.finance.loans) liabilities += l.balance;
  const hh = householdOf(ctx, sim);
  if (hh) {
    const members = Math.max(1, hh.simIds.filter((id) => ctx.state.sims[id]?.body.alive).length);
    for (const vid of hh.vehicleIds) {
      const v = ctx.state.vehicles[vid];
      if (v) assets += v.value / members;
    }
    const home = ctx.state.venues[hh.homeVenueId];
    const res = home?.residence;
    // home value share; the mortgage balance is already in `liabilities` via sim.finance.loans
    if (res && res.tenure === 'own' && home.ownerHouseholdId === hh.id) assets += res.marketValue / members;
  }
  return round2(assets - liabilities);
}

function recordNetWorth(ctx: Ctx, sim: Sim): void {
  const value = netWorthOf(ctx, sim);
  sim.finance.netWorthHistory.push({ at: ctx.state.time.minute, value });
  if (sim.finance.netWorthHistory.length > 400) sim.finance.netWorthHistory.splice(0, sim.finance.netWorthHistory.length - 400);
}

function driftEconomy(ctx: Ctx): void {
  const e = ctx.state.economy;
  const rng = ctx.rng;
  e.stockIndex = round2(Math.max(20, e.stockIndex * (1 + rng.normal(0.0003, 0.009))));
  e.gasPrice = round2(clamp(e.gasPrice + rng.normal(0, 0.02), 2.2, 6.5));
  e.inflationIndex = round2(e.inflationIndex * 1.0002 * 10000) / 10000;
  e.mortgageRate = round2(clamp(e.mortgageRate + rng.normal(0, 0.0004), 0.03, 0.095) * 10000) / 10000;
  e.jobMarketHeat = clamp(e.jobMarketHeat + rng.normal(0, 0.005), 0.05, 0.95);
}

function monthlyEconomy(ctx: Ctx): void {
  const e = ctx.state.economy;
  e.rentIndex = round2(e.rentIndex * (1 + ctx.rng.normal(0.003, 0.004)) * 1000) / 1000;
  e.savingsApy = round2(clamp(e.savingsApy + ctx.rng.normal(0, 0.001), 0.005, 0.06) * 10000) / 10000;
  e.unemploymentRate = round2(clamp(e.unemploymentRate + ctx.rng.normal(0, 0.001), 0.025, 0.12) * 1000) / 1000;
}

function recomputeCreditScore(ctx: Ctx, sim: Sim): void {
  const f = sim.finance;
  const cards = f.accounts.filter((a) => a.kind === 'credit_card');
  const limit = cards.reduce((s, c) => s + (c.creditLimit ?? 0), 0);
  const owed = cards.reduce((s, c) => s + c.balance, 0);
  const utilization = limit > 0 ? owed / limit : 0;
  let target = 700;
  if (utilization > 0.3) target -= (utilization - 0.3) * 200;
  else if (limit > 0 && utilization > 0) target += 15;
  const missedBills = f.bills.reduce((s, b) => s + b.missed, 0);
  const missedLoans = f.loans.reduce((s, l) => s + l.missedPayments + (l.inDefault ? 4 : 0), 0);
  target -= Math.min(200, missedBills * 15 + missedLoans * 30);
  const oldest = f.accounts.reduce((m, a) => Math.min(m, a.openedAt), ctx.state.time.minute);
  const ageMonths = (ctx.state.time.minute - oldest) / (30 * DAY) + Number(sim.flags.credit_history_months ?? 24);
  target += Math.min(40, ageMonths / 12 * 5);
  const inquiries = Number(sim.flags.credit_inquiries ?? 0);
  target -= Math.min(30, inquiries * 5);
  if (f.loans.length > 0 && missedLoans === 0) target += 10; // mix
  const chk = account(sim, 'checking');
  if (chk && chk.balance < 0) target -= 20;
  target = clamp(target, 300, 850);
  const delta = Math.round((target - f.creditScore) * 0.25);
  if (delta !== 0) adjustCredit(ctx, sim, delta, 'monthly review');
  sim.flags.credit_inquiries = Math.max(0, inquiries - 1);
}

function yearEndTaxes(ctx: Ctx, sim: Sim, year: number): void {
  const t = sim.finance.taxes;
  if (t.ytdIncome <= 0) return;
  const r = computeTaxes(t.ytdIncome, t.ytdWithheld, ctx.state.region.stateIncomeTax);
  const withheldTotal = t.ytdWithheld;
  t.owed = round2(t.owed + r.owed);
  t.refundPending = round2(t.refundPending + r.refund);
  sim.flags.tax_year_pending = year - 1;
  sim.flags.tax_year_income = round2(t.ytdIncome);
  t.ytdIncome = 0;
  t.ytdWithheld = 0;
  const deadline = minuteOfIsoDate(ctx.state.epoch, `${year}-04-15`);
  if (ctx.query.isControlled(sim.id)) {
    ctx.schedule({ atMinute: deadline, kind: 'tax_deadline', label: `Tax filing deadline (${year - 1} return)`, simId: sim.id, payload: { year: year - 1 } });
    notify(ctx, sim, 'W-2 available', `Your ${year - 1} tax documents are ready. ${r.refund > 0 ? `Estimated refund ${formatMoney(r.refund)}.` : r.owed > 0 ? `Estimated amount owed ${formatMoney(r.owed)}.` : 'You break even.'} File by April 15.`, 'phone:bank:file_taxes');
  }
  ctx.emit({ type: 'custom', kind: 'amenity:mail', simId: sim.id, payload: { from: 'Employer payroll', subject: `Form W-2 (${year - 1})`, body: `Wages ${formatMoney(Number(sim.flags.tax_year_income))}. Total tax withheld ${formatMoney(withheldTotal)}. ${r.refund > 0 ? `Estimated refund ${formatMoney(r.refund)}.` : `Estimated balance due ${formatMoney(r.owed)}.`}`, kind: 'tax' } });
}

function fileTaxes(ctx: Ctx, sim: Sim, fee: number): { ok: boolean; text: string } {
  const year = Number(sim.flags.tax_year_pending);
  if (!Number.isFinite(year)) return { ok: false, text: 'No return is pending.' };
  const t = sim.finance.taxes;
  if (fee > 0 && !chargeSim(ctx, sim, fee, 'Tax preparation', 'services')) return { ok: false, text: `You can't afford the ${formatMoney(fee)} preparation fee.` };
  let text = `You file your ${year} taxes${fee > 0 ? ' with an accountant' : ' using free filing software'}.`;
  if (t.refundPending > 0) {
    creditSim(ctx, sim.id, t.refundPending, `Tax refund (${year})`, 'refund');
    text += ` Refund: ${formatMoney(t.refundPending)}.`;
    t.refundPending = 0;
  }
  if (t.owed > 0) {
    if (chargeSim(ctx, sim, t.owed, `Federal & state taxes (${year})`, 'taxes')) {
      text += ` You paid ${formatMoney(t.owed)} owed.`;
      t.owed = 0;
    } else {
      text += ` You owe ${formatMoney(t.owed)} but couldn't pay; the balance remains due (pay it via your bank app).`;
    }
  }
  t.filedYears.push(year);
  delete sim.flags.tax_year_pending;
  delete sim.flags.tax_late;
  ctx.state.scheduled = ctx.state.scheduled.filter((e) => !(e.kind === 'tax_deadline' && e.simId === sim.id));
  ctx.log({ text, kind: 'money', simId: sim.id, importance: 2 });
  return { ok: true, text };
}

function ensureSnap(ctx: Ctx, sim: Sim): void {
  if (!sim.flags.snap_enrolled) return;
  const hh = householdOf(ctx, sim);
  const size = Math.max(1, hh?.simIds.length ?? 1);
  const amount = sim.finance.benefits.snap > 0 ? sim.finance.benefits.snap : round2(SNAP_BASE + SNAP_PER_EXTRA * (size - 1));
  sim.finance.benefits.snap = amount;
  creditSim(ctx, sim.id, amount, 'SNAP benefits', 'benefits');
  if (ctx.query.isControlled(sim.id)) ctx.log({ text: `SNAP benefits deposited: ${formatMoney(amount)} (groceries only).`, kind: 'money', simId: sim.id, importance: 1 });
}

function lottery(ctx: Ctx, sim: Sim): void {
  const r = ctx.rng.next();
  let prize = 0;
  if (r < 1e-7) prize = 20_000_000;
  else if (r < 1e-7 + 0.0009) prize = 10_000;
  else if (r < 1e-7 + 0.0009 + 0.009) prize = 500;
  else if (r < 1e-7 + 0.0009 + 0.009 + 0.06) prize = 20;
  else if (r < 1e-7 + 0.0009 + 0.009 + 0.06 + 0.13) prize = 2;
  if (prize > 0) {
    creditSim(ctx, sim.id, prize, 'Lottery winnings', 'windfall');
    ctx.log({ text: prize >= 10_000 ? `${you(ctx, sim)} WON ${formatMoney(prize, { cents: false })} on a lottery ticket!` : `${you(ctx, sim)} won ${formatMoney(prize)} on a scratch-off.`, kind: 'money', simId: sim.id, importance: prize >= 500 ? 3 : 1 });
    if (prize >= 10_000) ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'happy', label: 'Lottery winner', intensity: 30, durationMinutes: 3 * DAY }] }, 'finance:lottery');
  } else {
    ctx.log({ text: `${you(ctx, sim)} scratch${ctx.query.isControlled(sim.id) ? '' : 'es'} the ticket. Nothing.`, kind: 'money', simId: sim.id, importance: 0 });
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const PHONE_REQ: Requirement = { kind: 'flag', reason: 'Your phone is dead', params: { flag: 'phone_dead', not: true } };

function moneyReq(amount: number): Requirement {
  return { kind: 'money', reason: `Costs ${formatMoney(amount)}`, params: { amount, noCredit: true } };
}

function act(id: string, label: string, category: ActionDef['category'], minutes: number, extra: Partial<ActionDef> = {}): ActionDef {
  return { id, label, category, durationMinutes: minutes, effects: {}, interruptible: true, ...extra };
}

function dueBills(sim: Sim): RecurringBill[] {
  return sim.finance.bills.filter((b) => sim.flags[`bill_due:${b.id}`] !== undefined || Number(sim.flags[`bill_arrears:${b.id}`] ?? 0) > 0);
}

function balanceSummary(sim: Sim): string {
  const parts = sim.finance.accounts.map((a) => `${a.kind === 'credit_card' ? `${a.bankName} card owes` : a.kind === 'cash' ? 'Cash' : `${a.bankName} ${a.kind}`}: ${formatMoney(a.balance)}${a.kind === 'credit_card' && a.creditLimit ? ` / limit ${formatMoney(a.creditLimit, { cents: false })}` : ''}`);
  const loans = sim.finance.loans.map((l) => `${l.lender} ${l.kind} loan: ${formatMoney(l.balance)} (${formatMoney(l.monthlyPayment)}/mo${l.missedPayments ? `, ${l.missedPayments} missed` : ''})`);
  const due = dueBills(sim).map((b) => `${b.name} due ${formatMoney(b.amount + Number(sim.flags[`bill_arrears:${b.id}`] ?? 0))}`);
  return [...parts, ...loans, ...due, `Credit score ${sim.finance.creditScore}`].join(' · ');
}

function financeActions(ctx: Ctx, simId: SimId): ActionDef[] {
  const sim = ctx.query.sim(simId);
  const venue = ctx.query.venue(sim.location.venueId);
  const out: ActionDef[] = [];
  const cash = account(sim, 'cash');
  const chk = account(sim, 'checking');
  const sav = account(sim, 'savings');
  const cards = sim.finance.accounts.filter((a) => a.kind === 'credit_card');
  const isAdult = sim.lifeStage !== 'infant' && sim.lifeStage !== 'toddler' && sim.lifeStage !== 'child';
  if (!isAdult) return out;
  const group = 'Bank';

  if (venue.archetype === 'bank') {
    if (!sav) out.push(act('finance:open_savings', 'Open a savings account', 'finance', 20, { group, description: `Earns ${(ctx.state.economy.savingsApy * 100).toFixed(2)}% APY.`, target: { kind: 'venue', id: venue.id, name: venue.name } }));
    if (cards.length < 3) {
      const terms = creditCardTerms(sim.finance.creditScore);
      out.push(act('finance:open_credit_card', 'Apply for a credit card', 'finance', 25, { group, description: terms ? `Likely limit ${formatMoney(terms.limit, { cents: false })} at ${(terms.apr * 100).toFixed(1)}% APR.` : 'Your credit score is below 600; you will probably be declined.' }));
    }
    {
      const terms = personalLoanTerms(sim.finance.creditScore);
      out.push(act('finance:apply_loan', 'Apply for a personal loan', 'finance', 30, { group, params: { amount: 2000 }, description: terms ? `Up to ${formatMoney(terms.maxAmount, { cents: false })} at ${(terms.apr * 100).toFixed(1)}% APR, 36 months.` : 'Below 600 credit: likely declined.' }));
    }
    if (cash && cash.balance > 0 && chk) out.push(act('finance:deposit', 'Deposit cash', 'finance', 10, { group, params: { amount: cash.balance } }));
    if (chk && chk.balance > 0) out.push(act('finance:withdraw', 'Withdraw cash', 'finance', 10, { group, params: { amount: Math.min(100, chk.balance) } }));
    for (const cc of cards) if (cc.balance > 0) out.push(act(`finance:pay_credit_card:${cc.id}`, `Pay ${cc.bankName} card (${formatMoney(cc.balance)} owed)`, 'finance', 10, { group, params: { amount: 'min' } }));
    for (const loan of sim.finance.loans) out.push(act(`finance:payoff_loan:${loan.id}`, `Pay off ${loan.lender} ${loan.kind} loan (${formatMoney(loan.balance)})`, 'finance', 15, { group, requirements: [moneyReq(loan.balance)] }));
    out.push(act('finance:cashiers_check', "Get a cashier's check", 'finance', 15, { group, params: { amount: 500 }, description: `${formatMoney(CASHIERS_CHECK_FEE)} fee.` }));
    out.push(act('finance:invest', 'Invest in an index fund', 'finance', 20, { group, params: { amount: 500 }, description: `Tracks the market (index ${ctx.state.economy.stockIndex.toFixed(1)}).` }));
    if (Number(sim.flags.brokerage_units ?? 0) > 0) out.push(act('finance:sell_investments', 'Sell investments', 'finance', 20, { group, params: { amount: 500 } }));
  }
  if (venue.archetype === 'atm' || ctx.query.findObject(venue.id, 'atm_machine')) {
    const own = chk ? venue.name.toLowerCase().includes(chk.bankName.toLowerCase().split(' ')[0]) : false;
    const fee = own ? 0 : ATM_FEE;
    if (chk && chk.balance > 0) out.push(act('finance:atm_withdraw', `Withdraw cash at ATM${fee ? ` (${formatMoney(fee)} fee)` : ''}`, 'finance', 3, { group, params: { amount: Math.min(100, chk.balance), fee } }));
    if (cash && cash.balance > 0 && chk) out.push(act('finance:atm_deposit', 'Deposit cash at ATM', 'finance', 4, { group, params: { amount: cash.balance, fee } }));
  }
  if (venue.archetype === 'accountant' && sim.flags.tax_year_pending !== undefined) {
    out.push(act('finance:file_taxes_accountant', `File taxes with an accountant (${formatMoney(ACCOUNTANT_FEE)})`, 'finance', 60, { group, requirements: [moneyReq(ACCOUNTANT_FEE)] }));
  }
  if (venue.archetype === 'courthouse') {
    for (const t of sim.legal.tickets.filter((x) => !x.paid)) out.push(act(`finance:pay_ticket:${t.id}`, `Pay ${t.kind} ticket (${formatMoney(t.amount)})`, 'finance', 15, { group: 'Legal', requirements: [moneyReq(t.amount)] }));
  }

  // --- phone banking (anywhere) ---
  const pg = 'Bank app';
  const preq = [PHONE_REQ];
  out.push(act('phone:bank:check_balance', 'Check balances', 'phone', 0, { group: pg, requirements: preq, icon: 'wallet' }));
  if (chk && sav && chk.balance > 0) out.push(act('phone:bank:transfer_to_savings', 'Transfer to savings', 'phone', 1, { group: pg, requirements: preq, params: { amount: Math.min(100, chk.balance) } }));
  if (chk && sav && sav.balance > 0) out.push(act('phone:bank:transfer_to_checking', 'Transfer to checking', 'phone', 1, { group: pg, requirements: preq, params: { amount: Math.min(100, sav.balance) } }));
  for (const b of dueBills(sim)) {
    const total = round2((sim.flags[`bill_due:${b.id}`] !== undefined ? b.amount : 0) + Number(sim.flags[`bill_arrears:${b.id}`] ?? 0));
    out.push(act(`phone:bank:pay_bill:${b.id}`, `Pay ${b.name} now (${formatMoney(total)})`, 'phone', 2, { group: pg, requirements: [...preq, moneyReq(total)] }));
  }
  for (const b of sim.finance.bills) out.push(act(`phone:bank:autopay:${b.id}`, `${b.autopay ? 'Turn off' : 'Set up'} autopay: ${b.name}`, 'phone', 1, { group: pg, requirements: preq }));
  for (const cc of cards) {
    if (cc.balance > 0) out.push(act(`phone:bank:pay_credit_card:${cc.id}`, `Pay ${cc.bankName} card (${formatMoney(cc.balance)} owed)`, 'phone', 2, { group: pg, requirements: preq, params: { amount: 'min' } }));
  }
  if (cards.length) out.push(act('phone:bank:cc_autopay', `${sim.flags.cc_autopay ? 'Turn off' : 'Turn on'} credit card autopay`, 'phone', 1, { group: pg, requirements: preq }));
  for (const loan of sim.finance.loans) {
    out.push(act(`phone:bank:pay_loan:${loan.id}`, `Make ${loan.lender} ${loan.kind} loan payment (${formatMoney(loan.monthlyPayment)})`, 'phone', 2, { group: pg, requirements: [...preq, moneyReq(loan.monthlyPayment)] }));
  }
  if (chk) out.push(act('phone:bank:invest', 'Invest in an index fund', 'phone', 3, { group: pg, requirements: preq, params: { amount: 100 } }));
  if (Number(sim.flags.brokerage_units ?? 0) > 0) out.push(act('phone:bank:sell_investments', 'Sell investments', 'phone', 3, { group: pg, requirements: preq, params: { amount: 100 } }));
  if (sim.flags.tax_year_pending !== undefined) out.push(act('phone:bank:file_taxes', `File ${sim.flags.tax_year_pending} taxes (free software)`, 'phone', 90, { group: pg, requirements: preq }));
  if (sim.finance.taxes.owed > 0 && sim.flags.tax_year_pending === undefined) out.push(act('phone:bank:pay_taxes', `Pay tax balance (${formatMoney(sim.finance.taxes.owed)})`, 'phone', 3, { group: pg, requirements: [...preq, moneyReq(sim.finance.taxes.owed)] }));
  for (const t of sim.legal.tickets.filter((x) => !x.paid)) out.push(act(`phone:bank:pay_ticket:${t.id}`, `Pay ${t.kind} ticket online (${formatMoney(t.amount)})`, 'phone', 3, { group: pg, requirements: [...preq, moneyReq(t.amount)] }));
  for (const otherId of sim.phone.contacts) {
    const other = ctx.state.sims[otherId];
    if (!other || !other.body.alive) continue;
    out.push(act(`phone:bank:send:${otherId}`, `Send money to ${other.identity.firstName}`, 'phone', 1, { group: pg, requirements: preq, params: { amount: 20 }, target: { kind: 'sim', id: otherId, name: other.identity.firstName } }));
  }
  return out;
}

function parseAmount(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return isFiniteNumber(n) && n > 0 ? round2(n) : fallback;
}

function moveBetween(ctx: Ctx, sim: Sim, from: Account, to: Account, amount: number, memo: string): boolean {
  amount = round2(Math.min(amount, from.balance));
  if (amount <= 0) return false;
  from.balance = round2(from.balance - amount);
  to.balance = round2(to.balance + amount);
  recordTx(ctx, sim, from.id, -amount, memo, 'transfer');
  recordTx(ctx, sim, to.id, amount, memo, 'transfer');
  return true;
}

function payCard(ctx: Ctx, sim: Sim, cc: Account, amountParam: unknown): { ok: boolean; text: string } {
  let amount: number;
  if (amountParam === 'full') amount = cc.balance;
  else if (amountParam === 'min' || amountParam === undefined) amount = cc.minPaymentAmount && cc.minPaymentAmount > 0 ? cc.minPaymentAmount : Math.min(cc.balance, Math.max(25, cc.balance * 0.02));
  else amount = parseAmount(amountParam, 25);
  amount = round2(Math.min(amount, cc.balance));
  if (amount <= 0) return { ok: false, text: 'Nothing owed.' };
  if (!chargeSim(ctx, sim, amount, `${cc.bankName} card payment`, 'credit_card', { allowHousehold: false })) return { ok: false, text: `You don't have ${formatMoney(amount)} available.` };
  cc.balance = round2(cc.balance - amount);
  if (cc.minPaymentAmount && amount >= cc.minPaymentAmount) cc.minPaymentAmount = 0;
  if (cc.balance <= 0) {
    cc.balance = 0;
    cc.minPaymentAmount = 0;
  }
  ctx.emit({ type: 'money:bill_paid', simId: sim.id, billId: cc.id, amount });
  return { ok: true, text: `Paid ${formatMoney(amount)} toward your ${cc.bankName} card. Balance ${formatMoney(cc.balance)}.` };
}

function executeFinance(ctx: Ctx, simId: SimId, action: ActionDef, params: Record<string, unknown>): { ok: boolean; text?: string; data?: Record<string, unknown> } {
  const sim = ctx.query.sim(simId);
  const now = ctx.state.time.minute;
  const parts = action.id.split(':');
  const phone = action.id.startsWith('phone:bank:');
  const op = phone ? parts[2] : parts[1];
  const target = (phone ? parts.slice(3) : parts.slice(2)).join(':');
  const cash = account(sim, 'cash');
  const chk = account(sim, 'checking');
  const sav = account(sim, 'savings');
  const venue = ctx.query.venue(sim.location.venueId);
  const bankName = venue.archetype === 'bank' ? venue.name : chk?.bankName ?? 'First National';

  switch (op) {
    case 'check_balance':
      return { ok: true, text: balanceSummary(sim), data: { accounts: sim.finance.accounts, loans: sim.finance.loans, bills: sim.finance.bills } };
    case 'open_savings': {
      if (sav) return { ok: false, text: 'You already have a savings account.' };
      const acc: Account = { id: shortId(ctx.rng, 'acc'), kind: 'savings', bankName, balance: 0, apy: ctx.state.economy.savingsApy, openedAt: now, overdraftFeesThisMonth: 0, frozen: false };
      sim.finance.accounts.push(acc);
      ctx.log({ text: `You open a savings account at ${bankName} (${(acc.apy! * 100).toFixed(2)}% APY).`, kind: 'money', simId, importance: 1 });
      return { ok: true, text: `Savings account opened at ${bankName}.` };
    }
    case 'open_credit_card': {
      sim.flags.credit_inquiries = Number(sim.flags.credit_inquiries ?? 0) + 1;
      const terms = creditCardTerms(sim.finance.creditScore);
      if (!terms) {
        ctx.log({ text: `${bankName} declined your credit card application (score ${sim.finance.creditScore}).`, kind: 'money', simId, importance: 1 });
        return { ok: true, text: `Declined. Your credit score of ${sim.finance.creditScore} is below their minimum of 600.` };
      }
      const acc: Account = { id: shortId(ctx.rng, 'acc'), kind: 'credit_card', bankName, balance: 0, creditLimit: terms.limit, apr: terms.apr, openedAt: now, overdraftFeesThisMonth: 0, frozen: false, minPaymentAmount: 0 };
      sim.finance.accounts.push(acc);
      ctx.log({ text: `Approved: a ${bankName} credit card with a ${formatMoney(terms.limit, { cents: false })} limit at ${(terms.apr * 100).toFixed(1)}% APR.`, kind: 'money', simId, importance: 2 });
      return { ok: true, text: `Approved for a ${formatMoney(terms.limit, { cents: false })} limit at ${(terms.apr * 100).toFixed(1)}% APR.` };
    }
    case 'apply_loan': {
      sim.flags.credit_inquiries = Number(sim.flags.credit_inquiries ?? 0) + 1;
      const terms = personalLoanTerms(sim.finance.creditScore);
      const amount = parseAmount(params.amount, 2000);
      if (!terms) return { ok: true, text: `Declined. Score ${sim.finance.creditScore} is too low for an unsecured loan.` };
      if (amount > terms.maxAmount) return { ok: true, text: `Declined for ${formatMoney(amount)}; the most they'd lend you is ${formatMoney(terms.maxAmount, { cents: false })}.` };
      const loan: LoanRef = { id: shortId(ctx.rng, 'loan'), kind: 'personal', lender: bankName, principal: amount, balance: amount, apr: terms.apr, monthlyPayment: monthlyPayment(amount, terms.apr, 36), nextDueAt: now + 30 * DAY, missedPayments: 0, termMonths: 36, startedAt: now, inDefault: false, deferred: false };
      sim.finance.loans.push(loan);
      creditSim(ctx, simId, amount, `${bankName} personal loan`, 'loan', 'checking');
      ctx.log({ text: `Approved: a ${formatMoney(amount)} personal loan at ${(terms.apr * 100).toFixed(1)}% APR, ${formatMoney(loan.monthlyPayment)}/month for 36 months.`, kind: 'money', simId, importance: 2 });
      return { ok: true, text: `Approved for ${formatMoney(amount)} at ${(terms.apr * 100).toFixed(1)}% APR. Payment ${formatMoney(loan.monthlyPayment)}/month.` };
    }
    case 'deposit':
    case 'atm_deposit': {
      if (!cash || !chk) return { ok: false, text: 'No account to deposit into.' };
      const amount = Math.min(parseAmount(params.amount, cash.balance), cash.balance);
      const fee = op === 'atm_deposit' ? parseAmount(params.fee, 0) : 0;
      if (amount <= 0) return { ok: false, text: 'No cash to deposit.' };
      moveBetween(ctx, sim, cash, chk, amount, 'Cash deposit');
      if (fee > 0) chargeSim(ctx, sim, fee, 'ATM fee', 'fee', { allowHousehold: false });
      return { ok: true, text: `Deposited ${formatMoney(amount)}. Checking: ${formatMoney(chk.balance)}.` };
    }
    case 'withdraw':
    case 'atm_withdraw': {
      if (!cash || !chk) return { ok: false, text: 'No account.' };
      const fee = op === 'atm_withdraw' ? parseAmount(params.fee, 0) : 0;
      const amount = Math.min(parseAmount(params.amount, 60), chk.balance - fee);
      if (amount <= 0) return { ok: false, text: 'Insufficient funds.' };
      moveBetween(ctx, sim, chk, cash, amount, 'Cash withdrawal');
      if (fee > 0) chargeSim(ctx, sim, fee, 'ATM fee', 'fee', { allowHousehold: false });
      return { ok: true, text: `Withdrew ${formatMoney(amount)}${fee ? ` (${formatMoney(fee)} fee)` : ''}. Cash: ${formatMoney(cash.balance)}.` };
    }
    case 'transfer_to_savings': {
      if (!chk || !sav) return { ok: false, text: 'You need both a checking and a savings account.' };
      const amount = parseAmount(params.amount, 100);
      if (!moveBetween(ctx, sim, chk, sav, amount, 'Transfer to savings')) return { ok: false, text: 'Nothing to transfer.' };
      return { ok: true, text: `Moved ${formatMoney(Math.min(amount, chk.balance + amount))} to savings. Savings: ${formatMoney(sav.balance)}.` };
    }
    case 'transfer_to_checking': {
      if (!chk || !sav) return { ok: false, text: 'You need both accounts.' };
      const amount = parseAmount(params.amount, 100);
      if (!moveBetween(ctx, sim, sav, chk, amount, 'Transfer to checking')) return { ok: false, text: 'Nothing to transfer.' };
      return { ok: true, text: `Moved money to checking. Checking: ${formatMoney(chk.balance)}.` };
    }
    case 'pay_credit_card': {
      const cc = sim.finance.accounts.find((a) => a.kind === 'credit_card' && a.id === target) ?? sim.finance.accounts.find((a) => a.kind === 'credit_card');
      if (!cc) return { ok: false, text: 'No credit card.' };
      return payCard(ctx, sim, cc, params.amount);
    }
    case 'cc_autopay':
      sim.flags.cc_autopay = !sim.flags.cc_autopay;
      return { ok: true, text: `Credit card autopay ${sim.flags.cc_autopay ? 'on' : 'off'}.` };
    case 'pay_loan':
    case 'payoff_loan': {
      const loan = sim.finance.loans.find((l) => l.id === target);
      if (!loan) return { ok: false, text: 'No such loan.' };
      const amount = op === 'payoff_loan' ? loan.balance : parseAmount(params.amount, loan.monthlyPayment);
      if (!chargeSim(ctx, sim, amount, `${loan.lender} ${loan.kind} loan payment`, 'loan', { allowHousehold: true })) return { ok: false, text: `You can't cover ${formatMoney(amount)}.` };
      loan.balance = round2(Math.max(0, loan.balance - amount));
      if (amount >= loan.monthlyPayment) {
        if (loan.nextDueAt <= now) loan.nextDueAt = now + 30 * DAY;
        if (loan.missedPayments > 0) loan.missedPayments -= 1;
        if (loan.missedPayments === 0) loan.inDefault = false;
      }
      if (loan.balance <= 0) {
        sim.finance.loans = sim.finance.loans.filter((l) => l.id !== loan.id);
        adjustCredit(ctx, sim, +10, 'loan paid off');
        ctx.log({ text: `You paid off your ${loan.lender} ${loan.kind} loan.`, kind: 'money', simId, importance: 2 });
        return { ok: true, text: `Loan paid in full.` };
      }
      return { ok: true, text: `Paid ${formatMoney(amount)}. Balance ${formatMoney(loan.balance)}.` };
    }
    case 'cashiers_check': {
      const amount = parseAmount(params.amount, 500);
      if (!chargeSim(ctx, sim, amount + CASHIERS_CHECK_FEE, `Cashier's check`, 'fee', { allowHousehold: false })) return { ok: false, text: `You don't have ${formatMoney(amount + CASHIERS_CHECK_FEE)}.` };
      sim.inventory.consumables.cashiers_check = (sim.inventory.consumables.cashiers_check ?? 0) + 1;
      sim.flags.cashiers_check_value = amount;
      return { ok: true, text: `You get a cashier's check for ${formatMoney(amount)} (${formatMoney(CASHIERS_CHECK_FEE)} fee).` };
    }
    case 'invest': {
      const amount = parseAmount(params.amount, 100);
      if (!chargeSim(ctx, sim, amount, 'Index fund purchase', 'investment', { allowHousehold: false })) return { ok: false, text: `You don't have ${formatMoney(amount)} to invest.` };
      let brok = account(sim, 'brokerage');
      if (!brok) {
        brok = { id: shortId(ctx.rng, 'acc'), kind: 'brokerage', bankName: 'Vanguard', balance: 0, openedAt: now, overdraftFeesThisMonth: 0, frozen: false };
        sim.finance.accounts.push(brok);
      }
      const units = round2(Number(sim.flags.brokerage_units ?? 0) + amount / ctx.state.economy.stockIndex * 100) / 100;
      sim.flags.brokerage_units = units;
      brok.balance = round2(units * ctx.state.economy.stockIndex);
      recordTx(ctx, sim, brok.id, amount, 'Index fund purchase', 'investment');
      return { ok: true, text: `Invested ${formatMoney(amount)}. Portfolio value ${formatMoney(brok.balance)}.` };
    }
    case 'sell_investments': {
      const brok = account(sim, 'brokerage');
      const units = Number(sim.flags.brokerage_units ?? 0);
      if (!brok || units <= 0) return { ok: false, text: 'Nothing to sell.' };
      const value = units * ctx.state.economy.stockIndex;
      const amount = Math.min(parseAmount(params.amount, value), value);
      const soldUnits = amount / ctx.state.economy.stockIndex;
      sim.flags.brokerage_units = round2(Math.max(0, units - soldUnits) * 100) / 100;
      brok.balance = round2(Number(sim.flags.brokerage_units) * ctx.state.economy.stockIndex);
      recordTx(ctx, sim, brok.id, -amount, 'Index fund sale', 'investment');
      creditSim(ctx, simId, amount, 'Investment sale proceeds', 'investment', 'checking');
      return { ok: true, text: `Sold ${formatMoney(amount)} of your index fund. Portfolio value ${formatMoney(brok.balance)}.` };
    }
    case 'pay_bill': {
      const bill = sim.finance.bills.find((b) => b.id === target);
      if (!bill) return { ok: false, text: 'No such bill.' };
      let paidAny = false;
      if (sim.flags[`bill_due:${bill.id}`] !== undefined) paidAny = payBillNow(ctx, sim, bill, { allowOverdraft: false }) || paidAny;
      if (Number(sim.flags[`bill_arrears:${bill.id}`] ?? 0) > 0) paidAny = payArrears(ctx, sim, bill) || paidAny;
      if (!paidAny) return { ok: false, text: `You can't cover ${bill.name} right now.` };
      return { ok: true, text: `${bill.name} paid.` };
    }
    case 'autopay': {
      const bill = sim.finance.bills.find((b) => b.id === target);
      if (!bill) return { ok: false, text: 'No such bill.' };
      bill.autopay = !bill.autopay;
      return { ok: true, text: `Autopay ${bill.autopay ? 'enabled' : 'disabled'} for ${bill.name}.` };
    }
    case 'file_taxes':
      return fileTaxes(ctx, sim, 0);
    case 'file_taxes_accountant':
      return fileTaxes(ctx, sim, ACCOUNTANT_FEE);
    case 'pay_taxes': {
      const owed = sim.finance.taxes.owed;
      if (owed <= 0) return { ok: false, text: 'Nothing owed.' };
      if (!chargeSim(ctx, sim, owed, 'Tax balance', 'taxes')) return { ok: false, text: `You can't cover ${formatMoney(owed)}.` };
      sim.finance.taxes.owed = 0;
      return { ok: true, text: `Paid ${formatMoney(owed)} in taxes.` };
    }
    case 'pay_ticket': {
      const t = sim.legal.tickets.find((x) => x.id === target && !x.paid);
      if (!t) return { ok: false, text: 'No such ticket.' };
      if (!chargeSim(ctx, sim, t.amount, `${t.kind} ticket`, 'fine')) return { ok: false, text: `You can't cover ${formatMoney(t.amount)}.` };
      t.paid = true;
      ctx.log({ text: `You paid the ${formatMoney(t.amount)} ${t.kind} ticket.`, kind: 'money', simId, importance: 1 });
      return { ok: true, text: `Ticket paid.` };
    }
    case 'send': {
      const other = ctx.state.sims[target as SimId];
      if (!other) return { ok: false, text: 'Unknown contact.' };
      const amount = parseAmount(params.amount, 20);
      if (!chargeSim(ctx, sim, amount, `Sent to ${other.identity.firstName}`, 'transfer', { allowHousehold: false })) return { ok: false, text: `You don't have ${formatMoney(amount)}.` };
      creditSim(ctx, other.id, amount, `From ${sim.identity.firstName}`, 'transfer', 'checking');
      ctx.applyEffects(simId, { relationships: [{ simId: other.id, friendship: 2, trust: 1 }] }, 'finance:send');
      const rel = sim.relationships[other.id];
      if (rel) rel.moneyOwed = round2(rel.moneyOwed + amount);
      const back = other.relationships[simId];
      if (back) back.moneyOwed = round2(back.moneyOwed - amount);
      ctx.log({ text: `You sent ${other.identity.firstName} ${formatMoney(amount)}.`, kind: 'money', simId, importance: 1 });
      return { ok: true, text: `Sent ${formatMoney(amount)} to ${other.identity.firstName}.` };
    }
    default:
      return { ok: false, text: `Unknown finance action ${op}` };
  }
}

// ---------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------
export const financeSystem: System = {
  id: 'finance',
  intervalMinutes: 60,

  onInit(ctx) {
    for (const sim of Object.values(ctx.state.sims)) {
      if (!sim.finance.accounts.some((a) => a.kind === 'checking') && sim.lifeStage !== 'infant' && sim.lifeStage !== 'toddler' && sim.lifeStage !== 'child') {
        sim.finance.accounts.push({ id: shortId(ctx.rng, 'acc'), kind: 'checking', bankName: 'First National', balance: 0, openedAt: ctx.state.time.minute, overdraftFeesThisMonth: 0, frozen: false, apy: 0.0001 });
      }
      sim.finance.creditScore = clamp(Math.round(sim.finance.creditScore || 650), 300, 850);
    }
  },

  onTick(ctx) {
    // hourly: revalue brokerage for controlled sims so the UI stays current
    for (const sim of ctx.query.controlledSims()) {
      const units = Number(sim.flags.brokerage_units ?? 0);
      const brok = account(sim, 'brokerage');
      if (brok && units > 0) brok.balance = round2(units * ctx.state.economy.stockIndex);
    }
  },

  onEvent(ctx, event: GameEvent) {
    switch (event.type) {
      case 'time:day': {
        driftEconomy(ctx);
        for (const sim of financeSims(ctx)) {
          accrueInterest(ctx, sim);
          processCreditCards(ctx, sim);
          processBills(ctx, sim);
          processLoans(ctx, sim);
          if (ctx.query.isControlled(sim.id) || sim.lod === 'full') recordNetWorth(ctx, sim);
        }
        break;
      }
      case 'time:month': {
        monthlyEconomy(ctx);
        for (const sim of financeSims(ctx)) {
          for (const a of sim.finance.accounts) a.overdraftFeesThisMonth = 0;
          recomputeCreditScore(ctx, sim);
          ensureSnap(ctx, sim);
          if (sim.finance.taxes.owed > 0 && sim.flags.tax_late) {
            sim.finance.taxes.owed = round2(sim.finance.taxes.owed * 1.005 + 0);
          }
        }
        break;
      }
      case 'time:year': {
        for (const sim of financeSims(ctx)) yearEndTaxes(ctx, sim, event.year);
        break;
      }
      case 'money:paycheck': {
        const sim = ctx.state.sims[event.simId];
        if (!sim) break;
        const gross = isFiniteNumber(event.gross) ? event.gross : 0;
        const net = isFiniteNumber(event.net) ? event.net : gross;
        sim.finance.taxes.ytdIncome = round2(sim.finance.taxes.ytdIncome + gross);
        sim.finance.taxes.ytdWithheld = round2(sim.finance.taxes.ytdWithheld + Math.max(0, gross - net));
        const job = sim.career.job;
        if (job?.benefits.retirement401k && gross > 0) {
          const pct = isFiniteNumber(sim.flags.k401_pct) ? clamp(Number(sim.flags.k401_pct), 0, 0.5) : DEFAULT_401K_PCT;
          const contrib = round2(gross * pct);
          const match = round2(gross * Math.min(pct, job.benefits.matchPct ?? 0));
          if (contrib > 0 && chargeSim(ctx, sim, contrib, '401(k) contribution', 'retirement', { allowHousehold: false })) {
            let ret = account(sim, 'retirement');
            if (!ret) {
              ret = { id: shortId(ctx.rng, 'acc'), kind: 'retirement', bankName: 'Fidelity 401(k)', balance: 0, openedAt: ctx.state.time.minute, overdraftFeesThisMonth: 0, frozen: false };
              sim.finance.accounts.push(ret);
            }
            ret.balance = round2(ret.balance + contrib + match);
            recordTx(ctx, sim, ret.id, contrib + match, `401(k) contribution${match ? ' + employer match' : ''}`, 'retirement');
          }
        }
        break;
      }
      case 'money:insufficient': {
        const sim = ctx.state.sims[event.simId];
        if (!sim || !isFiniteNumber(event.amount) || event.amount <= 0) break;
        if (event.amount <= OVERDRAFT_LIMIT) overdraft(ctx, sim, event.amount, event.memo, 'overdraft');
        break;
      }
      case 'legal:ticket': {
        const sim = ctx.state.sims[event.simId];
        if (sim && ctx.query.isControlled(sim.id)) notify(ctx, sim, 'Ticket issued', `${event.kind}: ${formatMoney(event.amount)}. Pay it through your bank app or at the courthouse.`);
        break;
      }
      case 'scheduled:fired': {
        const ev = event.event;
        if (ev.kind === 'tax_deadline' && ev.simId) {
          const sim = ctx.state.sims[ev.simId];
          if (!sim || sim.flags.tax_year_pending === undefined) break;
          const t = sim.finance.taxes;
          const penalty = t.owed > 0 ? round2(Math.max(50, t.owed * 0.05)) : 0;
          t.owed = round2(t.owed + penalty);
          sim.flags.tax_late = true;
          ctx.emit({ type: 'civic:tax_deadline', simId: sim.id });
          ctx.log({ text: `April 15 passed and you never filed your taxes.${penalty ? ` Failure-to-file penalty: ${formatMoney(penalty)}.` : ' No penalty since you were owed a refund, but the IRS is holding it until you file.'}`, kind: 'alert', simId: sim.id, importance: 2 });
          notify(ctx, sim, 'IRS notice', penalty ? `You missed the filing deadline. Penalty ${formatMoney(penalty)} added.` : 'You missed the filing deadline. File to claim your refund.', 'phone:bank:file_taxes');
        }
        break;
      }
      case 'custom': {
        const sim = event.simId ? ctx.state.sims[event.simId] : undefined;
        if (!sim) break;
        const p = event.payload ?? {};
        if (event.kind === 'finance:withdraw') {
          const chk = account(sim, 'checking');
          const cash = account(sim, 'cash');
          if (chk && cash) {
            const amount = Math.min(parseAmount(p.amount, 60), chk.balance);
            if (amount > 0) moveBetween(ctx, sim, chk, cash, amount, 'Cash withdrawal');
          }
        } else if (event.kind === 'finance:deposit') {
          const chk = account(sim, 'checking');
          const cash = account(sim, 'cash');
          if (chk && cash && cash.balance > 0) moveBetween(ctx, sim, cash, chk, parseAmount(p.amount, cash.balance), 'Cash deposit');
        } else if (event.kind === 'finance:lottery_ticket') {
          lottery(ctx, sim);
        } else if (event.kind === 'finance:charge') {
          const amount = parseAmount(p.amount, 0);
          if (amount > 0) chargeSim(ctx, sim, amount, String(p.memo ?? 'Charge'), String(p.category ?? 'misc'), { allowOverdraft: true });
        } else if (event.kind === 'finance:credit') {
          const amount = parseAmount(p.amount, 0);
          if (amount > 0) creditSim(ctx, sim.id, amount, String(p.memo ?? 'Credit'), String(p.category ?? 'income'));
        }
        break;
      }
      default:
        break;
    }
  },

  actions: financeActions,
  handles: (id) => id.startsWith('finance:') || id.startsWith('phone:bank:'),
  execute: (ctx, simId, action, params) => executeFinance(ctx, simId, action, params),
};
