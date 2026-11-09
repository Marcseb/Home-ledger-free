# Shared savings goals: a complete user guide

This guide follows one example from start to finish:

- **Alex** is the household **Master**.
- **Sam** is a household **Member**.
- They create a shared **Summer trip** goal with a target of **€1,200**.
- Alex invites Sam to commit **€300**.

The example values are only for illustration. The actions below describe the real controls in Home Ledger.

## Before you start

1. Both people must have a paired device in the same household.
2. The Master must have access to **Savings goals**.
3. Accepting an invitation creates a progress-only personal goal automatically. If a member wants contributions to move money, that member can later link this goal to a personal Savings account from **Accounts**.

## Part 1 — The Master creates the shared goal

1. Open **Savings goals**.
2. Select **Shared household**.
3. Tap **+ Add goal**.
4. Leave **Scope** set to **Shared**.
5. Choose the household funding account.
6. Enter:
   - Name: `Summer trip`
   - Target: `€1,200`
   - Due date
   - Priority
7. Tap **Create goal**.

The goal is now visible to the household. It has no participant quotas yet.

### Important distinction

A shared goal is tracked against the household. It cannot be linked to a member’s personal Savings account. The personal account and personal goal remain private to that member.

## Part 2 — The Master invites a member and sets a quota

1. Open **Summer trip**.
2. Scroll to **Participants**.
3. Under **Invite participant**, select **Sam**.
4. Enter **€300** as the committed amount.
5. Tap **Invite member**.

Alex now sees Sam as **pending**:

```text
Sam · pending
€0.00 contributed of €300.00 · €300.00 remaining
```

Alex can see the quota and progress, but not Sam’s private personal-goal name.

## Part 3 — The member accepts the invitation

On Sam’s device:

1. Open **Savings goals**.
2. Select **Shared household**.
3. Open **Summer trip**.
4. In **You’re invited to this goal**, tap **Accept**.
5. Keep **Create my personal goal** selected.
6. Tap **Accept invitation**.

Home Ledger immediately creates a private personal goal for Sam:

- Name: `Summer trip`
- Target: `€300` — Sam’s committed amount, not the full shared target
- Due date: the shared goal’s due date
- Priority: the shared goal’s priority
- Starting progress: `€0`
- Linked Savings account: none initially

Sam finds this goal under **Personal** goals. Alex and other household members see only that Sam is accepted; the personal-goal identity remains private.

Sam may instead select **Use an existing goal** or explicitly select **Participate without personal goal**. An existing accepted participant who has no mapping can use **Create my personal goal** from the shared goal later.

Sam can also choose **Decline**. A declined invitation does not mirror future contributions.

## Part 4 — The member makes a contribution

### Option A: linked personal goal — money moves and progress updates

After acceptance, Sam can edit the automatically created personal goal and link it to Sam’s Savings account. Then:

1. Open the mapped personal goal from **Personal** goals.
2. Tap **Transfer and contribute**.
3. Enter an amount, for example **€100**.
4. Add an optional note.
5. Tap **Transfer and contribute**.

Home Ledger creates one audited transfer:

```text
Sam’s Main account → Sam’s Savings account
```

That same contribution:

- increases Sam’s personal goal by €100;
- mirrors €100 into the shared goal;
- reduces Sam’s remaining quota from €300 to €200;
- appears in contribution history.

### Option B: unlinked personal goal — progress only

If Sam’s personal goal has no linked Savings account:

1. Open the personal goal.
2. Tap **Update saved amount**.
3. Enter the amount and optional note.
4. Tap **Update saved amount**.

No account balance changes. The contribution still updates both the personal goal and the shared goal while participation is accepted.

### Option C: direct shared contribution

A household member can also open the shared goal and contribute directly. This updates the shared goal only; it is not treated as Sam’s private personal-goal contribution unless it is made through the mapped personal goal.

## Part 5 — How the Master monitors progress

Alex opens the shared goal and reviews **Participants**:

```text
Sam · accepted
€100.00 contributed of €300.00 · €200.00 remaining
```

The shared goal total combines:

- direct contributions to the shared goal;
- accepted members’ mirrored personal-goal contributions.

The contribution history labels entries as:

- **Transfer-backed** — an audited account transfer exists;
- **Progress only** — goal progress changed without moving account money;
- **Cancelled / reversed** — the original history remains visible but no longer counts toward the active total.

## Part 6 — Reusing a Savings account across personal goals

Sam can use the same Savings account for several personal goals:

1. Open **Accounts**.
2. Review the Savings account’s:
   - real account balance;
   - **Allocated** amount across active goals;
   - **Unallocated** amount;
   - per-goal allocation rows.
3. When creating or editing a personal goal, select the same Savings account.

Each contribution remains attributed to one goal and one transfer. The account summary shows the combined goal allocations without splitting a single transfer across several goals.

## Part 7 — Correcting or reversing a contribution

Use **Activity** when a posted entry is wrong:

- **Correction** preserves the original history and creates the replacement amount.
- **Cancellation or reversal** keeps the original entry auditable and removes it from active goal totals.

For a mirrored contribution, the personal and shared totals update together exactly once. Retrying the same action does not create a duplicate.

## Part 8 — Removing participation

### The member removes themselves

Sam opens the shared goal and taps **Remove my participation**. After confirmation:

- existing shared progress remains;
- future contributions to Sam’s mapped personal goal no longer mirror into the shared goal;
- Sam’s earlier contribution history is not deleted.

### The Master removes a member

Alex opens the shared goal, finds the participant, and taps **Remove**. This has the same history-preserving effect:

- past progress stays;
- future mirroring stops.

## What each person can see

| Information | Master | Invited member | Other members |
| --- | --- | --- | --- |
| Shared goal name, target, and progress | Yes | Yes | Yes |
| Participant name, status, quota, and contribution progress | Yes | Yes | Yes |
| Whether a member has accepted | Yes | Yes | Yes |
| A member’s private personal-goal name | No | Own mapping only | No |
| A member’s personal Savings account | No | Own accounts only | No |

## Quick reference

1. **Master creates** a Shared goal.
2. **Master invites** a household member with a quota.
3. **Member accepts** or declines.
4. **Home Ledger creates and privately maps** a personal goal using the member’s quota and the shared terms.
5. **Member contributes** through the mapped personal goal to mirror progress.
6. **Master monitors** quota progress and shared totals.
7. **Activity corrections/reversals** preserve history and update totals.
8. **Removal** stops future mirroring without erasing past progress.