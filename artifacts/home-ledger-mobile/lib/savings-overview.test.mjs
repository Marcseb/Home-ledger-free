import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSavingsOverview, accountMoneySegments, buildGoalContributorProgress } from './savings-overview.ts';
import { calculateGoalMetrics } from './goal-calculations.ts';

const contribution = (overrides = {}) => ({
  id: 'c1', goalId: 'personal-goal', contributedByUserId: 'me', amountMinor: 35000,
  occurredAt: '2026-10-05', transactionId: 'transfer1', reversedAt: null,
  returnTransactionId: null, ...overrides,
});
const goal = (overrides = {}) => ({
  id: 'personal-goal', name: 'Trip', currentMinor: 35000, targetMinor: 350000,
  accountId: 'main', linkedAccountId: 'savings', isShared: false, ownerUserId: 'me',
  status: 'active', createdAt: '2026-10-01', dueDate: '2027-04-01',
  contributions: [contribution()], ...overrides,
});
const sharedGoal = (overrides = {}) => goal({
  id: 'shared-goal', accountId: 'shared', linkedAccountId: null, isShared: true,
  ownerUserId: null, ...overrides,
});
const build = (overrides = {}) => buildSavingsOverview({
  goals: [sharedGoal(), goal()],
  transactions: [{ id: 'transfer1', destinationAccountId: 'savings' }],
  accountIds: new Set(['shared']), shared: true, ownerUserId: 'me', month: '2026-10',
  ...overrides,
});

test('mirrored private savings show Shared goal progress without inventing Shared reserves', () => {
  const result = build({ goals: [sharedGoal()], transactions: [] });
  assert.deepEqual(result.goals.map((g) => g.id), ['shared-goal']);
  assert.equal(result.goals[0].currentMinor, 35000);
  assert.equal(result.reservedMinor, 0);
  assert.equal(result.savedThisMonthMinor, 0);
  const metrics = calculateGoalMetrics(result.goals[0], new Date('2026-10-05T12:00:00'));
  assert.equal(metrics.progress, 10);
  assert.equal(metrics.remainingMinor, 315000);
  assert.equal(metrics.requiredMonthlyMinor, 52500);
});

test('personal scope counts a mirrored record once and shows only the owner’s personal goal', () => {
  const result = build({ shared: false, accountIds: new Set(['main', 'savings']) });
  assert.equal(result.reservedMinor, 35000);
  assert.equal(result.savedThisMonthMinor, 35000);
  assert.deepEqual(result.goals.map((g) => g.id), ['personal-goal']);
});

test('progress-only mirrored contributions never reserve money in the Shared account', () => {
  const c = contribution({ transactionId: null });
  for (const goals of [[sharedGoal({ contributions: [c] })], [sharedGoal({ contributions: [c] }), goal({ contributions: [c] })]]) {
    assert.equal(build({ goals, transactions: [] }).reservedMinor, 0);
  }
  const result = build({
    goals: [sharedGoal({ contributions: [c] }), goal({ contributions: [c] })],
    transactions: [], accountIds: new Set(['main']), shared: false,
  });
  assert.equal(result.reservedMinor, 35000);
});

test('direct Shared reservations and mirrored goal progress remain separate', () => {
  const direct = contribution({ id: 'direct', goalId: 'shared-goal', amountMinor: 10000, transactionId: null });
  const result = build({ goals: [sharedGoal({ currentMinor: 45000, contributions: [contribution(), direct] })], transactions: [] });
  assert.equal(result.reservedMinor, 10000);
  assert.equal(result.savedThisMonthMinor, 10000);
  assert.equal(result.goals[0].currentMinor, 45000);
});

test('reversed and settled contributions do not count; monthly savings excludes past months', () => {
  const cs = [
    contribution({ id: 'reversed', reversedAt: '2026-10-05' }),
    contribution({ id: 'returned', returnTransactionId: 'return1' }),
    contribution({ id: 'old', occurredAt: '2026-09-01', amountMinor: 12000 }),
    contribution({ id: 'new', amountMinor: 8000 }),
  ];
  const result = build({ goals: [goal({ contributions: cs })], shared: false, accountIds: new Set(['savings']) });
  assert.equal(result.reservedMinor, 20000);
  assert.equal(result.savedThisMonthMinor, 8000);
});

test('cancelled goals preserve unsettled reservations but are absent from goal progress', () => {
  const result = build({ goals: [goal({ status: 'cancelled' })], shared: false, accountIds: new Set(['savings']) });
  assert.equal(result.reservedMinor, 35000);
  assert.deepEqual(result.goals, []);
});

