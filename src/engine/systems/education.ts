/**
 * Education system — K-12 (automatic enrollment, attendance, homework, report cards,
 * truancy) and adult education (programs, tuition, loans, lectures, study, exams,
 * GPA, graduation, certifications) plus library actions.
 *
 * Owns: `sim.education.*`, `sim.schedule` blocks of kind 'school', `sim.flags` prefixed `edu_`.
 * Emits: `education:*` (core/events.ts), `phone:notification` to parents, `amenity:mail` for truancy letters.
 * Consumes: `time:day`, `time:week`, `scheduled:fired` (kinds `homework_due`, `exam`, `_term_end`),
 *           `action:completed` for `education:*`, `sim:aged_up`, `family:*`, `world:new_game`.
 */
import type { ProgramDef } from '../content/types';
import { dayIndex, minuteOfDay, weekdayAt } from '../core/clock';
import type { GameEvent } from '../core/events';
import { shortId } from '../core/ids';
import type { ActionResult, System, SystemContext } from '../core/systems';
import type { ActionDef, Course, Degree, EducationLevel, Enrollment, LoanRef, Requirement, Sim, SimId, Venue, VenueId } from '../core/types';
import { clamp, clamp100, DAY, formatMoney, HOUR, round2 } from '../core/util';

// ---------------------------------------------------------------------------
// Tunables (mutable so tests can run accelerated terms)
// ---------------------------------------------------------------------------
export const EDUCATION_CONFIG = {
  /** length of a college term in days (16-week semester) */
  termDays: 112,
  coursesPerTerm: 4,
  creditsPerCourse: 3,
  /** exams are spread over the last N days of a term */
  examDaysBeforeEnd: 4,
  /** minutes an exam stays open after its scheduled time */
  examWindowMinutes: 240,
  homeworkMinutes: 45,
  studyMinutes: 90,
  k12Start: 8 * HOUR,
  k12End: 15 * HOUR,
  truancyThreshold: 5,
  scholarshipGpa: 3.5,
  studentLoanApr: 0.065,
  studentLoanTermMonths: 120,
  /** NPC kids attend/do homework automatically with this probability */
  npcAttendChance: 0.95,
  passingGrade: 60,
};

export const EDUCATION_LEVEL_ORDER: EducationLevel[] = ['none', 'elementary', 'middle', 'high_school', 'ged', 'some_college', 'associate', 'bachelor', 'master', 'professional', 'doctorate'];
const rank = (l: EducationLevel | string) => Math.max(0, EDUCATION_LEVEL_ORDER.indexOf(l as EducationLevel));

const K12_PROGRAM = 'K-12';
const STUDY_OBJECTS = new Set(['desk', 'dining_table', 'study_table', 'office_desk', 'classroom_desk', 'cafe_table', 'coffee_table']);
const STUDY_VENUES = new Set<Venue['archetype']>(['library', 'college', 'school', 'cafe', 'coworking']);

