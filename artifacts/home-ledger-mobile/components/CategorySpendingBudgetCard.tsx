import { Feather } from '@expo/vector-icons';
import { Link } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { formatCurrency, formatDate, translateLiteral, useI18n } from '@/lib/i18n';
import { categorySpendingBudgetRows } from '@/lib/category-spending-budget';

type Props = {
  rows: ReturnType<typeof categorySpendingBudgetRows>;
  month: string;
  scope: string;
  currency: string;
  expenseMinor: number;
  selectedPersonalAccount: boolean;
  onSelect: (categoryId: string) => void;
};

export function CategorySpendingBudgetCard({ rows, month, scope, currency, expenseMinor, selectedPersonalAccount, onSelect }: Props) {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (text: string) => translateLiteral(text, locale);
  const money = (amount: number) => formatCurrency(amount, currency, locale);
  const over = rows.filter((row) => row.budget?.status === 'over').length;
  const near = rows.filter((row) => row.budget?.status === 'warning' || row.budget?.status === 'at_limit').length;
  return <Card>
    <View style={styles.heading}>
      <Text style={[styles.title, { color: c.foreground }]}>{tr('Category spending & budgets')}</Text>
      <Link href="/budgets" asChild><Pressable testID="manage-budgets-home" accessibilityRole="button" accessibilityLabel={tr('Manage budgets')} style={styles.manage}>
        <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>{tr('Manage')}</Text>
      </Pressable></Link>
    </View>
    <Text style={[styles.caption, { color: c.mutedForeground }]}>{formatDate(`${month}-01T12:00:00`, locale, { month: 'long', year: 'numeric' })} · {scope}</Text>
    {over || near ? <Text testID="category-budget-attention" style={[styles.caption, { color: c.tint, marginTop: 8 }]}>{[
      over ? `${over} ${tr('over budget')}` : '',
      near ? `${near} ${tr('near limit')}` : '',
    ].filter(Boolean).join(' · ')}</Text> : null}
    {selectedPersonalAccount && rows.some((row) => row.budget) ? <Text style={[styles.caption, { color: c.mutedForeground, marginTop: 8 }]}>{tr('Budget usage covers all personal accounts.')}</Text> : null}
    {rows.length ? <ScrollView nestedScrollEnabled style={styles.list} showsVerticalScrollIndicator>
      {rows.map((row) => {
        const budget = row.budget;
        const share = row.amountMinor / Math.max(1, expenseMinor) * 100;
        const status = budget?.status === 'over' ? 'Over budget' : budget?.status === 'at_limit' ? 'At limit' : budget?.status === 'warning' ? 'Near limit' : 'On track';
        const attention = budget && budget.status !== 'normal';
        const limit = budget ? budget.limitMinor + budget.rolloverMinor : 0;
        const budgetDetail = budget ? `${tr('Budget')} ${money(limit)} · ${Math.round(budget.percentUsed)}% ${tr('used')} · ${tr(status)}${budget.status === 'over' ? ` · ${money(Math.max(0, budget.spentMinor - limit))} ${tr('over')}` : ''}` : tr('No budget set');
        return <Pressable key={row.categoryId} testID={`spending-category-${row.categoryId}`} accessibilityRole="button"
          accessibilityLabel={`${row.name}, ${money(row.amountMinor)}. ${budgetDetail}`}
          accessibilityHint={tr('Tap a category to view this month’s entries.')}
          onPress={() => onSelect(row.categoryId)} style={[styles.row, { borderTopColor: c.border }]}>
          <View style={styles.heading}>
            <View style={styles.name}><View style={[styles.dot, { backgroundColor: row.color }]} /><Text style={[styles.category, { color: c.foreground }]}>{row.name}</Text></View>
            <Text style={{ color: c.foreground, fontFamily: 'Inter_700Bold' }}>{money(row.amountMinor)} <Feather name="chevron-right" size={13} color={c.mutedForeground} /></Text>
          </View>
          <View style={[styles.heading, { marginTop: 9 }]}><Text style={[styles.caption, { color: c.mutedForeground, flex: 1 }]}>{tr('Share of monthly spending')}</Text><Text style={[styles.caption, { color: c.mutedForeground }]}>{Math.round(share)}%</Text></View>
          <View style={[styles.track, { backgroundColor: c.muted }]}><View style={[styles.fill, { backgroundColor: row.color, width: `${Math.min(100, share)}%` }]} /></View>
          <Text testID={`category-budget-${row.categoryId}`} style={[styles.caption, { color: attention ? c.tint : c.mutedForeground, marginTop: 9, lineHeight: 18 }]}>{budgetDetail}</Text>
          {budget ? <View style={[styles.track, { backgroundColor: c.muted }]}><View style={[styles.fill, { backgroundColor: attention ? c.tint : c.primary, width: `${Math.max(0, Math.min(100, budget.percentUsed))}%` }]} /></View> : null}
        </Pressable>;
      })}
    </ScrollView> : <Text style={[styles.caption, { color: c.mutedForeground, marginTop: 14 }]}>{tr('Add an expense or set a budget to see category patterns.')}</Text>}
    {rows.length ? <Text style={[styles.caption, { color: c.mutedForeground, marginTop: 12 }]}>{tr('Tap a category to view this month’s entries.')}</Text> : null}
  </Card>;
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 17 },
  manage: { minHeight: 44, justifyContent: 'center', paddingLeft: 8 },
  caption: { fontSize: 11, lineHeight: 16 },
  list: { maxHeight: 430, marginTop: 14 },
  row: { paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth },
  name: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  category: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 5 },
  fill: { height: 6, borderRadius: 3 },
});