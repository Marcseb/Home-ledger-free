import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { ContextHelp } from '@/components/HelpButton';
import { Button, Card, Field, SectionTitle } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useLedger } from '@/lib/ledger-context';
import type { Budget } from '@workspace/api-client-react';
import { businessMonth } from '@/lib/app-time';
import { formatCurrency, translateLiteral, useI18n } from '@/lib/i18n';

export default function Budgets() {
  const c = useColors();
  const { t, locale } = useI18n();
  const { state, session, online, addBudget, editBudget, removeBudget } = useLedger();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [warning, setWarning] = useState('80');
  const [busy, setBusy] = useState(false);
  const currentMonth = businessMonth(state);
  const current = useMemo(() => (state?.budgets ?? []).filter((item) => item.month === currentMonth), [currentMonth, state?.budgets]);
  const history = useMemo(() => (state?.budgets ?? []).filter((item) => item.month !== currentMonth).slice(0, 12), [currentMonth, state?.budgets]);
  const categories = useMemo(() => (state?.categories ?? []).filter((item) => !item.system && !item.archived), [state?.categories]);
  const editing = current.find((item) => item.categoryId === editingId && item.enabled);
  const reset = () => { setEditingId(null); setAmount(''); setWarning('80'); };
  const beginEdit = (budget: Budget) => { setEditingId(budget.categoryId); setAmount((budget.limitMinor / 100).toFixed(2)); setWarning(String(budget.warningPercent)); };
  const save = async () => {
    if (!editingId) return;
    const limitMinor = Math.round(Number(amount.replace(',', '.')) * 100);
    const warningPercent = Number(warning);
    if (!Number.isInteger(limitMinor) || limitMinor < 1 || !Number.isInteger(warningPercent) || warningPercent < 1 || warningPercent > 100) {
       Alert.alert(t('checkDetails'), translateLiteral('Enter a positive amount and a warning threshold from 1 to 100%.', locale)); return;
    }
    setBusy(true);
    try {
      const input = { categoryId: editingId, limitMinor, warningPercent, enabled: true };
      if (editing) await editBudget(editingId, input); else await addBudget(input);
      reset();
    } catch (error) { Alert.alert(t('error'), error instanceof Error ? error.message : t('tryAgain')); } finally { setBusy(false); }
  };
  const categoryName = (id: string) => categories.find((item) => item.id === id)?.name ?? id;
  const tr = (value: string) => translateLiteral(value, locale);
  return (
    <KeyboardAwareScrollViewCompat style={{ backgroundColor: c.background }} contentContainerStyle={styles.content} bottomOffset={40} keyboardShouldPersistTaps="handled">
      <Text style={[styles.heading, { color: c.foreground }]}>{t('budgets')}</Text>
       <ContextHelp topic="budgets" />
       {!online ? <Text style={{ color: c.tint }}>{translateLiteral('Budget changes require a connection to the household server.', locale)}</Text> : null}
       <SectionTitle>{translateLiteral('Current month', locale)}</SectionTitle>
      <Card>
        {editingId ? <><Text style={[styles.formTitle, { color: c.foreground }]}>{tr(editing ? 'Edit budget for' : 'Set budget for')} {categoryName(editingId)}</Text><Field label={tr('Monthly amount')} value={amount} onChangeText={setAmount} placeholder="500.00" keyboardType="numeric" testID="budget-amount" /><Field label={tr('Warn at (%)')} value={warning} onChangeText={setWarning} placeholder="80" keyboardType="numeric" testID="budget-warning" /><View style={styles.actions}><Button label={tr('Cancel')} icon="x" onPress={reset} secondary /><Button label={tr(busy ? 'Saving…' : 'Save budget')} icon="check" onPress={() => void save()} disabled={busy || !online} testID="save-budget" /></View></> : <Text style={{ color: c.mutedForeground }}>{tr('Choose an expense category below to set a budget.')}</Text>}
      </Card>
      {(['shared', 'personal'] as const).map((scope) => {
        const scoped = categories.filter((category) => category.scope === scope && (scope === 'personal' ? category.ownerUserId === session?.user.id : true));
        if (!scoped.length) return null;
        const totalBudgetMinor = scoped.reduce((total, category) => (
          total + (current.find((item) => item.categoryId === category.id && item.enabled)?.limitMinor ?? 0)
        ), 0);
        return <React.Fragment key={scope}><SectionTitle>{tr(scope === 'shared' ? 'Shared household' : 'Personal')}</SectionTitle><Card><View style={[styles.totalRow, { borderBottomColor: c.border }]}><Text style={[styles.totalLabel, { color: c.mutedForeground }]}>{tr('Total budget')}</Text><Text testID={`budget-total-${scope}`} style={[styles.totalAmount, { color: c.foreground }]}>{formatCurrency(totalBudgetMinor, state?.baseCurrency ?? 'USD', locale)}</Text></View>{scoped.map((category) => {
          const budget = current.find((item) => item.categoryId === category.id && item.enabled);
          const canManage = scope === 'personal' || session?.user.role === 'master';
          const percent = budget?.percentUsed ?? 0;
          const statusColor = budget?.status === 'over' || budget?.status === 'warning' || budget?.status === 'at_limit' ? c.tint : c.primary;
          return <View key={category.id} style={styles.row}><View style={[styles.dot, { backgroundColor: category.color }]} /><View style={{ flex: 1 }}><Text style={[styles.name, { color: c.foreground }]}>{category.name}</Text>{budget ? <><Text style={{ color: c.mutedForeground, fontSize: 12 }}>{formatCurrency(budget.spentMinor, state?.baseCurrency ?? 'USD', locale)} {tr('of')} {formatCurrency(budget.limitMinor, state?.baseCurrency ?? 'USD', locale)} · {tr(budget.status)}</Text><View style={[styles.track, { backgroundColor: c.muted }]}><View style={[styles.fill, { width: `${Math.min(100, percent)}%`, backgroundColor: statusColor }]} /></View></> : <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{tr('No budget set')}</Text>}</View>{canManage ? <Pressable testID={`edit-budget-${category.id}`} accessibilityLabel={`${tr('Edit budget for')} ${category.name}`} onPress={() => { if (budget) beginEdit(budget); else { setEditingId(category.id); setAmount(''); setWarning('80'); } }}><Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold' }}>{tr(budget ? 'Edit' : 'Set')}</Text></Pressable> : null}{budget && canManage ? <Pressable testID={`disable-budget-${category.id}`} onPress={() => Alert.alert(tr('Disable budget?'), tr('It will stop tracking this category for the current month.'), [{ text: tr('Cancel'), style: 'cancel' }, { text: tr('Disable'), style: 'destructive', onPress: () => void removeBudget(category.id) }])}><Text style={{ color: c.tint, marginLeft: 12 }}>{tr('Disable')}</Text></Pressable> : null}</View>;
        })}</Card></React.Fragment>;
      })}
       <SectionTitle>{translateLiteral('Past months', locale)}</SectionTitle>
       <Card>{history.length ? history.map((budget) => <View key={budget.id} style={styles.history}><Text style={[styles.name, { color: c.foreground }]}>{categoryName(budget.categoryId)}</Text><Text style={{ color: c.mutedForeground }}>{budget.month} · {formatCurrency(budget.spentMinor, state?.baseCurrency ?? 'USD', locale)} / {formatCurrency(budget.limitMinor, state?.baseCurrency ?? 'USD', locale)} · {tr(budget.status)}</Text></View>) : <Text style={{ color: c.mutedForeground }}>{translateLiteral('Past monthly results will appear here.', locale)}</Text>}</Card>
    </KeyboardAwareScrollViewCompat>
  );
}
const styles = StyleSheet.create({ content: { padding: 18, paddingBottom: 70, gap: 14 }, heading: { fontFamily: 'Inter_700Bold', fontSize: 28 }, formTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginBottom: 14 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, marginBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth }, totalLabel: { fontFamily: 'Inter_600SemiBold' }, totalAmount: { fontFamily: 'Inter_700Bold', fontSize: 18 }, row: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 10 }, dot: { width: 12, height: 12, borderRadius: 6 }, name: { fontFamily: 'Inter_600SemiBold', marginBottom: 3 }, track: { height: 7, borderRadius: 4, overflow: 'hidden', marginTop: 7 }, fill: { height: '100%', borderRadius: 4 }, history: { paddingVertical: 9 } });