// class blocks for college: Mon/Wed/Fri 10–12, Tue/Thu 13–15
const COLLEGE_BLOCKS: { days: number[]; start: number; end: number }[] = [
  { days: [1, 3, 5], start: 10 * HOUR, end: 12 * HOUR },
  { days: [2, 4], start: 13 * HOUR, end: 15 * HOUR },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isYou(ctx: SystemContext, sim: Sim): boolean {
  return ctx.query.isControlled(sim.id);
}
function nm(ctx: SystemContext, sim: Sim): string {
  return isYou(ctx, sim) ? 'You' : sim.identity.firstName;
}
function vb(ctx: SystemContext, sim: Sim, you: string, they: string): string {
  return isYou(ctx, sim) ? you : they;
}
function flagNum(sim: Sim, key: string, def = 0): number {
  const v = sim.flags[key];
  return typeof v === 'number' ? v : def;
}
function letter(grade: number): string {
  return grade >= 90 ? 'A' : grade >= 80 ? 'B' : grade >= 70 ? 'C' : grade >= 60 ? 'D' : 'F';
}
function gradePoints(grade: number): number {
  return grade >= 90 ? 4 : grade >= 80 ? 3 : grade >= 70 ? 2 : grade >= 60 ? 1 : 0;
}
function isK12(sim: Sim): boolean {
  return sim.education.enrollment?.program === K12_PROGRAM && sim.education.enrollment.status === 'enrolled';
}
function isCollege(sim: Sim): boolean {
  const e = sim.education.enrollment;
  return !!e && e.program !== K12_PROGRAM && (e.status === 'enrolled' || e.status === 'probation');
}
function parentsOf(ctx: SystemContext, sim: Sim): Sim[] {
  const byFlag = Object.values(sim.relationships)
    .filter((r) => r.flags.includes('parent') || r.flags.includes('step_parent'))
    .map((r) => ctx.state.sims[r.simId])
    .filter((s): s is Sim => !!s && s.body.alive);
  if (byFlag.length) return byFlag;
  const hh = ctx.query.householdOf(sim.id);
  if (!hh) return [];
  return hh.simIds.map((id) => ctx.state.sims[id]).filter((s): s is Sim => !!s && s.id !== sim.id && s.body.alive && ctx.query.ageOf(s) >= 18);
}
function canStudyHere(ctx: SystemContext, sim: Sim): boolean {
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  if (!venue) return false;
  if (STUDY_VENUES.has(venue.archetype)) return true;
  return ctx.query.objectsAt(venue.id).some((o) => STUDY_OBJECTS.has(o.defId));
}
function setSchoolSchedule(sim: Sim, blocks: Sim['schedule']): void {
  sim.schedule = sim.schedule.filter((b) => b.kind !== 'school');
  sim.schedule.push(...blocks);
}
function householdIncome(ctx: SystemContext, sim: Sim): number {
  const hh = ctx.query.householdOf(sim.id);
  const members = hh ? hh.simIds.map((id) => ctx.state.sims[id]).filter((s): s is Sim => !!s) : [sim];
  let total = 0;
  for (const m of members) {
    const j = m.career.job;
    if (!j) continue;
    total += j.annualSalary ?? (j.hourlyRate ?? 0) * j.shifts.reduce((s, b) => s + (b.end - b.start) / HOUR, 0) * 52;
  }
  return total;
}

// ---------------------------------------------------------------------------
// K-12
// ---------------------------------------------------------------------------
type CourseSpec = { name: string; skillId?: string };
function k12Courses(grade: number): CourseSpec[] {
  if (grade <= 5) return [{ name: 'Reading & Writing', skillId: 'writing' }, { name: 'Math', skillId: 'logic' }, { name: 'Science', skillId: 'research' }, { name: 'Art', skillId: 'creativity' }, { name: 'PE', skillId: 'fitness' }, { name: 'Social Studies', skillId: 'research' }];
  if (grade <= 8) return [{ name: 'English', skillId: 'writing' }, { name: grade === 8 ? 'Pre-Algebra' : 'Math', skillId: 'logic' }, { name: 'Science', skillId: 'research' }, { name: 'History', skillId: 'research' }, { name: 'PE', skillId: 'fitness' }, { name: 'Music', skillId: 'music' }];
  const math = ['Algebra I', 'Geometry', 'Algebra II', 'Precalculus'][grade - 9] ?? 'Math';
  const sci = ['Biology', 'Chemistry', 'Physics', 'Environmental Science'][grade - 9] ?? 'Science';
  const hist = ['World Geography', 'World History', 'US History', 'Government & Economics'][grade - 9] ?? 'History';
  return [{ name: `English ${grade - 8}`, skillId: 'writing' }, { name: math, skillId: 'logic' }, { name: sci, skillId: 'research' }, { name: hist, skillId: 'research' }, { name: 'Spanish', skillId: 'spanish' }, { name: grade >= 11 ? 'Elective: Computer Science' : 'PE', skillId: grade >= 11 ? 'programming' : 'fitness' }];
}

function makeCourses(specs: CourseSpec[], prefix: string, rngSeed: SystemContext['rng'], baseGrade = 75): Course[] {
  return specs.map((c, i) => ({ id: `${prefix}_${i}_${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name: c.name, skillId: c.skillId, grade: baseGrade + Math.round(rngSeed.range(-8, 8)), homeworkDone: true }));
}

function enrollK12(ctx: SystemContext, sim: Sim): void {
  const age = ctx.query.ageOf(sim);
  const grade = clamp(sim.education.grade ?? age - 5, 0, 12);
  sim.education.grade = grade;
  const home = ctx.query.householdOf(sim.id)?.homeVenueId ?? sim.location.venueId;
  const school = ctx.query.nearestVenue(home, 'school');
  const now = ctx.state.time.minute;
  const yearsLeft = 12 - grade + 1;
  const enrollment: Enrollment = {
    institutionVenueId: school?.id,
    institutionName: school?.name ?? `${ctx.state.region.name} ISD (virtual)`,
    program: K12_PROGRAM,
    level: grade <= 5 ? 'elementary' : grade <= 8 ? 'middle' : 'high_school',
    startedAt: now,
    expectedGraduationAt: now + yearsLeft * 365 * DAY,
    creditsEarned: 0,
    creditsRequired: 0,
    gpa: 0,
    tuitionPerTerm: 0,
    courses: makeCourses(k12Courses(grade), `k12_g${grade}`, ctx.rng),
    attendanceRate: 1,
    status: 'enrolled',
  };
  sim.education.enrollment = enrollment;
  sim.flags.edu_absences = 0;
  setSchoolSchedule(sim, [{ day: 'weekday', start: EDUCATION_CONFIG.k12Start, end: EDUCATION_CONFIG.k12End, kind: 'school', venueId: school?.id, label: `School (grade ${grade || 'K'})` }]);
  if (school && !school.regularSimIds.includes(sim.id)) school.regularSimIds.push(sim.id);
  ctx.emit({ type: 'education:enrolled', simId: sim.id, program: K12_PROGRAM });
  ctx.log({ text: `${sim.identity.firstName} is enrolled in ${grade === 0 ? 'kindergarten' : `grade ${grade}`} at ${enrollment.institutionName}.`, kind: 'system', simId: sim.id, importance: 1 });
}

function ensureK12(ctx: SystemContext, sim: Sim): void {
  if (!sim.body.alive) return;
  const age = ctx.query.ageOf(sim);
  if (age < 5 || age > 17) return;
  if (rank(sim.education.highestLevel) >= rank('high_school')) return;
  const e = sim.education.enrollment;
  if (e && e.program === K12_PROGRAM && e.status === 'enrolled') return;
  if (e && e.program !== K12_PROGRAM && (e.status === 'enrolled' || e.status === 'probation')) return; // GED etc.
  enrollK12(ctx, sim);
}

function graduateHighSchool(ctx: SystemContext, sim: Sim): void {
  const e = sim.education.enrollment;
  if (!e) return;
  const avg = e.courses.length ? e.courses.reduce((s, c) => s + c.grade, 0) / e.courses.length : 75;
  const gpa = round2(gradePoints(avg) + (avg % 10) / 25);
  sim.education.degrees.push({ level: 'high_school', field: 'High School Diploma', institution: e.institutionName, earnedAt: ctx.state.time.minute, gpa: Math.min(4, gpa) });
  if (rank(sim.education.highestLevel) < rank('high_school')) sim.education.highestLevel = 'high_school';
  sim.education.enrollment = undefined;
  sim.education.grade = undefined;
  setSchoolSchedule(sim, []);
  ctx.emit({ type: 'education:graduated', simId: sim.id, level: 'high_school', field: 'High School Diploma' });
  ctx.log({ text: `${nm(ctx, sim)} ${vb(ctx, sim, 'graduate', 'graduates')} from ${e.institutionName}!`, kind: 'event', simId: sim.id, importance: 3 });
  ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'proud', label: 'Graduated!', intensity: 15, durationMinutes: DAY * 3 }] }, 'education:graduated');
  for (const p of parentsOf(ctx, sim)) ctx.applyEffects(p.id, { moodlets: [{ emotion: 'proud', label: `${sim.identity.firstName} graduated`, intensity: 10, durationMinutes: DAY * 3 }] }, 'education:graduated');
}

function advanceGrade(ctx: SystemContext, sim: Sim): void {
  const e = sim.education.enrollment;
  if (!e || e.program !== K12_PROGRAM) return;
  const avg = e.courses.length ? e.courses.reduce((s, c) => s + c.grade, 0) / e.courses.length : 75;
  const grade = sim.education.grade ?? 0;
  if (avg < 50) {
    ctx.log({ text: `${sim.identity.firstName} is held back to repeat grade ${grade}.`, kind: 'event', simId: sim.id, importance: 2 });
  } else if (grade >= 12) {
    graduateHighSchool(ctx, sim);
    return;
  } else {
    sim.education.grade = grade + 1;
    ctx.log({ text: `${sim.identity.firstName} moves up to grade ${grade + 1}.`, kind: 'event', simId: sim.id, importance: 2 });
  }
  const g = sim.education.grade ?? 0;
  e.level = g <= 5 ? 'elementary' : g <= 8 ? 'middle' : 'high_school';
  if (g >= 6 && rank(sim.education.highestLevel) < rank('elementary')) sim.education.highestLevel = 'elementary';
  if (g >= 9 && rank(sim.education.highestLevel) < rank('middle')) sim.education.highestLevel = 'middle';
  e.courses = makeCourses(k12Courses(g), `k12_g${g}`, ctx.rng);
  sim.flags.edu_absences = 0;
  const school = e.institutionVenueId;
  setSchoolSchedule(sim, [{ day: 'weekday', start: EDUCATION_CONFIG.k12Start, end: EDUCATION_CONFIG.k12End, kind: 'school', venueId: school, label: `School (grade ${g || 'K'})` }]);
}

function recordAttendance(ctx: SystemContext, sim: Sim, attended: boolean): void {
  const e = sim.education.enrollment;
  if (!e) return;
  const today = dayIndex(ctx.state.time.minute);
  if (flagNum(sim, 'edu_attendance_day', -1) === today) return;
  sim.flags.edu_attendance_day = today;
  if (attended) {
    e.attendanceRate = round2(clamp(e.attendanceRate * 0.95 + 0.05, 0, 1));
    return;
  }
  const excused = sim.body.illnesses.length > 0 || sim.body.health < 45 || sim.flags.edu_excused_day === today;
  e.attendanceRate = round2(clamp(e.attendanceRate * 0.95, 0, 1));
  if (excused) return;
  const absences = flagNum(sim, 'edu_absences') + 1;
  sim.flags.edu_absences = absences;
  for (const c of e.courses) c.grade = clamp100(c.grade - 1);
  if (isYou(ctx, sim) || parentsOf(ctx, sim).some((p) => isYou(ctx, p))) ctx.log({ text: `${sim.identity.firstName} skipped school today (unexcused absence ${absences}).`, kind: 'alert', simId: sim.id, importance: 1 });
  if (absences === EDUCATION_CONFIG.truancyThreshold) {
    const hh = ctx.query.householdOf(sim.id);
    if (hh) {
      const mailId = shortId(ctx.rng, 'mail');
      hh.mail.push({ id: mailId, at: ctx.state.time.minute, from: e.institutionName, subject: `Truancy notice — ${sim.identity.firstName} ${sim.identity.lastName}`, body: `${sim.identity.firstName} has ${absences} unexcused absences this year. Continued absences will be referred to the district truancy officer and Child Protective Services.`, kind: 'notice', read: false });
      ctx.emit({ type: 'amenity:mail', householdId: hh.id, mailId });
      ctx.emit({ type: 'custom', kind: 'amenity:mail', simId: sim.id, payload: { householdId: hh.id, mailId, subject: 'Truancy notice' } });
      for (const p of parentsOf(ctx, sim)) p.flags.cps_concern = true;
      sim.flags.cps_concern = true;
      ctx.log({ text: `A truancy notice from ${e.institutionName} arrives about ${sim.identity.firstName}.`, kind: 'alert', simId: sim.id, importance: 2 });
    }
  }
}

function attendClassOutcome(ctx: SystemContext, sim: Sim): void {
  const e = sim.education.enrollment;
  if (!e) return;
  const grade = sim.education.grade ?? 0;
  const xp: Record<string, number> = {};
  for (const c of e.courses) {
    c.grade = clamp100(c.grade + 0.6);
    if (c.skillId) xp[c.skillId] = (xp[c.skillId] ?? 0) + 6 + grade;
  }
  ctx.applyEffects(sim.id, { skills: xp }, 'education:class');
  // classmates: other school-age sims here
  const mates = e.institutionVenueId ? ctx.query.simsAt(e.institutionVenueId).filter((s) => s.id !== sim.id && ctx.query.ageOf(s) >= 5 && ctx.query.ageOf(s) <= 18).slice(0, 4) : [];
  for (const m of mates) ctx.applyEffects(sim.id, { relationships: [{ simId: m.id, friendship: 1.5, familiarity: 2, flags: [{ flag: 'classmate', op: 'add' }], mutual: true }] }, 'education:class');
  sim.flags.edu_attended = true;
  recordAttendance(ctx, sim, true);
}

function scheduleWeeklyHomework(ctx: SystemContext, sim: Sim): void {
  const e = sim.education.enrollment;
  if (!e || !e.courses.length) return;
  const now = ctx.state.time.minute;
  const due = dayIndex(now) * DAY + 4 * DAY + 20 * HOUR; // Friday 8pm when called Monday 00:00
  for (const c of e.courses) {
    c.homeworkDue = due;
    c.homeworkDone = false;
  }
  ctx.schedule({ atMinute: due, kind: 'homework_due', label: `Homework due — ${sim.identity.firstName}`, simId: sim.id, payload: { courseIds: e.courses.map((c) => c.id) } });
  ctx.emit({ type: 'education:homework_due', simId: sim.id, courseId: e.courses[0].id });
}

function homeworkDeadline(ctx: SystemContext, sim: Sim): void {
  const e = sim.education.enrollment;
  if (!e) return;
  const controlledHousehold = isYou(ctx, sim) || parentsOf(ctx, sim).some((p) => isYou(ctx, p));
  const missed: Course[] = [];
  for (const c of e.courses) {
    if (c.homeworkDue === undefined) continue;
    if (!c.homeworkDone && !controlledHousehold && ctx.rng.chance(clamp(sim.personality.conscientiousness + 0.2, 0.3, 0.97))) {
      c.homeworkDone = true;
      c.grade = clamp100(c.grade + 1.5);
    }
    if (!c.homeworkDone) {
      c.grade = clamp100(c.grade - 4);
      missed.push(c);
    }
    c.homeworkDue = undefined;
  }
  if (missed.length && controlledHousehold) {
    ctx.log({ text: `${nm(ctx, sim)} missed homework in ${missed.map((c) => c.name).join(', ')}.`, kind: 'alert', simId: sim.id, importance: 1 });
    for (const p of parentsOf(ctx, sim)) {
      ctx.emit({ type: 'phone:notification', simId: p.id, app: 'school', title: e.institutionName, body: `${sim.identity.firstName} did not turn in homework for ${missed.map((c) => c.name).join(', ')}.` });
      p.phone.notifications.push({ id: shortId(ctx.rng, 'ntf'), at: ctx.state.time.minute, app: 'school', title: e.institutionName, body: `${sim.identity.firstName} missed homework: ${missed.map((c) => c.name).join(', ')}.`, read: false });
    }
  }
}

function reportCard(ctx: SystemContext, sim: Sim): void {
  const e = sim.education.enrollment;
  if (!e || !e.courses.length) return;
  for (const c of e.courses) ctx.emit({ type: 'education:grade', simId: sim.id, courseId: c.id, grade: Math.round(c.grade) });
  const avg = e.courses.reduce((s, c) => s + c.grade, 0) / e.courses.length;
  const parents = parentsOf(ctx, sim);
  const watching = isYou(ctx, sim) || parents.some((p) => isYou(ctx, p));
  if (watching) ctx.log({ text: `Report card for ${sim.identity.firstName}: ${e.courses.map((c) => `${c.name} ${letter(c.grade)}`).join(', ')} (attendance ${Math.round(e.attendanceRate * 100)}%).`, kind: 'event', simId: sim.id, importance: 2 });
  for (const p of parents) {
    if (avg >= 85) ctx.applyEffects(p.id, { moodlets: [{ emotion: 'proud', label: `${sim.identity.firstName} made honor roll`, intensity: 6, durationMinutes: DAY * 2 }] }, 'education:report_card');
    else if (avg < 65) ctx.applyEffects(p.id, { moodlets: [{ emotion: 'sad', label: `${sim.identity.firstName}'s grades are slipping`, intensity: -6, durationMinutes: DAY * 2 }] }, 'education:report_card');
  }
  if (avg >= 85) ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'proud', label: 'Honor roll', intensity: 6, durationMinutes: DAY * 2 }] }, 'education:report_card');
}

