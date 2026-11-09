import type { User } from '@workspace/api-client-react';
import { Link } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, SectionTitle } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { calculateGoalMetrics } from '@/lib/goal-calculations';
import { formatCurrency, formatDate, translateLiteral, useI18n } from '@/lib/i18n';
import { buildGoalContributorProgress, type SavingsOverviewData } from '@/lib/savings-overview';

export function SavingsOverviewCard({ overview, users, shared, currency, now }: {
  overview: SavingsOverviewData;
  users: Pick<User, 'id' | 'displayName'>[];
  shared: boolean;
  currency: string;
  now: Date;
}) {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const money = (value: number) => formatCurrency(value, currency, locale);
  const percent = (value: number) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}%`;
  return <View testID="savings-overview">
    <SectionTitle action={<Link href="/goals" asChild><Pressable testID="manage-goals" hitSlop={10} accessibilityRole="link"><Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>{tr('Manage goals')}</Text></Pressable></Link>}>
      {tr('Savings overview')}
    </SectionTitle>
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <View style={styles.goalSection}>
        <Text style={[styles.heading, { color: c.foreground }]}>{tr('Goals progress')}</Text>
        {!overview.goals.length ? <Text testID="savings-no-goals" style={[styles.caption, { color: c.mutedForeground, paddingVertical: 16 }]}>{tr(shared ? 'No active shared goals yet.' : 'No active personal goals for these accounts.')}</Text> : null}
        {overview.goals.map((goal) => {
          const metrics = calculateGoalMetrics(goal, now);
          const statusColor = metrics.status === 'Behind' ? c.destructive : c.primary;
          const statusLabel = tr(metrics.status === 'On track' ? 'Goal on track' : metrics.status);
          const percentage = Math.max(0, Math.min(100, metrics.progress));
          const contributors = buildGoalContributorProgress(goal, users);
          const contributorLabel = (person: typeof contributors[number]) =>
            `${person.displayName ?? tr('Former member')}: ${money(person.contributedMinor)} ${person.commitmentMinor
              ? `${tr('contributed of')} ${money(person.commitmentMinor)}`
              : tr('No planned commitment')}`;
          return <Link key={goal.id} href={{ pathname: '/goals', params: { goalId: goal.id } }} asChild>
            <Pressable testID={`savings-goal-${goal.id}`} accessibilityRole="link"
              accessibilityLabel={`${goal.name}. ${money(goal.currentMinor)} ${tr('of')} ${money(goal.targetMinor)}. ${statusLabel}. ${money(metrics.requiredMonthlyMinor)}${tr('/mo required')}. ${contributors.map(contributorLabel).join('. ')}.`}
              style={({ pressed }) => [styles.goal, { borderTopColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
              <View style={styles.headingRow}>
                <Text style={[styles.goalName, { color: c.foreground }]}>{goal.name}</Text>
                <Text style={[styles.status, { color: statusColor }]}>{statusLabel}</Text>
              </View>
              <View style={styles.progressNumbers}>
                <Text style={[styles.caption, { color: c.mutedForeground }]}><Text style={{ color: c.foreground, fontFamily: 'Inter_700Bold' }}>{money(goal.currentMinor)}</Text> {tr('of')} {money(goal.targetMinor)}</Text>
                <Text style={[styles.status, { color: c.primary }]}>{percent(percentage)}</Text>
              </View>
              <View style={[styles.goalTrack, { backgroundColor: c.muted }]} accessible accessibilityRole="progressbar"
                accessibilityLabel={goal.name} accessibilityValue={{ min: 0, max: 100, now: percentage }}>
                <View style={{ width: `${percentage}%`, backgroundColor: c.primary, height: '100%' }} />
              </View>
              <View style={styles.goalFooter}>
                <Text style={[styles.caption, { color: c.mutedForeground }]}>{tr('Remaining:')} {money(metrics.remainingMinor)}</Text>
                <Text style={[styles.caption, { color: c.foreground, fontFamily: 'Inter_600SemiBold' }]}>{money(metrics.requiredMonthlyMinor)}{tr('/mo required')}</Text>
                <Text style={[styles.caption, { color: c.mutedForeground }]}>{tr('Due ')}{formatDate(`${goal.dueDate}T12:00:00`, locale, { month: 'short', year: 'numeric' })}</Text>
              </View>
              {contributors.length ? <View style={[styles.contributors, { borderTopColor: c.border }]}>
                {contributors.map((person) => {
                  const filled = Math.max(0, Math.min(100, person.progress ?? 0));
                  return <View key={person.userId} testID={`savings-contributor-${goal.id}-${person.userId}`}>
                    <View style={styles.headingRow}>
                      <Text style={[styles.contributorName, { color: c.foreground }]}>{person.displayName ?? tr('Former member')}</Text>
                      <Text style={[styles.caption, { color: c.mutedForeground }]}>
                        {money(person.contributedMinor)}{person.commitmentMinor ? ` ${tr('of')} ${money(person.commitmentMinor)}` : ''}
                      </Text>
                    </View>
                    <View style={styles.contributorProgress}>
                      <View testID={`savings-contributor-bar-${goal.id}-${person.userId}`}
                        accessible accessibilityRole={person.commitmentMinor ? 'progressbar' : 'image'}
                        accessibilityLabel={contributorLabel(person)}
                        accessibilityValue={person.commitmentMinor ? { min: 0, max: 100, now: filled, text: percent(person.progress ?? 0) } : undefined}
                        aria-valuemin={person.commitmentMinor ? 0 : undefined}
                        aria-valuemax={person.commitmentMinor ? 100 : undefined}
                        aria-valuenow={person.commitmentMinor ? filled : undefined}
                        aria-valuetext={person.commitmentMinor ? percent(person.progress ?? 0) : undefined}
                        style={[styles.contributorTrack, { backgroundColor: c.muted }]}>
                        <View style={{ width: `${filled}%`, backgroundColor: c.primary, height: '100%' }} />
                      </View>
                      <Text style={[styles.contributorPercent, { color: c.mutedForeground }]}>
                        {person.progress === null ? tr('No planned commitment') : percent(person.progress)}
                      </Text>
                    </View>
                  </View>;
                })}
              </View> : null}
            </Pressable>
          </Link>;
        })}
      </View>
    </Card>
  </View>;
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  caption: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  goalSection: { paddingHorizontal: 16, paddingTop: 16 },
  goal: { paddingVertical: 16, borderTopWidth: 1, marginTop: 12 },
  goalName: { fontFamily: 'Inter_600SemiBold', fontSize: 15, flexGrow: 1, flexShrink: 1, flexBasis: '60%' },
  status: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  progressNumbers: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6, marginTop: 10 },
  goalTrack: { height: 10, borderRadius: 5, overflow: 'hidden', marginVertical: 10 },
  goalFooter: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4 },
  contributors: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 14, paddingTop: 12, gap: 12 },
  contributorName: { fontFamily: 'Inter_500Medium', fontSize: 12, flexShrink: 1 },
  contributorProgress: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  contributorTrack: { height: 5, borderRadius: 3, overflow: 'hidden', flexGrow: 1, flexBasis: '65%' },
  contributorPercent: { fontFamily: 'Inter_400Regular', fontSize: 11 },
});
