import { Feather } from '@expo/vector-icons';
import type { RecurringRuleInput } from '@workspace/api-client-react';
import { businessDateValue } from '@/lib/app-time';
import React, { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { ContextHelp } from '@/components/HelpButton';
import { Button, Card, Field, SectionTitle } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useLedger } from '@/lib/ledger-context';
import { formatCurrency, translateLiteral, useI18n } from '@/lib/i18n';
import { formatTransactionDate as formatDate } from '@/lib/transaction-display';

const dateValue = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateValue = (value: string, endOfDay = false) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, endOfDay ? 23 : 12, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
};

export default function RecurringEntries() {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const { state, session, online, addRecurringRule, editRecurringRule, setRecurringRuleActive, removeRecurringRule } = useLedger();
  const isMaster = session?.user.role === 'master';
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [kind, setKind] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [frequency, setFrequency] = useState<'weekly' | 'monthly' | 'custom'>('monthly');
  const [customMonths, setCustomMonths] = useState('12');
  const [endCondition, setEndCondition] = useState<'never' | 'date' | 'occurrences'>('never');
  const [endDate, setEndDate] = useState(businessDateValue(state));
  const [occurrenceCount, setOccurrenceCount] = useState('12');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [firstDate, setFirstDate] = useState(businessDateValue(state));
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedDestinationAccountId, setSelectedDestinationAccountId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [assignedUserId, setAssignedUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const accounts = useMemo(
    () => state?.accounts.filter((item) => isMaster
      ? !item.archived && (item.kind === 'shared' || item.ownerUserId === session?.user.id)
      : !item.archived && item.kind === 'personal' && item.ownerUserId === session?.user.id) ?? [],
    [isMaster, session?.user.id, state?.accounts],
  );
  const sourceAccounts = kind === 'transfer'
    ? accounts.filter((item) => item.kind === 'personal' && (item.role === 'main' || item.role === 'savings'))
    : accounts;
  const account = sourceAccounts.find((item) => item.id === selectedAccountId)
    ?? (editingRuleId && selectedAccountId ? undefined
      : sourceAccounts.find((item) => kind === 'transfer' ? item.role === 'main' : item.kind === 'shared')
        ?? sourceAccounts[0]);
  const destinationAccounts = kind === 'transfer' && account
    ? sourceAccounts.filter((item) => item.ownerUserId === account.ownerUserId
      && item.role === (account.role === 'main' ? 'savings' : 'main'))
    : [];
  const destinationAccount = destinationAccounts.find((item) => item.id === selectedDestinationAccountId)
    ?? (editingRuleId && selectedDestinationAccountId ? undefined : destinationAccounts[0]);
  const categories = state?.categories.filter((item) => {
    if (item.archived) return false;
    if (kind === 'income') return item.id === 'income';
    if (kind === 'transfer') return item.id === 'transfer';
    if (!account || item.system || item.scope !== account.kind) return false;
    return item.scope === 'shared' || item.ownerUserId === session?.user.id;
  }) ?? [];
  const preferredCategory = categories[0];
  const category = categories.find((item) => item.id === selectedCategoryId) ?? preferredCategory;
  const rules = state?.recurringRules ?? [];
  const canManageRule = (rule: (typeof rules)[number]) => {
    if (isMaster) return true;
    const account = state?.accounts.find((item) => item.id === rule.transactionTemplate.accountId);
    return account?.kind === 'personal' && account.ownerUserId === session?.user.id;
  };
  const resetForm = () => {
    setEditingRuleId(null);
    setKind('expense');
    setFrequency('monthly');
    setCustomMonths('12');
    setEndCondition('never');
    setEndDate(businessDateValue(state));
    setOccurrenceCount('12');
    setAmount('');
    setNote('');
    setFirstDate(businessDateValue(state));
    setSelectedAccountId(null);
    setSelectedDestinationAccountId(null);
    setSelectedCategoryId(null);
    setAssignedUserId(null);
  };
  const beginEdit = (rule: (typeof rules)[number]) => {
    const template = rule.transactionTemplate;
    setEditingRuleId(rule.id);
    setKind(template.kind);
    setFrequency(rule.cadence === 'weekly' ? 'weekly' : rule.intervalMonths > 1 ? 'custom' : 'monthly');
    setCustomMonths(String(rule.intervalMonths > 1 ? rule.intervalMonths : 12));
    setEndCondition(rule.endCondition);
    setEndDate(rule.endAt ? dateValue(new Date(rule.endAt)) : businessDateValue(state));
    setOccurrenceCount(String(rule.remainingOccurrences ?? 12));
    setAmount((template.amountMinor / 100).toFixed(2));
    setNote(template.note);
    setFirstDate(dateValue(new Date(rule.nextRunAt)));
    setSelectedAccountId(template.accountId);
    setSelectedDestinationAccountId(template.destinationAccountId ?? null);
    setSelectedCategoryId(template.categoryId);
    setAssignedUserId(rule.assignedUserId);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  };

  const save = async () => {
    const parsedAmount = Number(amount.replace(',', '.'));
    const parsedDate = parseDateValue(firstDate);
    const parsedIntervalMonths = Number(customMonths);
    const parsedEndDate = parseDateValue(endDate, true);
    const parsedOccurrenceCount = Number(occurrenceCount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || !account || !category) {
      Alert.alert(tr('Check the details'), tr('Choose an account and enter an amount greater than zero.'));
      return;
    }
    if (kind === 'transfer' && !destinationAccount) {
      Alert.alert(tr('Check the details'), tr('Choose your Main and a Savings account for the transfer.'));
      return;
    }
    if (!parsedDate) {
      Alert.alert(tr('Check the first date'), tr('Use the format YYYY-MM-DD.'));
      return;
    }
    if (!note.trim()) {
      Alert.alert(tr('Add a description'), tr('Describe the recurring entry so it is easy to recognize.'));
      return;
    }
    if (frequency === 'custom' && (!Number.isInteger(parsedIntervalMonths) || parsedIntervalMonths < 2 || parsedIntervalMonths > 120)) {
      Alert.alert(tr('Check the frequency'), tr('Enter a whole number from 2 to 120 months.'));
      return;
    }
    if (endCondition === 'date' && (
      !parsedEndDate
      || parsedEndDate.getTime() < parsedDate.getTime()
    )) {
      Alert.alert(tr('Check the ending date'), tr('Choose a valid date on or after the next transaction.'));
      return;
    }
    if (endCondition === 'occurrences' && (
      !Number.isInteger(parsedOccurrenceCount)
      || parsedOccurrenceCount < 1
      || parsedOccurrenceCount > 10000
    )) {
      Alert.alert(tr('Check the occurrence limit'), tr('Enter a whole number from 1 to 10,000.'));
      return;
    }
    const input: RecurringRuleInput = {
      cadence: frequency === 'weekly' ? 'weekly' : 'monthly',
      intervalMonths: frequency === 'custom' ? parsedIntervalMonths : 1,
      nextRunAt: parsedDate.toISOString(),
      assignedUserId: account.kind === 'shared' ? assignedUserId : null,
      endCondition,
      endAt: endCondition === 'date' ? parsedEndDate!.toISOString() : null,
      remainingOccurrences: endCondition === 'occurrences' ? parsedOccurrenceCount : null,
      transactionTemplate: {
        kind,
        accountId: account.id,
        destinationAccountId: kind === 'transfer' ? destinationAccount?.id : null,
        amountMinor: Math.round(parsedAmount * 100),
        currency: state?.baseCurrency ?? 'USD',
        categoryId: category.id,
        note: note.trim(),
      },
    };
    setBusy(true);
    try {
      if (editingRuleId) await editRecurringRule(editingRuleId, input);
      else await addRecurringRule(input);
      const wasEditing = Boolean(editingRuleId);
      resetForm();
       Alert.alert(tr(wasEditing ? 'Recurring entry updated' : 'Recurring entry saved'), `${tr('The server will create the next transaction on ')}${firstDate}.`);
    } catch (error) {
      Alert.alert(tr('Could not save'), error instanceof Error ? error.message : tr('Check the server connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (ruleId: string, active: boolean) => {
    void setRecurringRuleActive(ruleId, active).catch((error) => {
      Alert.alert(tr('Could not update'), error instanceof Error ? error.message : tr('Try again.'));
    });
  };
  const confirmDelete = (ruleId: string, label: string) => Alert.alert(
    tr('Delete recurring entry?'),
    `${label}${tr(' will no longer create future transactions. Existing transactions stay in the ledger.')}`,
    [
      { text: tr('Cancel'), style: 'cancel' },
      {
        text: tr('Delete'),
        style: 'destructive',
        onPress: () => {
          void removeRecurringRule(ruleId).catch((error) => {
            Alert.alert(tr('Could not delete'), error instanceof Error ? error.message : tr('Try again.'));
          });
        },
      },
    ],
  );

  return (
    <KeyboardAwareScrollViewCompat
      scrollRef={scrollRef}
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      bottomOffset={70}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.heading, { color: c.foreground }]}>{tr('Recurring entries')}</Text>
      <ContextHelp topic="recurring" />
      <Text style={[styles.intro, { color: c.mutedForeground }]}>
        {isMaster
           ? tr('Your desktop server creates due transactions once, even when several phones are paired.')
           : tr('Shared household schedules are managed by the master user. You can schedule entries for your own personal account.')}
      </Text>
      <Card>
        {editingRuleId ? (
          <View style={styles.editHeader}>
            <Text style={[styles.editTitle, { color: c.foreground }]}>{tr('Edit recurring entry')}</Text>
            <Pressable onPress={resetForm} hitSlop={8}>
              <Text style={{ color: c.tint, fontFamily: 'Inter_600SemiBold' }}>{tr('Cancel')}</Text>
            </Pressable>
          </View>
        ) : null}
        <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('Type')}</Text>
        <View style={styles.pills}>
          {(['expense', 'income', 'transfer'] as const).map((value) => (
            <Pressable key={value} testID={`recurring-type-${value}`} onPress={() => { setKind(value); setSelectedAccountId(null); setSelectedDestinationAccountId(null); setSelectedCategoryId(null); setAssignedUserId(null); }} style={[styles.pill, { backgroundColor: kind === value ? c.primary : c.secondary }]}>
              <Text style={{ color: kind === value ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>
                {tr(value === 'expense' ? 'Bill' : value === 'income' ? 'Income' : 'Transfer')}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.label, { color: c.mutedForeground }]}>{tr(kind === 'transfer' ? 'From account' : 'Account')}</Text>
        <View style={styles.wrap}>
          {sourceAccounts.map((item) => {
            const selected = item.id === account?.id;
            return (
              <Pressable key={item.id} testID={`recurring-source-${item.id}`} onPress={() => { setSelectedAccountId(item.id); setSelectedDestinationAccountId(null); setSelectedCategoryId(null); setAssignedUserId(null); }} style={[styles.choice, { backgroundColor: selected ? c.primary : c.secondary }]}>
                <Feather name={item.kind === 'shared' ? 'users' : item.role === 'savings' ? 'archive' : 'user'} size={15} color={selected ? c.primaryForeground : c.secondaryForeground} />
                <Text style={{ color: selected ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{item.name}</Text>
              </Pressable>
            );
          })}
        </View>
        {kind === 'transfer' ? (
          <>
            <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('To account')}</Text>
            <View style={styles.wrap}>
              {destinationAccounts.map((item) => {
                const selected = item.id === destinationAccount?.id;
                return (
                  <Pressable key={item.id} testID={`recurring-destination-${item.id}`} onPress={() => setSelectedDestinationAccountId(item.id)} style={[styles.choice, { backgroundColor: selected ? c.primary : c.secondary }]}>
                    <Feather name={item.role === 'savings' ? 'archive' : 'user'} size={15} color={selected ? c.primaryForeground : c.secondaryForeground} />
                    <Text style={{ color: selected ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{item.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.helper, { color: c.mutedForeground }]}>
              {tr(destinationAccounts.length ? 'Move money between your own Main and Savings accounts. This does not update savings-goal progress.' : 'Create a Savings account in Settings before scheduling a transfer.')}
            </Text>
          </>
        ) : null}
        {isMaster && account?.kind === 'shared' ? (
          <>
            <Text style={[styles.label, { color: c.mutedForeground }]}>{tr(kind === 'expense' ? 'Paid by' : 'Received by')}</Text>
            <Text style={[styles.helper, { color: c.mutedForeground }]}>
              {tr('Assign the future shared transaction to the household member responsible for it.')}
            </Text>
            <View style={styles.wrap}>
              <Pressable onPress={() => setAssignedUserId(null)} style={[styles.choice, { backgroundColor: assignedUserId === null ? c.primary : c.secondary }]}>
                <Feather name="minus-circle" size={15} color={assignedUserId === null ? c.primaryForeground : c.secondaryForeground} />
                <Text style={{ color: assignedUserId === null ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{tr('Unassigned')}</Text>
              </Pressable>
              {(state?.users ?? []).map((user) => {
                const selected = assignedUserId === user.id;
                return (
                  <Pressable key={user.id} onPress={() => setAssignedUserId(user.id)} style={[styles.choice, { backgroundColor: selected ? c.primary : c.secondary }]}>
                    <Feather name="user" size={15} color={selected ? c.primaryForeground : c.secondaryForeground} />
                    <Text style={{ color: selected ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{user.displayName}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
        {kind !== 'transfer' ? <>
          <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('Category')}</Text>
          <View style={styles.wrap}>
            {categories.map((item) => {
              const selected = item.id === category?.id;
              return (
                <Pressable key={item.id} onPress={() => setSelectedCategoryId(item.id)} style={[styles.choice, { backgroundColor: selected ? c.primary : c.secondary }]}>
                  <Text style={{ color: selected ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{item.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </> : null}
        <Field label={tr('Amount')} value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="numeric" />
        <Field label={tr('Description')} value={note} onChangeText={setNote} placeholder={tr('Rent, salary, electricity…')} />
        <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('Frequency')}</Text>
        <View style={styles.frequencyOptions}>
          {(['weekly', 'monthly'] as const).map((value) => {
            const selected = frequency === value;
            return (
              <Pressable key={value} onPress={() => setFrequency(value)} style={[styles.pill, { backgroundColor: selected ? c.primary : c.secondary }]}>
                <Text style={{ color: selected ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{tr(value === 'weekly' ? 'Weekly' : 'Monthly')}</Text>
              </Pressable>
            );
          })}
          <View style={[styles.customFrequency, { backgroundColor: frequency === 'custom' ? c.primary : c.secondary }]}>
            <Pressable onPress={() => setFrequency('custom')} hitSlop={8}>
                <Text style={{ color: frequency === 'custom' ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{tr('Every')}</Text>
            </Pressable>
            <TextInput
              testID="recurring-custom-months"
              value={customMonths}
              onChangeText={setCustomMonths}
              onFocus={() => setFrequency('custom')}
              keyboardType="numeric"
              selectTextOnFocus
              maxLength={3}
              accessibilityLabel={tr('Number of months between recurring entries')}
              style={[styles.monthInput, { color: c.foreground, borderColor: c.input, backgroundColor: c.card }]}
            />
            <Pressable onPress={() => setFrequency('custom')} hitSlop={8}>
               <Text style={{ color: frequency === 'custom' ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{tr('months')}</Text>
            </Pressable>
          </View>
        </View>
        <Field label={tr(editingRuleId ? 'Next date (YYYY-MM-DD)' : 'First date (YYYY-MM-DD)')} value={firstDate} onChangeText={setFirstDate} placeholder="2026-09-20" />
        <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('Ends')}</Text>
        <View style={styles.frequencyOptions}>
          {([
            ['never', 'Never'],
            ['date', 'On date'],
            ['occurrences', 'After entries'],
          ] as const).map(([value, label]) => {
            const selected = endCondition === value;
            return (
              <Pressable key={value} onPress={() => setEndCondition(value)} style={[styles.pill, { backgroundColor: selected ? c.primary : c.secondary }]}>
                <Text style={{ color: selected ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{tr(label)}</Text>
              </Pressable>
            );
          })}
        </View>
        {endCondition === 'date' ? (
          <Field
            label={tr('Ending date (YYYY-MM-DD)')}
            value={endDate}
            onChangeText={setEndDate}
            placeholder="2027-09-20"
            testID="recurring-end-date"
          />
        ) : null}
        {endCondition === 'occurrences' ? (
          <Field
            label={tr('Number of future entries')}
            value={occurrenceCount}
            onChangeText={setOccurrenceCount}
            placeholder="12"
            keyboardType="numeric"
            testID="recurring-occurrence-count"
          />
        ) : null}
        <Button label={tr(busy ? 'Saving…' : editingRuleId ? 'Save changes' : 'Save recurring entry')} icon={editingRuleId ? 'check' : 'repeat'} onPress={() => void save()} disabled={busy || !online || (kind === 'transfer' && !destinationAccount)} />
      </Card>

      <SectionTitle>{tr('Scheduled')}</SectionTitle>
      {rules.length === 0 ? (
        <Card>
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>{tr('No recurring entries yet')}</Text>
          <Text style={{ color: c.mutedForeground, lineHeight: 20 }}>{tr('Add a bill, income, or transfer above. Future transactions will appear in Activity automatically.')}</Text>
        </Card>
      ) : rules.map((rule) => {
        const template = rule.transactionTemplate;
        const typeIcon = template.kind === 'expense' ? 'arrow-up-right' : template.kind === 'income' ? 'arrow-down-left' : 'repeat';
        const typeColor = template.kind === 'expense' ? c.tint : template.kind === 'income' ? c.primary : c.accentForeground;
        const typeLabel = tr(template.kind === 'expense' ? 'Bill' : template.kind === 'income' ? 'Income' : 'Transfer');
        const assignedUser = state?.users.find((user) => user.id === rule.assignedUserId);
        const frequencyLabel = rule.cadence === 'weekly'
          ? tr('Weekly')
          : rule.intervalMonths === 1 ? tr('Monthly') : `${tr('Every')} ${rule.intervalMonths} ${tr('months')}`;
        const ended = !rule.active && (
          (rule.endCondition === 'occurrences' && rule.remainingOccurrences === 0)
          || (rule.endCondition === 'date' && Boolean(rule.endAt) && rule.nextRunAt.slice(0, 10) > rule.endAt!.slice(0, 10))
        );
        const endingLabel = rule.endCondition === 'date' && rule.endAt
          ? `${tr('Ends')} ${formatDate(rule.endAt, locale)}`
          : rule.endCondition === 'occurrences' && rule.remainingOccurrences !== null
            ? `${rule.remainingOccurrences} ${tr(rule.remainingOccurrences === 1 ? 'entry' : 'entries')} ${tr('remaining')}`
            : null;
        return (
          <Pressable key={rule.id} onPress={() => canManageRule(rule) ? beginEdit(rule) : undefined} disabled={busy || !canManageRule(rule)}>
          <Card style={{ opacity: rule.active ? 1 : 0.65 }}>
            <View style={styles.ruleHeader}>
              <View
                testID={`recurring-type-icon-${rule.id}`}
                accessible
                accessibilityRole="image"
                accessibilityLabel={typeLabel}
                style={[styles.typeIcon, { backgroundColor: template.kind === 'expense' ? c.accent : c.secondary }]}
              >
                <Feather name={typeIcon} size={18} color={typeColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.foreground }]}>{template.note}</Text>
                <Text style={{ color: c.mutedForeground }}>
                  {formatCurrency(template.amountMinor, template.currency, locale)} · {frequencyLabel}
                </Text>
                {template.kind === 'transfer' ? (
                  <Text style={[styles.assignment, { color: c.primary }]}>
                    {state?.accounts.find((item) => item.id === template.accountId)?.name ?? tr('Account')}
                    {' → '}
                    {state?.accounts.find((item) => item.id === template.destinationAccountId)?.name ?? tr('Account')}
                  </Text>
                ) : null}
                {assignedUser ? (
                  <Text style={[styles.assignment, { color: c.primary }]}>
                    {tr(template.kind === 'expense' ? 'Paid by' : 'Received by')} {assignedUser.displayName}
                  </Text>
                ) : null}
                {endingLabel ? <Text style={[styles.ending, { color: c.mutedForeground }]}>{endingLabel}</Text> : null}
                <Text style={[styles.nextDate, { color: c.mutedForeground }]}>
                  {rule.active ? `${tr('Next: ')}${formatDate(rule.nextRunAt, locale)}` : ended ? tr('Ended') : tr('Paused')}
                </Text>
              </View>
              <View style={[styles.statusDot, { backgroundColor: rule.active ? c.primary : c.mutedForeground }]} />
            </View>
            {canManageRule(rule) ? (
              <View style={styles.actions}>
                {!ended ? (
                  <Pressable onPress={(event) => { event.stopPropagation(); toggle(rule.id, !rule.active); }} style={[styles.action, { backgroundColor: c.secondary }]}>
                    <Feather name={rule.active ? 'pause' : 'play'} size={16} color={c.secondaryForeground} />
                    <Text style={{ color: c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{tr(rule.active ? 'Pause' : 'Resume')}</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={(event) => { event.stopPropagation(); confirmDelete(rule.id, template.note); }} style={[styles.action, { backgroundColor: c.secondary }]}>
                  <Feather name="trash-2" size={16} color={c.tint} />
                  <Text style={{ color: c.tint, fontFamily: 'Inter_600SemiBold' }}>{tr('Delete')}</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={{ color: c.mutedForeground, fontSize: 12, marginTop: 14 }}>{tr('Managed by the master user')}</Text>
            )}
          </Card>
          </Pressable>
        );
      })}
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 50, gap: 14 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 30 },
  intro: { lineHeight: 21, marginBottom: 4 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  helper: { fontSize: 13, lineHeight: 18, marginTop: -4, marginBottom: 10 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  frequencyOptions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 20 },
  pill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  customFrequency: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, paddingHorizontal: 10 },
  monthInput: { width: 48, minHeight: 34, borderWidth: 1, borderRadius: 9, paddingHorizontal: 8, textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  emptyTitle: { fontFamily: 'Inter_700Bold', marginBottom: 6 },
  ruleHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  typeIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  ruleTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginBottom: 5 },
  nextDate: { fontSize: 12, marginTop: 5 },
  assignment: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 5 },
  ending: { fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 5 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  action: { flex: 1, minHeight: 42, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  editHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  editTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
});