// ---------------------------------------------------------------------------
// College / adult programs
// ---------------------------------------------------------------------------
export function tuitionFor(ctx: SystemContext, sim: Sim, program: ProgramDef): number {
  const aid = clamp(flagNum(sim, 'edu_aid_pct'), 0, 0.9);
  const scholarship = (sim.education.enrollment?.gpa ?? 0) >= EDUCATION_CONFIG.scholarshipGpa || sim.education.degrees.some((d) => d.gpa >= EDUCATION_CONFIG.scholarshipGpa && d.level !== 'high_school');
  return round2(program.tuitionPerTerm * (1 - aid) * (scholarship ? 0.5 : 1));
}

function eligibleFor(ctx: SystemContext, sim: Sim, program: ProgramDef): { ok: boolean; why?: string } {
  const age = ctx.query.ageOf(sim);
  if (age < 16) return { ok: false, why: 'Too young' };
  if (rank(sim.education.highestLevel) < rank(program.prerequisites)) return { ok: false, why: `Requires ${program.prerequisites.replace(/_/g, ' ')}` };
  const e = sim.education.enrollment;
  if (e && (e.status === 'enrolled' || e.status === 'probation')) return { ok: false, why: `Already enrolled in ${e.program === K12_PROGRAM ? 'school' : e.program}` };
  if (program.id.startsWith('cert_') ? sim.education.certifications.includes(program.id) : sim.education.degrees.some((d) => d.level === program.level && d.field === program.field)) return { ok: false, why: 'Already completed' };
  if (program.id === 'ged' && rank(sim.education.highestLevel) >= rank('high_school')) return { ok: false, why: 'You already have a diploma' };
  return { ok: true };
}

