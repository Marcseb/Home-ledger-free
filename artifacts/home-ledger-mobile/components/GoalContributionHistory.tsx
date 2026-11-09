import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SavingsGoal } from '@workspace/api-client-react';
import { Button, Card, SectionTitle } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useLedger } from '@/lib/ledger-context';
import { formatCurrency, formatDate, translateLiteral, useI18n } from '@/lib/i18n';

export function GoalContributionHistory({ goal }: { goal: SavingsGoal }) {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (text: string) => translateLiteral(text, locale);
  const { state, session, online, cancelSavingsGoalContribution } = useLedger();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operationIds = useRef<Record<string, string>>({});

  const cancel = async (contributionId: string) => {
    if (busyId) return;
    const operationId = operationIds.current[contributionId] ??=
      `goal-contribution-cancel-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    setBusyId(contributionId);
    setError(null);
    try {
      await cancelSavingsGoalContribution(goal.id, contributionId, operationId);
      setConfirmingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? tr(cause.message) : tr('Could not cancel contribution'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <SectionTitle>{tr('Contributions history')}</SectionTitle>
      <Card>
        {!goal.contributions.length ? <Text style={{ color: c.mutedForeground }}>{tr('No contributions yet.')}</Text> : (
          goal.contributions.slice().reverse().map((contribution) => {
            const user = state?.users.find((item) => item.id === contribution.contributedByUserId);
            const sourceGoal = state?.savingsGoals.find((item) => item.id === contribution.goalId);
            const canCancel = contribution.contributedByUserId === session?.user.id
              && !contribution.reversedAt && goal.status === 'active' && sourceGoal?.status === 'active';
            return (
              <View key={contribution.id} style={{ paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>{contribution.note || tr('Contribution')}</Text>
                    <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{user?.displayName ?? tr('Someone')} · {formatDate(contribution.occurredAt, locale)}</Text>
                    <Text style={{ color: contribution.reversedAt ? c.destructive : c.mutedForeground, fontSize: 12 }}>
                      {contribution.reversedAt ? `${tr('Cancelled / reversed')} ${formatDate(contribution.reversedAt, locale)}` : contribution.transactionId ? tr('Transfer-backed') : tr('Progress only')}
                    </Text>
                  </View>
                  <Text style={{ color: contribution.reversedAt ? c.mutedForeground : c.primary, fontFamily: 'Inter_700Bold', textDecorationLine: contribution.reversedAt ? 'line-through' : 'none' }}>
                    +{formatCurrency(contribution.amountMinor, state?.baseCurrency ?? 'USD', locale)}
                  </Text>
                </View>
                {canCancel && confirmingId !== contribution.id ? (
                  <Pressable
                    accessibilityRole="button" accessibilityLabel={tr('Cancel contribution')}
                    testID={`cancel-contribution-${contribution.id}`} disabled={!online || busyId !== null}
                    onPress={() => { setConfirmingId(contribution.id); setError(null); }}
                    style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', opacity: online && !busyId ? 1 : 0.45 }}
                  >
                    <Text style={{ color: c.destructive, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>{tr('Cancel contribution')}</Text>
                  </Pressable>
                ) : null}
                {canCancel && confirmingId === contribution.id ? (
                  <View testID="contribution-cancel-confirmation" style={{ marginTop: 12, gap: 10 }}>
                    <Text style={{ color: c.foreground }}>{tr('Remove this contribution from goal progress? No money will move. Any original transfer stays posted.')}</Text>
                    {contribution.sharedGoalId ? <Text style={{ color: c.mutedForeground }}>{tr('This removes the contribution from both your personal goal and the shared goal.')}</Text> : null}
                    {error ? <Text accessibilityRole="alert" style={{ color: c.destructive }}>{error}</Text> : null}
                    <View style={{ gap: 8 }}>
                      <Button label={busyId ? tr('Cancelling…') : tr('Cancel contribution')} testID="confirm-cancel-contribution" disabled={!online || busyId !== null} onPress={() => void cancel(contribution.id)} />
                      <Button label={tr('Keep contribution')} secondary disabled={busyId !== null} onPress={() => { setConfirmingId(null); setError(null); }} />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
        {!online ? <Text style={{ color: c.mutedForeground, marginTop: 8 }}>{tr('Connect to the server before cancelling a contribution.')}</Text> : null}
      </Card>
    </>
  );
}
