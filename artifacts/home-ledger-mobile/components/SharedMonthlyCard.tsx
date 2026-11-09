import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { formatCurrency, translateLiteral, useI18n } from '@/lib/i18n';

type Props = {
  balanceMinor: number; expenseMinor: number; budgetMinor: number;
  contributionMinor: number; planMinor: number; currency: string; month: string;
  expanded: boolean; onPress: () => void;
};

export function SharedMonthlyCard(props: Props) {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const money = (amount: number) => formatCurrency(amount, props.currency, locale);
  const month = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${props.month}-01T00:00:00Z`));
  const metrics = [
    { label: 'Shared expenses', amount: props.expenseMinor, target: props.budgetMinor, color: c.negativeBar, targetLabel: 'monthly budget', empty: 'No monthly budget' },
    { label: 'Shared goal contributions', amount: props.contributionMinor, target: props.planMinor, color: c.positiveBar, targetLabel: 'monthly plan', empty: 'No monthly plan' },
  ];
  return <Pressable testID="toggle-balances-by-account" accessibilityRole="button"
    accessibilityState={{ expanded: props.expanded }}
    accessibilityLabel={`${tr('Shared household')}, ${tr('Available balance')}: ${money(props.balanceMinor)}. ${metrics.map((metric) =>
      `${tr(metric.label)}: ${money(metric.amount)}${metric.target > 0 ? ` / ${money(metric.target)}` : `, ${tr(metric.empty)}`}`).join('. ')}`}
    accessibilityHint={tr('Tap for balances and history')} onPress={props.onPress}
    style={[styles.card, { backgroundColor: c.primary }]}>
    <View style={styles.row}><Text style={[styles.title, { color: c.primaryForeground }]}>{tr('Shared household')}</Text>
      <Text style={{ color: c.primaryForeground, opacity: 0.76, fontSize: 11 }}>{month}</Text></View>
    <Text style={[styles.balance, { color: c.primaryForeground, marginTop: 12 }]}>{money(props.balanceMinor)}</Text>
    <Text style={{ color: c.primaryForeground, opacity: 0.8 }}>{tr('Available balance')} · {props.currency}</Text>
    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.primaryForeground, opacity: 0.18, marginVertical: 17 }} />
    {metrics.map((metric) => {
      const percent = metric.target > 0 ? Math.round(metric.amount / metric.target * 100) : 0;
      const remaining = metric.target - metric.amount;
      const remainingLabel = metric.target <= 0 ? tr(metric.empty) : remaining < 0
        ? `${money(-remaining)} ${tr('over')}` : `${money(remaining)} ${tr(metric.targetLabel === 'monthly budget' ? 'left' : 'to plan')}`;
      return <View key={metric.label} style={{ marginBottom: 16, gap: 7 }}>
        <View style={styles.row}><Text style={[styles.metric, { color: c.primaryForeground }]}>{tr(metric.label)}</Text>
          <Text style={{ color: c.primaryForeground, fontSize: 12 }}>{money(metric.amount)}{metric.target > 0 ? ` / ${money(metric.target)}` : ''}</Text></View>
        <View accessibilityRole="progressbar"
          accessibilityLabel={`${tr(metric.label)}: ${money(metric.amount)}${metric.target > 0 ? ` / ${money(metric.target)}` : `, ${tr(metric.empty)}`}`}
          accessibilityValue={{ min: 0, max: 100, now: Math.min(100, percent) }}
          {...(Platform.OS === 'web' ? { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.min(100, percent) } : {})}
          style={[styles.track, { backgroundColor: c.balanceTrack }]}>
          <View style={[styles.track, { backgroundColor: metric.color, width: `${Math.min(100, Math.max(0, percent))}%` }]} />
        </View>
        <View style={styles.row}><Text style={{ color: c.primaryForeground, opacity: 0.74, fontSize: 10 }}>
          {metric.target > 0 ? `${percent}% ${tr(`of ${metric.targetLabel}`)}` : '—'}
        </Text><Text style={{ color: c.primaryForeground, fontFamily: 'Inter_600SemiBold', fontSize: 10 }}>{remainingLabel}</Text></View>
      </View>;
    })}
    <View style={styles.row}><Text style={{ color: c.primaryForeground, opacity: 0.72, fontSize: 10 }}>
      {tr(props.expanded ? 'Tap card to return' : 'Tap for balances and history')}
    </Text><Feather name={props.expanded ? 'chevron-up' : 'chevron-down'} size={15} color={c.primaryForeground} /></View>
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, padding: 20, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  balance: { fontFamily: 'Inter_700Bold', fontSize: 38 },
  metric: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  track: { height: 7, borderRadius: 999, overflow: 'hidden' },
});