function termCourses(program: ProgramDef, termIndex: number, rng: SystemContext['rng']): Course[] {
  const n = EDUCATION_CONFIG.coursesPerTerm;
  const specs: CourseSpec[] = [];
  for (let i = 0; i < n; i++) specs.push(program.courses[(termIndex * n + i) % program.courses.length]);
  return makeCourses(specs, `${program.id}_t${termIndex}`, rng, 72);
}

function collegeBlocks(venueId: VenueId | undefined): Sim['schedule'] {
  const out: Sim['schedule'] = [];
  for (const b of COLLEGE_BLOCKS) for (const d of b.days) out.push({ day: d as 0 | 1 | 2 | 3 | 4 | 5 | 6, start: b.start, end: b.end, kind: 'school', venueId, label: 'Class' });
  return out;
}

function scheduleTerm(ctx: SystemContext, sim: Sim, e: Enrollment): void {
  const now = ctx.state.time.minute;
  const termEnd = now + EDUCATION_CONFIG.termDays * DAY;
  const examStart = termEnd - EDUCATION_CONFIG.examDaysBeforeEnd * DAY;
  const spacing = Math.max(3 * HOUR, Math.floor((EDUCATION_CONFIG.examDaysBeforeEnd * DAY - 6 * HOUR) / Math.max(1, e.courses.length)));
  e.courses.forEach((c, i) => {
    const at = examStart + i * spacing;
    c.examAt = at;
    ctx.schedule({ atMinute: at, kind: 'exam', label: `Exam — ${c.name}`, simId: sim.id, venueId: e.institutionVenueId, payload: { courseId: c.id } });
  });
  ctx.schedule({ atMinute: termEnd, kind: '_term_end', label: 'Term ends', simId: sim.id, payload: { program: e.program } });
  sim.flags.edu_term_end = termEnd;
  sim.flags.edu_prep = 0;
}

function studentLoanFor(ctx: SystemContext, sim: Sim, amount: number, graduationAt: number): LoanRef {
  let loan = sim.finance.loans.find((l) => l.kind === 'student' && !l.inDefault && l.deferred);
  const monthly = (bal: number) => {
    const r = EDUCATION_CONFIG.studentLoanApr / 12;
    const n = EDUCATION_CONFIG.studentLoanTermMonths;
    return round2((bal * r) / (1 - Math.pow(1 + r, -n)));
  };
  if (loan) {
    loan.principal = round2(loan.principal + amount);
    loan.balance = round2(loan.balance + amount);
    loan.monthlyPayment = monthly(loan.balance);
    loan.nextDueAt = Math.max(loan.nextDueAt, graduationAt + 180 * DAY);
    return loan;
  }
  loan = { id: shortId(ctx.rng, 'loan'), kind: 'student', lender: 'Federal Direct Loan', principal: amount, balance: amount, apr: EDUCATION_CONFIG.studentLoanApr, monthlyPayment: monthly(amount), nextDueAt: graduationAt + 180 * DAY, missedPayments: 0, termMonths: EDUCATION_CONFIG.studentLoanTermMonths, startedAt: ctx.state.time.minute, inDefault: false, deferred: true };
  sim.finance.loans.push(loan);
  return loan;
}

function enroll(ctx: SystemContext, sim: Sim, program: ProgramDef, payMode: 'pay' | 'loan'): ActionResult {
  const el = eligibleFor(ctx, sim, program);
  if (!el.ok) return { ok: false, text: el.why };
  const tuition = tuitionFor(ctx, sim, program);
  const now = ctx.state.time.minute;
  const here = ctx.query.venueMaybe(sim.location.venueId);
  const venue = here && program.venues.includes(here.archetype) ? here : program.venues.map((a) => ctx.query.nearestVenue(sim.location.venueId, a)).find((v): v is Venue => !!v);
  const graduationAt = now + program.termsTypical * EDUCATION_CONFIG.termDays * DAY;
  if (payMode === 'pay') {
    if (ctx.query.liquidCash(sim) < tuition) return { ok: false, text: `Tuition is ${formatMoney(tuition)} per term. You can't cover it — consider a student loan.` };
    ctx.applyEffects(sim.id, { money: { amount: -tuition, memo: `Tuition — ${program.name}`, category: 'tuition', counterparty: venue?.name ?? 'Online program' } }, 'education:tuition');
    sim.flags.edu_pay_mode = 'pay';
  } else {
    studentLoanFor(ctx, sim, tuition, graduationAt);
    sim.flags.edu_pay_mode = 'loan';
  }
  const e: Enrollment = {
    institutionVenueId: venue?.id,
    institutionName: venue?.name ?? `${program.name} (online)`,
    program: program.id,
    level: program.level,
    startedAt: now,
    expectedGraduationAt: graduationAt,
    creditsEarned: 0,
    creditsRequired: program.creditsRequired,
    gpa: 0,
    tuitionPerTerm: tuition,
    courses: termCourses(program, 0, ctx.rng),
    attendanceRate: 1,
    status: 'enrolled',
  };
  sim.education.enrollment = e;
  sim.flags.edu_term = 0;
  sim.flags.edu_gpa_courses = 0;
  sim.flags.edu_gpa_points = 0;
  setSchoolSchedule(sim, collegeBlocks(venue?.id));
  scheduleTerm(ctx, sim, e);
  if (rank(sim.education.highestLevel) < rank('some_college') && rank(program.level) >= rank('some_college') && sim.education.highestLevel !== 'ged') sim.education.highestLevel = rank(sim.education.highestLevel) >= rank('high_school') ? 'some_college' : sim.education.highestLevel;
  ctx.emit({ type: 'education:enrolled', simId: sim.id, program: program.id });
  ctx.log({ text: `${nm(ctx, sim)} ${vb(ctx, sim, 'enroll', 'enrolls')} in ${program.name} at ${e.institutionName}${payMode === 'loan' ? ` with a ${formatMoney(tuition)} student loan` : ` (${formatMoney(tuition)} tuition)`}.`, kind: 'event', simId: sim.id, importance: 3 });
  return { ok: true, text: `You're enrolled in ${program.name}. Classes Mon/Wed/Fri 10–12 and Tue/Thu 1–3 at ${e.institutionName}. Exams at the end of the term.`, effects: { moodlets: [{ emotion: 'hopeful', label: 'Back to school', intensity: 6, durationMinutes: DAY * 2 }] } };
}