test('a selected Personal account includes current links and historical allocations, not other owners', () => {
  const result = build({
    goals: [
      goal({ linkedAccountId: 'other-savings' }),
      goal({ id: 'empty', linkedAccountId: 'savings', currentMinor: 0, contributions: [] }),
      goal({ id: 'other', ownerUserId: 'someone-else', contributions: [] }),
      goal({ id: 'unrelated', linkedAccountId: 'different', contributions: [] }),
    ],
    shared: false, accountIds: new Set(['savings']), selectedAccountId: 'savings',
  });
  assert.deepEqual(new Set(result.goals.map((g) => g.id)), new Set(['personal-goal', 'empty']));
});

test('completed goals follow unfinished goals; cancelled goals never appear', () => {
  const result = build({ goals: [
    sharedGoal({ id: 'complete', currentMinor: 350000, dueDate: '2026-01-01' }),
    sharedGoal({ id: 'later', dueDate: '2027-05-01' }),
    sharedGoal({ id: 'first', dueDate: '2027-04-01' }),
    sharedGoal({ id: 'cancelled', status: 'cancelled' }),
  ] });
  assert.deepEqual(result.goals.map((g) => g.id), ['first', 'later', 'complete']);
});

test('cash bars handle zero, fully reserved, over-reserved, and negative balances honestly', () => {
  assert.deepEqual(accountMoneySegments(100000, 35000), {
    availableMinor: 65000, availablePercent: 65, reservedPercent: 35, shortfallMinor: 0,
  });
  assert.equal(accountMoneySegments(0, 0).reservedPercent, 0);
  assert.equal(accountMoneySegments(100, 100).reservedPercent, 100);
  assert.equal(accountMoneySegments(100, 200).reservedPercent, 100);
  assert.equal(accountMoneySegments(100, 200).shortfallMinor, 100);
  assert.equal(accountMoneySegments(-100, 0).availablePercent, 0);
  assert.equal(accountMoneySegments(-100, 0).shortfallMinor, 100);
});

test('individual shared progress uses each accepted commitment, combining direct and mirrored savings once', () => {
  const rows = buildGoalContributorProgress(sharedGoal({
    participants: [
      { userId: 'me', displayName: 'Alex', status: 'accepted', committedMinor: 100000 },
      { userId: 'sam', displayName: 'Sam', status: 'accepted', committedMinor: 250000 },
    ],
    contributions: [
      contribution(),
      contribution(), // A repeated mirrored record must not count twice.
      contribution({ id: 'direct', goalId: 'shared-goal', amountMinor: 15000 }),
      contribution({ id: 'sam', contributedByUserId: 'sam', amountMinor: 25000 }),
      contribution({ id: 'reversed', reversedAt: '2026-10-06' }),
      contribution({ id: 'returned', returnTransactionId: 'return' }),
    ],
  }), [{ id: 'me', displayName: 'Alex' }]);
  assert.deepEqual(rows.map(({ contributedMinor, commitmentMinor, progress }) => ({ contributedMinor, commitmentMinor, progress })), [
    { contributedMinor: 50000, commitmentMinor: 100000, progress: 50 },
    { contributedMinor: 25000, commitmentMinor: 250000, progress: 10 },
  ]);
  assert.equal(rows[1].displayName, 'Sam');
});

test('accepted participants with no savings show zero; pending invitations do not invent commitments', () => {
  const rows = buildGoalContributorProgress(sharedGoal({
    participants: [
      { userId: 'sam', displayName: 'Sam', status: 'accepted', committedMinor: 250000 },
      { userId: 'pending', displayName: 'Pending', status: 'pending', committedMinor: 100000 },
    ],
  }), []);
  assert.equal(rows[0].contributedMinor, 0);
  assert.equal(rows[0].progress, 0);
  assert.equal(rows[1].commitmentMinor, null);
  assert.equal(rows[1].progress, null);
  assert.equal(rows.some((row) => row.userId === 'pending'), false);
});

test('personal goals use their owner’s target and retain real amounts above the commitment', () => {
  const rows = buildGoalContributorProgress(goal({ targetMinor: 28000 }), [{ id: 'me', displayName: 'Alex' }]);
  assert.equal(rows[0].displayName, 'Alex');
  assert.equal(rows[0].contributedMinor, 35000);
  assert.equal(rows[0].commitmentMinor, 28000);
  assert.equal(rows[0].progress, 125);
  assert.equal(buildGoalContributorProgress(goal({ contributions: [] }), [])[0].progress, 0);
});

test('historical contributors without an accepted commitment are not assigned the whole goal target', () => {
  const rows = buildGoalContributorProgress(sharedGoal({
    participants: [{ userId: 'me', displayName: 'Alex', status: 'removed', committedMinor: 100000 }],
  }), []);
  assert.equal(rows[0].displayName, 'Alex');
  assert.equal(rows[0].contributedMinor, 35000);
  assert.equal(rows[0].commitmentMinor, null);
  assert.equal(rows[0].progress, null);
});