function takeExam(ctx: SystemContext, sim: Sim, courseId: string): ActionResult {
  const e = sim.education.enrollment;
  const c = e?.courses.find((x) => x.id === courseId);
  if (!e || !c || c.examAt === undefined) return { ok: false, text: 'No exam open.' };
  const now = ctx.state.time.minute;
  if (now < c.examAt - 20) return { ok: false, text: 'The exam has not started yet.' };
  if (now > c.examAt + EDUCATION_CONFIG.examWindowMinutes) {
    c.examAt = undefined;
    return { ok: false, text: 'You missed the exam window.' };
  }
  const prep = Math.min(6, flagNum(sim, 'edu_prep'));
  const skillBonus = c.skillId ? (sim.skills[c.skillId]?.level ?? 0) * 1.2 : 0;
  const score = clamp100(0.6 * c.grade + 22 * e.attendanceRate + 2.5 * prep + skillBonus + ctx.rng.normal(0, 5) + (sim.needs.energy < 30 ? -8 : 0) + (sim.mind.stress > 75 ? -5 : 0));
  c.grade = Math.round(score);
  c.examAt = undefined;
  ctx.emit({ type: 'education:exam', simId: sim.id, courseId: c.id });
  ctx.emit({ type: 'education:grade', simId: sim.id, courseId: c.id, grade: c.grade });
  ctx.log({ text: `${nm(ctx, sim)} ${vb(ctx, sim, 'take', 'takes')} the ${c.name} exam: ${letter(c.grade)} (${c.grade}).`, kind: 'event', simId: sim.id, importance: 2 });
  return { ok: true, text: `${c.name} exam: ${letter(c.grade)} (${c.grade}/100).`, outcomeLabel: letter(c.grade), effects: { needs: { energy: -12, fun: -6 }, stress: c.grade >= 70 ? -4 : 6, skills: c.skillId ? { [c.skillId]: 20 } : undefined, moodlets: [c.grade >= 90 ? { emotion: 'proud', label: 'Aced the exam', intensity: 8, durationMinutes: DAY } : c.grade < 60 ? { emotion: 'sad', label: 'Failed an exam', intensity: -8, durationMinutes: DAY } : { emotion: 'relaxed', label: 'Exam done', intensity: 4, durationMinutes: 6 * HOUR }] } };
}

function graduateProgram(ctx: SystemContext, sim: Sim, e: Enrollment, program: ProgramDef): void {
  const now = ctx.state.time.minute;
  const gpa = round2(e.gpa);
  if (program.id.startsWith('cert_')) {
    if (!sim.education.certifications.includes(program.id)) sim.education.certifications.push(program.id);
  } else {
    const degree: Degree = { level: program.level, field: program.field, institution: e.institutionName, earnedAt: now, gpa };
    sim.education.degrees.push(degree);
  }
  if (rank(program.level) > rank(sim.education.highestLevel)) sim.education.highestLevel = program.level;
  e.status = 'graduated';
  sim.education.enrollment = undefined;
  setSchoolSchedule(sim, []);
  for (const l of sim.finance.loans) if (l.kind === 'student' && l.deferred) {
    l.deferred = false;
    l.nextDueAt = Math.max(l.nextDueAt, now + 180 * DAY);
  }
  ctx.emit({ type: 'education:graduated', simId: sim.id, level: program.level, field: program.field });
  ctx.log({ text: `${nm(ctx, sim)} ${vb(ctx, sim, 'complete', 'completes')} ${program.name} at ${e.institutionName} with a ${gpa.toFixed(2)} GPA!`, kind: 'event', simId: sim.id, importance: 3 });
  ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'proud', label: 'Graduated!', intensity: 18, durationMinutes: DAY * 4 }], stress: -10 }, 'education:graduated');
}

function endTerm(ctx: SystemContext, sim: Sim): void {
  const e = sim.education.enrollment;
  if (!e || e.program === K12_PROGRAM) return;
  const program = ctx.content.programs[e.program];
  if (!program) return;
  const now = ctx.state.time.minute;
  let passed = 0;
  let points = flagNum(sim, 'edu_gpa_points');
  let count = flagNum(sim, 'edu_gpa_courses');
  const summary: string[] = [];
  for (const c of e.courses) {
    if (c.examAt !== undefined) {
      // missed the exam
      c.grade = Math.round(c.grade * 0.5);
      c.examAt = undefined;
    }
    if (c.grade >= EDUCATION_CONFIG.passingGrade) {
      passed += 1;
      e.creditsEarned += EDUCATION_CONFIG.creditsPerCourse;
    }
    points += gradePoints(c.grade);
    count += 1;
    summary.push(`${c.name} ${letter(c.grade)}`);
    ctx.emit({ type: 'education:grade', simId: sim.id, courseId: c.id, grade: Math.round(c.grade) });
  }
  sim.flags.edu_gpa_points = points;
  sim.flags.edu_gpa_courses = count;
  e.gpa = count ? round2(points / count) : 0;
  ctx.log({ text: `Term grades: ${summary.join(', ')}. GPA ${e.gpa.toFixed(2)}, ${e.creditsEarned}/${e.creditsRequired} credits.`, kind: 'event', simId: sim.id, importance: 2 });
  if (e.creditsEarned >= e.creditsRequired) {
    graduateProgram(ctx, sim, e, program);
    return;
  }
  // academic standing
  if (e.gpa < 2 && count >= EDUCATION_CONFIG.coursesPerTerm) {
    if (e.status === 'probation') {
      e.status = 'suspended';
      ctx.emit({ type: 'education:dropped', simId: sim.id });
      ctx.log({ text: `${nm(ctx, sim)} ${vb(ctx, sim, 'are', 'is')} academically suspended from ${e.institutionName}.`, kind: 'event', simId: sim.id, importance: 3 });
      sim.education.enrollment = undefined;
      setSchoolSchedule(sim, []);
      for (const l of sim.finance.loans) if (l.kind === 'student' && l.deferred) {
        l.deferred = false;
        l.nextDueAt = now + 180 * DAY;
      }
      return;
    }
    e.status = 'probation';
    ctx.log({ text: `${nm(ctx, sim)} ${vb(ctx, sim, 'are', 'is')} placed on academic probation.`, kind: 'alert', simId: sim.id, importance: 2 });
  } else if (e.status === 'probation') e.status = 'enrolled';
  // next term
  const term = flagNum(sim, 'edu_term') + 1;
  sim.flags.edu_term = term;
  const tuition = tuitionFor(ctx, sim, program);
  e.tuitionPerTerm = tuition;
  if (sim.flags.edu_pay_mode === 'loan') {
    studentLoanFor(ctx, sim, tuition, e.expectedGraduationAt);
    ctx.log({ text: `${formatMoney(tuition)} in tuition added to ${vb(ctx, sim, 'your', 'their')} student loan.`, kind: 'money', simId: sim.id, importance: 1 });
  } else if (ctx.query.liquidCash(sim) >= tuition) {
    ctx.applyEffects(sim.id, { money: { amount: -tuition, memo: `Tuition — ${program.name}`, category: 'tuition', counterparty: e.institutionName } }, 'education:tuition');
  } else {
    studentLoanFor(ctx, sim, tuition, e.expectedGraduationAt);
    sim.flags.edu_pay_mode = 'loan';
    ctx.log({ text: `${nm(ctx, sim)} couldn't cover ${formatMoney(tuition)} tuition and ${vb(ctx, sim, 'take', 'takes')} a student loan for it.`, kind: 'money', simId: sim.id, importance: 2 });
  }
  e.courses = termCourses(program, term, ctx.rng);
  scheduleTerm(ctx, sim, e);
  if (passed < e.courses.length) passed = 0;
}

function dropOut(ctx: SystemContext, sim: Sim): ActionResult {
  const e = sim.education.enrollment;
  if (!e || e.program === K12_PROGRAM) return { ok: false, text: 'Not enrolled.' };
  e.status = 'dropped';
  sim.education.enrollment = undefined;
  setSchoolSchedule(sim, []);
  ctx.state.scheduled = ctx.state.scheduled.filter((s) => !(s.simId === sim.id && (s.kind === 'exam' || s.kind === '_term_end')));
  for (const l of sim.finance.loans) if (l.kind === 'student' && l.deferred) {
    l.deferred = false;
    l.nextDueAt = ctx.state.time.minute + 180 * DAY;
  }
  ctx.emit({ type: 'education:dropped', simId: sim.id });
  ctx.log({ text: `${nm(ctx, sim)} ${vb(ctx, sim, 'drop', 'drops')} out of ${e.institutionName}.`, kind: 'event', simId: sim.id, importance: 3 });
  return { ok: true, text: 'You withdraw. Any student loans start coming due in six months.', effects: { moodlets: [{ emotion: 'relaxed', label: 'Done with school', intensity: 4, durationMinutes: DAY }] } };
}

function applyAid(ctx: SystemContext, sim: Sim): ActionResult {
  if (sim.flags.edu_aid_year === ctx.clock.day.year) return { ok: false, text: 'You already applied for aid this year.' };
  const income = householdIncome(ctx, sim);
  const pct = income < 30000 ? 0.8 : income < 60000 ? 0.5 : income < 90000 ? 0.25 : 0;
  sim.flags.edu_aid_pct = pct;
  sim.flags.edu_aid_year = ctx.clock.day.year;
  const text = pct > 0 ? `Your aid package covers ${Math.round(pct * 100)}% of tuition (household income ${formatMoney(income, { cents: false })}).` : `With a household income of ${formatMoney(income, { cents: false })} you don't qualify for need-based aid.`;
  ctx.log({ text: `${nm(ctx, sim)} ${vb(ctx, sim, 'file', 'files')} the FAFSA. ${text}`, kind: 'money', simId: sim.id, importance: 2 });
  return { ok: true, text };
}

function inLectureWindow(ctx: SystemContext): { start: number; end: number } | undefined {
  const wd = ctx.clock.weekday;
  const mod = ctx.clock.minuteOfDay;
  for (const b of COLLEGE_BLOCKS) if (b.days.includes(wd) && mod >= b.start - 15 && mod < b.end - 15) return b;
  return undefined;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const notJailed: Requirement = { kind: 'not_incarcerated', reason: 'You are in custody' };

function studyActions(ctx: SystemContext, sim: Sim): ActionDef[] {
  const out: ActionDef[] = [];
  const e = sim.education.enrollment;
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  if (!venue) return out;
  const studyOk = canStudyHere(ctx, sim);
  if (e && (isK12(sim) || isCollege(sim)) && studyOk) {
    const pending = e.courses.find((c) => c.homeworkDue !== undefined && !c.homeworkDone);
    if (pending) out.push({ id: `education:homework:${pending.id}`, label: `Do homework (${pending.name})`, category: 'school', icon: 'pencil', durationMinutes: EDUCATION_CONFIG.homeworkMinutes, effects: { needs: { fun: -6, energy: -4 }, skills: pending.skillId ? { [pending.skillId]: 12 } : undefined }, group: 'School', requirements: [notJailed] });
    out.push({ id: 'education:study', label: 'Study', description: isK12(sim) ? 'Hit the books for your classes.' : `Study for ${e.courses.slice().sort((a, b) => a.grade - b.grade)[0]?.name ?? 'class'}.`, category: 'school', icon: 'book', durationMinutes: EDUCATION_CONFIG.studyMinutes, effects: { needs: { fun: -6, energy: -10, social: -2 }, stress: 2, skills: { logic: 15 } }, group: 'School', requirements: [notJailed, { kind: 'energy', reason: 'Too tired to focus', params: { min: 15 } }] });
  }
  return out;
}

function k12Actions(ctx: SystemContext, sim: Sim): ActionDef[] {
  const out: ActionDef[] = [];
  const e = sim.education.enrollment;
  if (!e || !isK12(sim) || !e.institutionVenueId) return out;
  const mod = ctx.clock.minuteOfDay;
  if (sim.location.venueId === e.institutionVenueId && ctx.clock.day.isSchoolDay && mod >= EDUCATION_CONFIG.k12Start - 30 && mod < EDUCATION_CONFIG.k12End - 30 && flagNum(sim, 'edu_class_day', -1) !== dayIndex(ctx.state.time.minute)) {
    const grade = sim.education.grade ?? 0;
    out.push({ id: 'education:attend_class', label: 'Attend class', description: `${grade === 0 ? 'Kindergarten' : `Grade ${grade}`}: ${e.courses.map((c) => c.name).slice(0, 3).join(', ')}…`, category: 'school', icon: 'school', durationMinutes: Math.max(30, EDUCATION_CONFIG.k12End - Math.max(mod, EDUCATION_CONFIG.k12Start)), effects: { perMinute: { fun: -0.03, social: 0.04, energy: -0.04, hunger: -0.05 } }, group: 'School', requirements: [notJailed] });
  }
  return out;
}

function collegeActions(ctx: SystemContext, sim: Sim): ActionDef[] {
  const out: ActionDef[] = [];
  const e = sim.education.enrollment;
  const now = ctx.state.time.minute;
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  const age = ctx.query.ageOf(sim);
  // browsing / enrollment
  if (age >= 16 && !isCollege(sim) && !isK12(sim)) {
    out.push({ id: 'phone:school:browse', label: 'Browse programs & courses', category: 'phone', icon: 'graduation-cap', durationMinutes: 10, effects: {}, group: 'School' });
    const atCollege = venue && venue.archetype !== 'home' && Object.values(ctx.content.programs).some((p) => p.venues.includes(venue.archetype));
    if (sim.flags.edu_browsed || atCollege) {
      for (const p of Object.values(ctx.content.programs)) {
        if (atCollege && venue && !p.venues.includes(venue.archetype) && !sim.flags.edu_browsed) continue;
        const el = eligibleFor(ctx, sim, p);
        if (!el.ok && el.why === 'Already completed') continue;
        const tuition = tuitionFor(ctx, sim, p);
        const reqs: Requirement[] = [notJailed];
        if (!el.ok) reqs.push({ kind: 'custom', reason: el.why ?? 'Not eligible', params: { fn: () => false } });
        out.push({ id: `education:enroll:${p.id}`, label: `Enroll: ${p.name} (${formatMoney(tuition, { cents: false })}/term)`, description: `${p.field} · ${p.termsTypical} term${p.termsTypical > 1 ? 's' : ''} · ${p.creditsRequired} credits`, category: 'school', icon: 'university', durationMinutes: 30, effects: {}, group: 'School', requirements: [...reqs, { kind: 'money', reason: `Tuition ${formatMoney(tuition)}`, params: { amount: tuition, noCredit: true } }] });
        if (age >= 17) out.push({ id: `education:enroll_loan:${p.id}`, label: `Enroll with student loan: ${p.name}`, description: `Borrow ${formatMoney(tuition, { cents: false })}/term at ${Math.round(EDUCATION_CONFIG.studentLoanApr * 1000) / 10}% APR, deferred while enrolled.`, category: 'school', icon: 'file-invoice-dollar', durationMinutes: 30, effects: {}, group: 'School', requirements: reqs });
      }
    }
    if (sim.flags.edu_aid_year !== ctx.clock.day.year) out.push({ id: 'education:apply_aid', label: 'Apply for financial aid (FAFSA)', category: 'phone', icon: 'hand-holding-usd', durationMinutes: 40, effects: { needs: { fun: -4 } }, group: 'School' });
  }
  if (!e || !isCollege(sim)) return out;
  const virtual = !e.institutionVenueId;
  const here = virtual ? sim.location.venueId === (ctx.query.householdOf(sim.id)?.homeVenueId ?? '') : sim.location.venueId === e.institutionVenueId;
  const win = inLectureWindow(ctx);
  if (here && win && flagNum(sim, 'edu_lecture_day', -1) !== dayIndex(now)) {
    out.push({ id: 'education:attend_lecture', label: 'Attend lecture', description: e.courses.map((c) => c.name).join(', '), category: 'school', icon: 'chalkboard', durationMinutes: Math.max(30, win.end - ctx.clock.minuteOfDay), effects: { perMinute: { fun: -0.02, energy: -0.05, social: 0.02 } }, group: 'School', requirements: [notJailed] });
  }
  for (const c of e.courses) {
    if (c.examAt === undefined) continue;
    if (now < c.examAt - 60 || now > c.examAt + EDUCATION_CONFIG.examWindowMinutes) continue;
    if (!here) continue;
    out.push({ id: `education:exam:${c.id}`, label: `Take exam: ${c.name}`, category: 'school', icon: 'file-alt', durationMinutes: 120, effects: {}, group: 'School', requirements: [notJailed, { kind: 'energy', reason: 'Too exhausted to sit an exam', params: { min: 10 } }] });
  }
  if (sim.flags.edu_aid_year !== ctx.clock.day.year) out.push({ id: 'education:apply_aid', label: 'Apply for financial aid (FAFSA)', category: 'phone', icon: 'hand-holding-usd', durationMinutes: 40, effects: { needs: { fun: -4 } }, group: 'School' });
  out.push({ id: 'education:drop_out', label: 'Drop out', category: 'school', icon: 'sign-out', durationMinutes: 15, effects: {}, group: 'School' });
  return out;
}

function libraryActions(ctx: SystemContext, sim: Sim): ActionDef[] {
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  if (!venue || venue.archetype !== 'library') return [];
  const out: ActionDef[] = [];
  const open: Requirement = { kind: 'venue_open', reason: `${venue.name} is closed`, params: { venueId: venue.id } };
  if (!sim.flags.library_card) out.push({ id: 'education:library_card', label: 'Get a library card', category: 'civic', icon: 'id-card', durationMinutes: 10, effects: { flags: { library_card: true } }, group: 'Library', requirements: [open] });
  out.push({ id: 'education:borrow_book', label: 'Borrow a book', category: 'hobby', icon: 'book', durationMinutes: 15, effects: { items: [{ op: 'gain', itemId: 'book_novel', qty: 1 }], needs: { fun: 3 } }, group: 'Library', requirements: [open, { kind: 'flag', reason: 'You need a library card', params: { flag: 'library_card' } }] });
  out.push({ id: 'education:public_computer', label: 'Use a public computer', category: 'hobby', icon: 'desktop', durationMinutes: 30, effects: { needs: { fun: 6 }, flags: { used_public_computer: true } }, group: 'Library', requirements: [open] });
  if (!sim.education.enrollment) out.push({ id: 'education:study', label: 'Read and study', category: 'hobby', icon: 'book-open', durationMinutes: 60, effects: { needs: { fun: 2, energy: -4 }, skills: { logic: 10, research: 12 } }, group: 'Library', requirements: [open] });
  return out;
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export const educationSystem: System = {
  id: 'education',
  intervalMinutes: 60,

  onInit(ctx) {
    for (const sim of ctx.query.aliveSims()) ensureK12(ctx, sim);
  },

  onTick(ctx) {
    const mod = ctx.clock.minuteOfDay;
    const today = dayIndex(ctx.state.time.minute);
    if (!ctx.clock.day.isSchoolDay) return;
    for (const sim of ctx.query.aliveSims()) {
      if (!isK12(sim)) continue;
      const e = sim.education.enrollment!;
      if (flagNum(sim, 'edu_day', -1) !== today) {
        sim.flags.edu_day = today;
        sim.flags.edu_attended = false;
      }
      // presence during the school block counts as attendance
      if (mod >= EDUCATION_CONFIG.k12Start && mod < EDUCATION_CONFIG.k12End) {
        if (e.institutionVenueId && sim.location.venueId === e.institutionVenueId && !sim.travel) sim.flags.edu_attended = true;
        else if (!isYou(ctx, sim) && !sim.flags.edu_attended && sim.lod !== 'full' && mod < EDUCATION_CONFIG.k12Start + 60 && ctx.rng.chance(EDUCATION_CONFIG.npcAttendChance)) sim.flags.edu_attended = true;
        else if (!e.institutionVenueId && mod < EDUCATION_CONFIG.k12Start + 60) sim.flags.edu_attended = true; // virtual school
      }
      if (mod >= EDUCATION_CONFIG.k12End && mod < EDUCATION_CONFIG.k12End + 60) {
        const attended = !!sim.flags.edu_attended;
        if (attended && !isYou(ctx, sim)) {
          const xp: Record<string, number> = {};
          for (const c of e.courses) if (c.skillId) xp[c.skillId] = 4;
          ctx.applyEffects(sim.id, { skills: xp }, 'education:class');
        }
        recordAttendance(ctx, sim, attended);
      }
    }
  },

  onEvent(ctx, event: GameEvent) {
    switch (event.type) {
      case 'world:new_game':
      case 'time:day': {
        const d = ctx.clock.day;
        for (const sim of ctx.query.aliveSims()) {
          ensureK12(ctx, sim);
          if (!isK12(sim)) continue;
          if (event.type === 'time:day' && d.month === 8 && d.day === 15) advanceGrade(ctx, sim);
          if (event.type === 'time:day' && ((d.month === 10 && d.day === 15) || (d.month === 1 && d.day === 15) || (d.month === 3 && d.day === 25) || (d.month === 6 && d.day === 1))) reportCard(ctx, sim);
        }
        break;
      }
      case 'time:week': {
        for (const sim of ctx.query.aliveSims()) {
          if (!isK12(sim) && !isCollege(sim)) continue;
          if (isK12(sim) && !ctx.clock.day.isSchoolDay && ctx.clock.day.month >= 6 && ctx.clock.day.month <= 8) continue; // summer break
          if (isYou(ctx, sim) || parentsOf(ctx, sim).some((p) => isYou(ctx, p)) || sim.lod !== 'far') scheduleWeeklyHomework(ctx, sim);
        }
        break;
      }
      case 'sim:aged_up':
      case 'family:adoption':
      case 'family:custody': {
        const id = event.type === 'sim:aged_up' ? event.simId : event.childId;
        const sim = ctx.state.sims[id];
        if (sim) ensureK12(ctx, sim);
        break;
      }
      case 'scheduled:fired': {
        const ev = event.event;
        const sim = ev.simId ? ctx.state.sims[ev.simId] : undefined;
        if (!sim) break;
        if (ev.kind === 'homework_due') homeworkDeadline(ctx, sim);
        else if (ev.kind === '_term_end') endTerm(ctx, sim);
        else if (ev.kind === 'exam') {
          const c = sim.education.enrollment?.courses.find((x) => x.id === ev.payload?.courseId);
          if (c && isCollege(sim)) {
            c.examAt = ev.atMinute;
            if (isYou(ctx, sim)) {
              ctx.log({ text: `Your ${c.name} exam is open for the next ${EDUCATION_CONFIG.examWindowMinutes / 60} hours at ${sim.education.enrollment!.institutionName}.`, kind: 'alert', simId: sim.id, importance: 2 });
              ctx.emit({ type: 'phone:notification', simId: sim.id, app: 'calendar', title: 'Exam today', body: `${c.name} — ${sim.education.enrollment!.institutionName}` });
            } else {
              // NPC students sit the exam automatically
              takeExam(ctx, sim, c.id);
            }
          }
        }
        break;
      }
      case 'action:completed': {
        const sim = ctx.state.sims[event.simId];
        if (!sim) break;
        const id = event.actionId;
        const e = sim.education.enrollment;
        if (id === 'education:attend_class') {
          sim.flags.edu_class_day = dayIndex(ctx.state.time.minute);
          attendClassOutcome(ctx, sim);
        } else if (id === 'education:attend_lecture' && e) {
          sim.flags.edu_lecture_day = dayIndex(ctx.state.time.minute);
          e.attendanceRate = round2(clamp(e.attendanceRate * 0.9 + 0.1, 0, 1));
          const xp: Record<string, number> = { logic: 12 };
          for (const c of e.courses) {
            c.grade = clamp100(c.grade + 1.5);
            if (c.skillId) xp[c.skillId] = (xp[c.skillId] ?? 0) + 8;
          }
          ctx.applyEffects(sim.id, { skills: xp, needs: { energy: -6 } }, 'education:lecture');
        } else if (id === 'education:study' && e) {
          sim.flags.edu_prep = flagNum(sim, 'edu_prep') + 1;
          if (isK12(sim)) for (const c of e.courses) c.grade = clamp100(c.grade + 1);
          else {
            const lowest = e.courses.slice().sort((a, b) => a.grade - b.grade)[0];
            if (lowest) {
              lowest.grade = clamp100(lowest.grade + 2.5);
              if (lowest.skillId) ctx.applyEffects(sim.id, { skills: { [lowest.skillId]: 10 } }, 'education:study');
            }
          }
        } else if (id.startsWith('education:homework:') && e) {
          const c = e.courses.find((x) => x.id === id.slice('education:homework:'.length));
          if (c) {
            c.homeworkDone = true;
            c.grade = clamp100(c.grade + 3);
          }
        }
        break;
      }
      default:
        break;
    }
  },

  actions(ctx, simId) {
    const sim = ctx.query.sim(simId);
    if (!sim.body.alive) return [];
    return [...k12Actions(ctx, sim), ...collegeActions(ctx, sim), ...studyActions(ctx, sim), ...libraryActions(ctx, sim)];
  },

  handles(actionId) {
    return actionId.startsWith('education:') || actionId.startsWith('phone:school:');
  },

  execute(ctx, simId, action): ActionResult {
    const sim = ctx.query.sim(simId);
    const id = action.id;
    if (id === 'phone:school:browse') {
      sim.flags.edu_browsed = true;
      const list = Object.values(ctx.content.programs).filter((p) => eligibleFor(ctx, sim, p).ok);
      return { ok: true, text: list.length ? `Programs you can enroll in:\n${list.map((p) => `• ${p.name} — ${formatMoney(tuitionFor(ctx, sim, p), { cents: false })}/term, ${p.termsTypical} term(s)`).join('\n')}` : 'Nothing you qualify for right now.', data: { programs: list.map((p) => p.id) } };
    }
    if (id.startsWith('education:enroll_loan:')) {
      const p = ctx.content.programs[id.slice('education:enroll_loan:'.length)];
      return p ? enroll(ctx, sim, p, 'loan') : { ok: false, text: 'Unknown program.' };
    }
    if (id.startsWith('education:enroll:')) {
      const p = ctx.content.programs[id.slice('education:enroll:'.length)];
      return p ? enroll(ctx, sim, p, 'pay') : { ok: false, text: 'Unknown program.' };
    }
    if (id.startsWith('education:exam:')) return takeExam(ctx, sim, id.slice('education:exam:'.length));
    if (id === 'education:drop_out') return dropOut(ctx, sim);
    if (id === 'education:apply_aid') return applyAid(ctx, sim);
    if (id === 'education:attend_class') return { ok: true, text: 'You settle into class.' };
    if (id === 'education:attend_lecture') return { ok: true, text: 'You find a seat near the back and open your laptop.' };
    if (id === 'education:study') return { ok: true, text: 'You spread out your notes and get to work.' };
    if (id.startsWith('education:homework:')) return { ok: true, text: 'You knock out the assignment.' };
    if (id === 'education:library_card') return { ok: true, text: 'The librarian hands you a fresh library card.' };
    if (id === 'education:borrow_book') return { ok: true, text: 'You check out a novel.' };
    if (id === 'education:public_computer') return { ok: true, text: 'You log onto a public terminal.' };
    return { ok: false, text: 'Unknown school action.' };
  },
};

export type { SimId };
