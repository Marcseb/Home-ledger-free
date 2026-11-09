import { Feather } from '@expo/vector-icons';
import type { Transaction } from '@workspace/api-client-react';
import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button, Card, Field } from '@/components/Ui';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { defaultPersonalPayerAccountId, isAuditEntry, managedPurchase, pendingLedgerTransactions } from '@/lib/shared-expense';
import { DatePickerCalendar, DatePickerField } from '@/components/DatePicker';
import { useColors } from '@/hooks/useColors';
import { useLedger } from '@/lib/ledger-context';
import { businessDateValue, businessMonth, businessNow } from '@/lib/app-time';
import { isFutureLedgerEntry } from '@/lib/current-balance';
import { projectRecurringForecasts, type RecurringForecast } from '@/lib/recurring-forecast';
import { formatTransactionDate, formatTransactionDateInput, getTransactionDirection, getTransactionOwnerName, parseTransactionDateInput } from '@/lib/transaction-display';
import { sumPostedExpenseAmounts, sumPostedExpenseAmountsByEntryCreator, sumPostedExpenseSharesByMember } from '@/lib/member-spending';
import { formatCurrency, translateLiteral, useI18n } from '@/lib/i18n';

type ActivityItem =
  | { type: 'posted'; id: string; occurredAt: string; transaction: Transaction }
  | { type: 'mirror'; id: string; occurredAt: string; transaction: Transaction; personalAccountId: string }
  | { type: 'scheduled'; id: string; occurredAt: string; forecast: RecurringForecast };

export default function Transactions() {
  const c = useColors();
  const { locale } = useI18n();
  const { state, session, online, outbox, correctTransaction, cancelTransaction } = useLedger();
  const [search, setSearch] = useState('');
  const [activityMonth, setActivityMonth] = useState<string | null>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [monthPickerYear, setMonthPickerYear] = useState<number | null>(null);
  const [scope, setScope] = useState<'shared' | 'personal'>('shared');
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [personalAccountId, setPersonalAccountId] = useState<string | null>(null);
  const [personalMenuOpen, setPersonalMenuOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [showAuditEntries, setShowAuditEntries] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(businessDateValue(state).slice(0, 7));
  const [categoryId, setCategoryId] = useState('');
  const [editingPayerAccountId, setEditingPayerAccountId] = useState<string | null>(null);
  const [payerMenuOpen, setPayerMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const showError = (title: string, message: string) => {
    if (Platform.OS === 'web') globalThis.alert(`${title}\n${message}`);
    else Alert.alert(title, message);
  };
  const accounts = state?.accounts ?? [];
  const users = state?.users ?? [];
  const sharedAccountId = accounts.find((account) => account.kind === 'shared')?.id;
  const personalAccounts = accounts.filter((account) => account.kind === 'personal' && account.ownerUserId === session?.user.id);
  const selectedPersonalAccount = personalAccounts.find((account) => account.id === personalAccountId);
  const selectedMonth = activityMonth ?? businessMonth(state);
  const pickerYear = monthPickerYear ?? Number(selectedMonth.slice(0, 4));
  const monthOptions = Array.from({ length: 12 }, (_, index) => ({
    value: `${pickerYear}-${String(index + 1).padStart(2, '0')}`,
    label: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(pickerYear, index, 1, 12))),
  }));
  const directionAccountId = scope === 'shared' ? sharedAccountId : selectedPersonalAccount?.id;
  const visibleAccountIds = useMemo(
    () => new Set(accounts
      .filter((account) => scope === 'shared'
        ? account.kind === 'shared'
        : account.kind === 'personal' && account.ownerUserId === session?.user.id && (!selectedPersonalAccount || account.id === selectedPersonalAccount.id))
      .map((account) => account.id)),
    [accounts, scope, session?.user.id, selectedPersonalAccount],
  );
  const pendingTransactionIds = useMemo(
    () => new Set(pendingLedgerTransactions(outbox).map((transaction) => transaction.id)),
    [outbox],
  );
  const canManage = (transaction: Transaction) => {
    if (isAuditEntry(transaction)) return false;
    const purchase = managedPurchase(transaction, state?.transactions ?? []);
    if (transaction.linkedExpenseTransactionId && purchase.id === transaction.id) return false;
    if (purchase.fundingTransactionId && purchase.createdByUserId !== session?.user.id) return false;
    if (pendingTransactionIds.has(purchase.id) || purchase.status !== 'posted') return false;
    if (!online || pendingTransactionIds.has(transaction.id) || transaction.status !== 'posted' || transaction.kind === 'reversal' || transaction.reversesTransactionId || !session) return false;
    const ids = [transaction.accountId, transaction.destinationAccountId].filter(Boolean);
    return ids.every((id) => {
      const account = accounts.find((item) => item.id === id);
      return account && (account.kind === 'shared'
        ? session.user.role === 'master' || transaction.createdByUserId === session.user.id
        : account.ownerUserId === session.user.id);
    });
  };
  const categories = useMemo(() => {
    if (!editing || !state) return [];
    const account = accounts.find((item) => item.id === editing.accountId);
    if (editing.kind === 'income') return state.categories.filter((item) => item.id === 'income');
    if (editing.kind === 'transfer') return state.categories.filter((item) => item.id === 'transfer');
    return state.categories.filter((item) => !item.archived && !item.system && item.scope === account?.kind
      && (item.scope === 'shared' || item.ownerUserId === session?.user.id));
  }, [accounts, editing, session?.user.id, state]);
  const openEditor = (transaction: Transaction) => {
    if (!canManage(transaction)) return;
    transaction = managedPurchase(transaction, state?.transactions ?? []);
    setCalendarOpen(false);
    setEditing(transaction);
    setAmount((transaction.amountMinor / 100).toFixed(2));
    setNote(transaction.note);
    setDate(formatTransactionDateInput(transaction.occurredAt));
    setCategoryId(transaction.categoryId);
    setEditingPayerAccountId(transaction.personalPayerAccountId && transaction.personalPayerAccountId !== 'hidden-personal-account'
      ? transaction.personalPayerAccountId
      : !transaction.personalPayerAccountId && transaction.createdByUserId === session?.user.id
        ? defaultPersonalPayerAccountId(transaction, accounts, session.user.id) : null);
    setPayerMenuOpen(false);
  };
  const closeEditor = () => {
    if (calendarOpen) { setCalendarOpen(false); return; }
    if (!busy) { setEditing(null); setPayerMenuOpen(false); }
  };
  const openDatePicker = () => {
    setCalendarMonth((date || businessDateValue(state)).slice(0, 7));
    setCalendarOpen(true);
  };
  const saveCorrection = async () => {
    if (!editing) return;
    const parsed = Number(amount.replace(',', '.'));
    const amountMinor = Math.round(parsed * 100);
    const category = categories.find((item) => item.id === categoryId);
    const occurredAt = parseTransactionDateInput(date);
    const dateUnchanged = date === formatTransactionDateInput(editing.occurredAt);
    const descriptionOnly = amountMinor === editing.amountMinor && categoryId === editing.categoryId && dateUnchanged;
    if (!Number.isFinite(parsed) || parsed <= 0 || (!category && !descriptionOnly) || !note.trim() || !occurredAt) {
      showError(translateLiteral('Check the correction', locale), translateLiteral('Enter an amount, purpose, active category, and a valid date in YYYY-MM-DD format.', locale));
      return;
    }
    setBusy(true);
    try {
      await correctTransaction(editing.id, {
        amountMinor, categoryId: category?.id ?? editing.categoryId, note: note.trim(),
        ...(dateUnchanged ? {} : { occurredAt }),
        ...(editing.kind === 'expense'
          && accounts.find((item) => item.id === editing.accountId)?.kind === 'shared'
          && editing.createdByUserId === session?.user.id
          ? { personalPayerAccountId: editingPayerAccountId }
          : {}),
      });
      setEditing(null);
    } catch (error) {
      showError(translateLiteral('Could not correct activity', locale), error instanceof Error ? error.message : translateLiteral('Try again.', locale));
    } finally { setBusy(false); }
  };
  const confirmCancel = (transaction: Transaction) => {
    const title = translateLiteral('Cancel this activity?', locale);
    const message = translateLiteral(transaction.fundingTransactionId
      ? 'The purchase and its personal funding stay in history and are cancelled together. Both balance effects will be reversed.'
      : 'The original stays in history and is marked cancelled. Its financial effect will be reversed.', locale);
    const commit = () => {
      setBusy(true);
      void cancelTransaction(transaction.id)
        .then(() => setEditing(null))
        .catch((error) => showError(translateLiteral('Could not cancel activity', locale), error instanceof Error ? error.message : translateLiteral('Try again.', locale)))
        .finally(() => setBusy(false));
    };
    if (Platform.OS === 'web') {
      if (globalThis.confirm(`${title}\n${message}`)) commit();
    } else Alert.alert(title, message, [
      { text: translateLiteral('Keep it', locale), style: 'cancel' },
      { text: translateLiteral('Cancel activity', locale), style: 'destructive', onPress: commit },
    ]);
  };
  const transactions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (state?.transactions ?? [])
      .filter((transaction) => showAuditEntries || !isAuditEntry(transaction))
      .filter((transaction) => transaction.occurredAt.slice(0, 7) === selectedMonth)
      .filter((transaction) => [transaction.accountId, transaction.destinationAccountId]
        .some((accountId) => accountId ? visibleAccountIds.has(accountId) : false))
      .filter((transaction) => {
        const owner = getTransactionOwnerName(transaction, accounts, users) ?? '';
        return `${transaction.note} ${transaction.kind} ${owner}`.toLowerCase().includes(query);
      });
  }, [accounts, search, selectedMonth, showAuditEntries, state?.transactions, users, visibleAccountIds]);
  const payerMirrors = useMemo(() => {
    if (scope !== 'personal') return [];
    const selectedIds = new Set(personalAccounts
      .filter((account) => !selectedPersonalAccount || account.id === selectedPersonalAccount.id)
      .map((account) => account.id));
    const query = search.trim().toLowerCase();
    return (state?.transactions ?? [])
      .filter((transaction) => transaction.kind === 'expense' && transaction.status === 'posted')
      .filter((transaction) => transaction.occurredAt.slice(0, 7) === selectedMonth)
      .filter((transaction) => transaction.personalPayerAccountId && selectedIds.has(transaction.personalPayerAccountId))
      .filter((transaction) => {
        const owner = getTransactionOwnerName(transaction, accounts, users) ?? '';
        return `${transaction.note} ${transaction.kind} ${owner}`.toLowerCase().includes(query);
      })
      .map((transaction) => ({
        type: 'mirror' as const,
        id: `payer-mirror:${transaction.id}`,
        occurredAt: transaction.occurredAt,
        transaction,
        personalAccountId: transaction.personalPayerAccountId!,
      }));
  }, [accounts, personalAccounts, search, scope, selectedMonth, selectedPersonalAccount, state?.transactions, users]);
  const postedExpenseTotal = useMemo(() => sumPostedExpenseAmounts(transactions), [transactions]);
  const expenseSharesByMember = useMemo(() => sumPostedExpenseSharesByMember(transactions), [transactions]);
  const expensesByEntryCreator = useMemo(() => sumPostedExpenseAmountsByEntryCreator(transactions), [transactions]);
  const householdShareRows = useMemo(() => {
    const activeUserIds = new Set(users.map((user) => user.id));
    const formerUserIds = [...new Set([...expenseSharesByMember.keys(), ...expensesByEntryCreator.keys()])]
      .filter((userId) => !activeUserIds.has(userId));
    const rows = [
      ...users.map((user) => ({
        id: user.id,
        name: user.displayName,
        shareAmountMinor: expenseSharesByMember.get(user.id) ?? 0,
        enteredAmountMinor: expensesByEntryCreator.get(user.id) ?? 0,
      })),
      ...formerUserIds.map((id, index) => ({
        id,
        name: `${translateLiteral('Former member', locale)}${formerUserIds.length > 1 ? ` ${index + 1}` : ''}`,
        shareAmountMinor: expenseSharesByMember.get(id) ?? 0,
        enteredAmountMinor: expensesByEntryCreator.get(id) ?? 0,
      })),
    ];
    return rows.map((row) => ({
      ...row,
      differenceMinor: row.enteredAmountMinor - row.shareAmountMinor,
    }));
  }, [expenseSharesByMember, expensesByEntryCreator, locale, users]);
  const forecasts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projectRecurringForecasts(state?.recurringRules ?? [], selectedMonth, visibleAccountIds)
      .filter((forecast) => {
        const owner = users.find((user) => user.id === forecast.assignedUserId)?.displayName ?? '';
        return `${forecast.transactionTemplate.note} ${forecast.transactionTemplate.kind} ${owner}`.toLowerCase().includes(query);
      });
  }, [search, selectedMonth, state?.recurringRules, users, visibleAccountIds]);
  const activityItems = useMemo<ActivityItem[]>(() => [
    ...transactions.map((transaction) => ({
      type: 'posted' as const, id: transaction.id, occurredAt: transaction.occurredAt, transaction,
    })),
    ...forecasts.map((forecast) => ({
      type: 'scheduled' as const,
      id: `forecast:${forecast.ruleId}:${forecast.occurredAt}`,
      occurredAt: forecast.occurredAt,
      forecast,
    })),
    ...payerMirrors,
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [forecasts, payerMirrors, transactions]);
  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <Text style={[styles.heading, { color: c.foreground }]}>{translateLiteral('Activity', locale)}</Text>
      <View style={styles.filterRow}>
      <View style={[styles.scopeSection, styles.compactFilterSection, scopeMenuOpen && styles.scopeSectionOpen]}>
        <Text style={[styles.scopeLabel, { color: c.mutedForeground }]}>{translateLiteral('Account view', locale)}</Text>
        <View style={styles.scopePickerContainer}>
          <Pressable
            testID="activity-scope-picker"
            accessibilityRole="button"
            accessibilityLabel={`${translateLiteral('Activity view:', locale)} ${translateLiteral(scope === 'shared' ? 'Shared' : 'Personal', locale)}`}
            accessibilityHint={translateLiteral('Opens the account view menu', locale)}
            onPress={() => {
              setPersonalMenuOpen(false);
              setScopeMenuOpen((open) => !open);
            }}
            style={[styles.scopePicker, styles.compactPicker, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <View style={[styles.scopeIcon, styles.compactScopeIcon, { backgroundColor: c.secondary }]}>
              <Feather name={scope === 'shared' ? 'users' : 'user'} size={16} color={c.primary} />
            </View>
            <Text numberOfLines={1} style={[styles.scopeValue, styles.compactPickerValue, { color: c.foreground }]}>{translateLiteral(scope === 'shared' ? 'Shared' : 'Personal', locale)}</Text>
            <Feather name={scopeMenuOpen ? 'chevron-up' : 'chevron-down'} size={16} color={c.mutedForeground} />
          </Pressable>
          {scopeMenuOpen ? (
            <View style={[styles.scopeMenu, { backgroundColor: c.card, borderColor: c.border }]}>
              {(['shared', 'personal'] as const).map((option) => (
                <Pressable
                  key={option}
                  testID={`activity-scope-${option}`}
                  onPress={() => {
                    setScope(option);
                    if (option === 'shared') setPersonalAccountId(null);
                    setPersonalMenuOpen(false);
                    setScopeMenuOpen(false);
                  }}
                  style={[styles.scopeOption, { borderBottomColor: c.border }]}
                >
                  <Feather name={option === 'shared' ? 'users' : 'user'} size={16} color={option === scope ? c.primary : c.mutedForeground} />
                  <Text style={{ flex: 1, color: c.foreground, fontFamily: option === scope ? 'Inter_700Bold' : 'Inter_500Medium' }}>
                    {translateLiteral(option === 'shared' ? 'Shared' : 'Personal', locale)}
                  </Text>
                  {option === scope ? <Feather name="check" size={16} color={c.primary} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>
      <View style={[styles.monthFilter, styles.compactFilterSection]}>
        <Text style={[styles.scopeLabel, { color: c.mutedForeground }]}>{translateLiteral('Month', locale)}</Text>
        <Pressable
          testID="activity-month-picker"
          accessibilityRole="button"
          accessibilityLabel={`${translateLiteral('Choose month', locale)}: ${selectedMonth.replace('-', ' / ')}`}
          accessibilityHint={translateLiteral('Choose a year and month to filter activity.', locale)}
          onPress={() => {
            setMonthPickerYear(Number(selectedMonth.slice(0, 4)));
            setMonthPickerOpen(true);
          }}
          style={[styles.monthPickerButton, styles.compactPicker, { backgroundColor: c.card, borderColor: c.border }]}
        >
          <Feather name="calendar" size={17} color={c.primary} />
          <Text numberOfLines={1} style={[styles.monthPickerValue, styles.compactPickerValue, { color: c.foreground }]}>{selectedMonth.replace('-', ' / ')}</Text>
          <Feather name="chevron-down" size={16} color={c.mutedForeground} />
        </Pressable>
      </View>
      </View>
      {scope === 'personal' ? (
        <View style={[styles.scopeSection, personalMenuOpen && styles.scopeSectionOpen]}>
          <Text style={[styles.scopeLabel, { color: c.mutedForeground }]}>{translateLiteral('Personal account', locale)}</Text>
          <View style={styles.scopePickerContainer}>
            <Pressable testID="activity-personal-account-picker" onPress={() => {
              setScopeMenuOpen(false);
              setPersonalMenuOpen((open) => !open);
            }} style={[styles.scopePicker, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={[styles.scopeIcon, { backgroundColor: c.secondary }]}><Feather name={selectedPersonalAccount?.role === 'savings' ? 'archive' : 'user'} size={16} color={c.primary} /></View>
              <Text style={[styles.scopeValue, { color: c.foreground }]}>{selectedPersonalAccount?.name ?? translateLiteral('All personal accounts', locale)}</Text>
              <Feather name={personalMenuOpen ? 'chevron-up' : 'chevron-down'} size={18} color={c.mutedForeground} />
            </Pressable>
            {personalMenuOpen ? <View style={[styles.scopeMenu, { backgroundColor: c.card, borderColor: c.border }]}>
               <Pressable testID="activity-personal-all" onPress={() => { setPersonalAccountId(null); setPersonalMenuOpen(false); }} style={[styles.scopeOption, { borderBottomColor: c.border }]}><Feather name="layers" size={16} color={!selectedPersonalAccount ? c.primary : c.mutedForeground} /><Text style={{ flex: 1, color: c.foreground, fontFamily: !selectedPersonalAccount ? 'Inter_700Bold' : 'Inter_500Medium' }}>{translateLiteral('All personal accounts', locale)}</Text></Pressable>
              {personalAccounts.map((account) => <Pressable key={account.id} testID={`activity-personal-${account.id}`} onPress={() => { setPersonalAccountId(account.id); setPersonalMenuOpen(false); }} style={[styles.scopeOption, { borderBottomColor: c.border }]}><Feather name={account.role === 'savings' ? 'archive' : 'user'} size={16} color={account.id === personalAccountId ? c.primary : c.mutedForeground} /><Text style={{ flex: 1, color: c.foreground, fontFamily: account.id === personalAccountId ? 'Inter_700Bold' : 'Inter_500Medium' }}>{account.name}{account.archived ? ` · ${translateLiteral('Archived', locale)}` : ''}</Text></Pressable>)}
            </View> : null}
          </View>
        </View>
      ) : null}
      <View style={[styles.search, styles.compactSearch, { backgroundColor: c.card, borderColor: c.border }]}>
        <Feather name="search" size={18} color={c.mutedForeground} />
        <TextInput testID="transaction-search" value={search} onChangeText={setSearch} placeholder={translateLiteral('Search transactions', locale)} placeholderTextColor={c.mutedForeground} style={{ flex: 1, color: c.foreground, fontFamily: 'Inter_400Regular' }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.foreground, fontSize: 12 }}>{translateLiteral('Show audit entries', locale)}</Text>
          <Text style={{ color: c.mutedForeground, fontSize: 10 }}>{translateLiteral('Visibility only — balances stay unchanged.', locale)}</Text>
        </View>
        <Switch testID="show-audit-entries" value={showAuditEntries} onValueChange={setShowAuditEntries}
          accessibilityLabel={translateLiteral('Show audit entries', locale)} trackColor={{ true: c.primary }} />
      </View>
      <FlatList
        data={activityItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 10, paddingBottom: 110 }}
         ListEmptyComponent={<Card><Text style={[styles.emptyTitle, { color: c.foreground }]}>{translateLiteral(search.trim() ? 'No matching activity' : 'No activity for this month', locale)}</Text><Text style={{ color: c.mutedForeground }}>{translateLiteral(search.trim() ? 'Your activity will appear here as you add transactions.' : 'Try another month or account view.', locale)}</Text></Card>}
         ListFooterComponent={
           <Card style={styles.summaryCard}>
             <View style={styles.summaryRow}>
               <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>{translateLiteral('Posted expenses', locale)}</Text>
               <Text testID="activity-summary-total" style={[styles.summaryAmount, { color: c.foreground }]}>
                 {formatCurrency(postedExpenseTotal, state?.baseCurrency ?? 'USD', locale)}
               </Text>
             </View>
             {scope === 'shared' ? (
               <>
                 <View style={[styles.summaryDivider, { borderColor: c.border }]} />
                 <Text style={[styles.summaryHeading, { color: c.foreground }]}>{translateLiteral('Household shares', locale)}</Text>
                 {householdShareRows.map((row) => (
                   <View key={row.id} style={styles.summaryMemberRow}>
                     <View style={styles.summaryMemberDetails}>
                       <Text numberOfLines={1} style={[styles.summaryMember, { color: c.foreground }]}>{row.name}</Text>
                       <Text style={[styles.summaryMemberShare, { color: c.mutedForeground }]}>
                         {translateLiteral('Share', locale)} · {formatCurrency(row.shareAmountMinor, state?.baseCurrency ?? 'USD', locale)}
                       </Text>
                     </View>
                   <Text
                     testID={`activity-summary-difference-${row.id}`}
                     style={[styles.summaryDifference, {
                       color: row.differenceMinor > 0 ? c.tint : row.differenceMinor < 0 ? c.primary : c.mutedForeground,
                     }]}
                   >
                     {row.differenceMinor === 0
                       ? `${formatCurrency(0, state?.baseCurrency ?? 'USD', locale)} ${translateLiteral('On share', locale)}`
                       : `${row.differenceMinor > 0 ? '+' : '−'}${formatCurrency(Math.abs(row.differenceMinor), state?.baseCurrency ?? 'USD', locale)} ${translateLiteral(row.differenceMinor > 0 ? 'Above share' : 'Below share', locale)}`}
                   </Text>
                   </View>
                 ))}
               </>
             ) : null}
             <Text style={[styles.summaryHint, { color: c.mutedForeground }]}>
               {translateLiteral('Totals follow the filters above. Scheduled and cancelled entries are excluded.', locale)}
             </Text>
           </Card>
         }
         renderItem={({ item: entry }) => {
           if (entry.type === 'scheduled') {
             const { forecast } = entry;
             const item = forecast.transactionTemplate;
             const internalPersonalTransfer = scope === 'personal' && !selectedPersonalAccount && item.kind === 'transfer'
               && Boolean(item.destinationAccountId)
               && visibleAccountIds.has(item.accountId)
               && visibleAccountIds.has(item.destinationAccountId!);
             const outgoing = !internalPersonalTransfer && (item.kind === 'expense'
               || (item.kind === 'transfer' && item.destinationAccountId !== directionAccountId));
             const owner = users.find((user) => user.id === forecast.assignedUserId)?.displayName;
             return <Card style={styles.row}>
               <View style={[styles.icon, { backgroundColor: c.secondary }]}><Feather name="clock" size={17} color={c.primary} /></View>
               <View style={{ flex: 1 }}>
                 <Text style={[styles.note, { color: c.foreground }]}>{item.note}</Text>
                 <View style={styles.dateLine}><Feather name="calendar" size={12} color={c.mutedForeground} /><Text style={{ color: c.mutedForeground, fontSize: 12 }}>{owner ? `${owner} · ` : ''}{formatTransactionDate(forecast.occurredAt, locale)}</Text></View>
                 <View style={[styles.forecastBadge, { backgroundColor: c.secondary }]}>
                   <Text style={{ color: c.primary, fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>{translateLiteral('Scheduled (not posted)', locale)}</Text>
                 </View>
               </View>
               <Text style={[styles.amount, { color: c.mutedForeground }]}>{internalPersonalTransfer ? '↔ ' : outgoing ? '-' : '+'}{formatCurrency(item.amountMinor, item.currency, locale)}</Text>
             </Card>;
           }
            if (entry.type === 'mirror') {
              const item = entry.transaction;
               return <View testID={`personal-payer-mirror-${item.id}`}>
               <Card style={styles.row}>
                <View style={[styles.icon, { backgroundColor: c.accent }]}><Feather name="arrow-up-right" size={17} color={c.tint} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.note, { color: c.foreground }]}>{item.note}</Text>
                  <View style={styles.dateLine}><Feather name="calendar" size={12} color={c.mutedForeground} /><Text style={{ color: c.mutedForeground, fontSize: 12 }}>{formatTransactionDate(item.occurredAt, locale)}</Text></View>
                  <Text style={[styles.status, { color: c.mutedForeground }]}>{translateLiteral('Shared purchase · estimate only', locale)}</Text>
                </View>
                <Text style={[styles.amount, { color: c.tint }]}>−{formatCurrency(item.amountMinor, state?.baseCurrency ?? 'USD', locale)}</Text>
               </Card>
               </View>;
            }
           const item = entry.transaction;
           const internalPersonalTransfer = scope === 'personal' && !selectedPersonalAccount && item.kind === 'transfer'
             && Boolean(item.destinationAccountId)
             && personalAccounts.some((account) => account.id === item.accountId)
             && personalAccounts.some((account) => account.id === item.destinationAccountId);
           const outgoing = !internalPersonalTransfer && getTransactionDirection(item, directionAccountId, state?.transactions ?? []) === 'out';
          const owner = getTransactionOwnerName(item, accounts, users);
          const cancelled = item.status === 'reversed';
          return <Pressable disabled={!canManage(item)} onPress={() => openEditor(item)}>
            <Card style={[styles.row, cancelled && { opacity: 0.58 }]}>
              <View style={[styles.icon, { backgroundColor: outgoing ? c.accent : c.secondary }]}><Feather name={item.kind === 'transfer' ? 'repeat' : outgoing ? 'arrow-up-right' : 'arrow-down-left'} size={17} color={outgoing ? c.tint : c.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.note, { color: c.foreground }]}>{item.note}</Text>
                 <View style={styles.dateLine}><Feather name="calendar" size={12} color={c.mutedForeground} /><Text style={{ color: c.mutedForeground, fontSize: 12 }}>{owner ? `${owner} · ` : ''}{formatTransactionDate(item.occurredAt)}</Text></View>
                 {isAuditEntry(item) ? <Text style={[styles.status, { color: c.mutedForeground }]} testID={`audit-entry-${item.id}`}>
                   {translateLiteral('Audit entry — read-only', locale)}
                   {item.auditRelatedTransactionId ? ` · ${state?.transactions.find((tx) => tx.id === item.auditRelatedTransactionId)?.note ?? item.auditRelatedTransactionId}` : ''}
                 </Text> : null}
                 {!isAuditEntry(item) && (item.fundingTransactionId || item.linkedExpenseTransactionId) ? <Text style={[styles.status, { color: c.mutedForeground }]}>
                   {translateLiteral(item.linkedExpenseTransactionId ? 'Shared purchase · paid personally' : 'Paid personally', locale)}
                 </Text> : null}
                {cancelled ? <Text style={[styles.status, { color: c.tint }]}>{translateLiteral('Cancelled / reversed', locale)}</Text> : null}
                {!cancelled && isFutureLedgerEntry(item.occurredAt, businessNow(state)) ? <Text style={[styles.status, { color: c.mutedForeground }]}>{translateLiteral('Future-dated · not in current balances yet', locale)}</Text> : null}
                {pendingTransactionIds.has(item.id) ? <Text style={[styles.status, { color: c.mutedForeground }]}>{translateLiteral('Syncing before it can be edited', locale)}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 5 }}>
               <Text style={[styles.amount, { color: internalPersonalTransfer ? c.primary : outgoing ? c.tint : c.primary }]}>{internalPersonalTransfer ? '↔ ' : outgoing ? '-' : '+'}{formatCurrency(item.amountMinor, state?.baseCurrency ?? 'USD', locale)}</Text>
                {canManage(item) ? <Pressable onPress={() => openEditor(item)} hitSlop={8}><Feather name="edit-2" size={15} color={c.mutedForeground} /></Pressable> : null}
              </View>
            </Card>
          </Pressable>;
        }}
      />
      <Modal visible={Boolean(editing)} transparent animationType="slide" onRequestClose={closeEditor}>
        {calendarOpen ? <DatePickerCalendar
          month={calendarMonth}
          selectedDate={date}
          today={businessDateValue(state)}
          onMonthChange={setCalendarMonth}
          onClose={() => setCalendarOpen(false)}
          onSelect={(value) => { setDate(value); setCalendarOpen(false); }}
        /> : <View style={styles.modalBackdrop}><View style={[styles.modal, { backgroundColor: c.card }]}>
          <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: c.foreground }]}>{translateLiteral('Correct activity', locale)}</Text><Pressable onPress={closeEditor}><Feather name="x" size={22} color={c.mutedForeground} /></Pressable></View>
           <KeyboardAwareScrollViewCompat keyboardShouldPersistTaps="handled" bottomOffset={20}>
           <Text style={[styles.helper, { color: c.mutedForeground }]}>{translateLiteral('Description-only edits keep this entry and are audited. Other changes create an audited replacement.', locale)}</Text>
          <Text style={[styles.label, { color: c.mutedForeground }]}>{translateLiteral('Category', locale)}</Text>
          <View style={styles.categoryWrap}>{categories.map((item) => <Pressable key={item.id} onPress={() => setCategoryId(item.id)} style={[styles.categoryPill, { backgroundColor: item.id === categoryId ? c.primary : c.secondary }]}><Text style={{ color: item.id === categoryId ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{item.name}</Text></Pressable>)}</View>
          <Field label={translateLiteral('Amount', locale)} value={amount} onChangeText={setAmount} keyboardType="numeric" />
          <Field label={translateLiteral('Purpose', locale)} value={note} onChangeText={setNote} />
           {editing?.kind === 'expense'
             && accounts.find((item) => item.id === editing.accountId)?.kind === 'shared'
             && editing.createdByUserId === session?.user.id ? (
             <View style={{ marginBottom: 14 }}>
               <Text style={[styles.label, { color: c.mutedForeground }]}>{translateLiteral('Paid personally', locale)}</Text>
               <Pressable
                 testID="edit-personal-payer"
                 accessibilityRole="button"
                 accessibilityState={{ expanded: payerMenuOpen }}
                 onPress={() => setPayerMenuOpen((open) => !open)}
                 style={[styles.monthPickerButton, { backgroundColor: c.card, borderColor: c.border }]}
               >
                 <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontFamily: 'Inter_500Medium' }}>
                   {personalAccounts.find((account) => account.id === editingPayerAccountId)?.name ?? translateLiteral('Not recorded', locale)}
                 </Text>
                 <Feather name={payerMenuOpen ? 'chevron-up' : 'chevron-down'} size={16} color={c.mutedForeground} />
               </Pressable>
               {payerMenuOpen ? <View style={[styles.scopeMenu, { position: 'relative', top: 0, left: 0, right: 0, marginTop: 6, backgroundColor: c.card, borderColor: c.border }]}>
                 {[{ id: null, label: translateLiteral('Not recorded', locale) }, ...personalAccounts.filter((account) => !account.archived).map((account) => ({ id: account.id, label: account.name }))].map((option) => (
                   <Pressable key={option.id ?? 'none'} onPress={() => { setEditingPayerAccountId(option.id); setPayerMenuOpen(false); }} style={[styles.scopeOption, { borderBottomColor: c.border }]}>
                     <Text style={{ flex: 1, color: c.foreground }}>{option.label}</Text>
                     {option.id === editingPayerAccountId ? <Feather name="check" size={16} color={c.primary} /> : null}
                   </Pressable>
                 ))}
               </View> : null}
               <Text style={[styles.helper, { color: c.mutedForeground, marginTop: 5 }]}>{translateLiteral('For the bank estimate only', locale)}</Text>
             </View>
           ) : null}
            <DatePickerField value={date} onPress={openDatePicker} testID="activity-date" />
           <Button label={busy ? translateLiteral('Saving…', locale) : translateLiteral('Save correction', locale)} icon="check" onPress={() => void saveCorrection()} disabled={busy} />
           <Button label={translateLiteral('Cancel activity', locale)} icon="slash" secondary onPress={() => editing && confirmCancel(editing)} disabled={busy} />
           </KeyboardAwareScrollViewCompat>
         </View></View>}
      </Modal>
      <Modal visible={monthPickerOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setMonthPickerOpen(false)}>
        <View style={styles.monthPickerBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={translateLiteral('Close month picker', locale)}
            onPress={() => setMonthPickerOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View accessibilityViewIsModal style={[styles.monthPickerModal, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: c.foreground }]}>{translateLiteral('Choose month', locale)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={translateLiteral('Close month picker', locale)} onPress={() => setMonthPickerOpen(false)} hitSlop={8}>
                <Feather name="x" size={22} color={c.mutedForeground} />
              </Pressable>
            </View>
            <View style={styles.monthYearRow}>
              <Pressable
                testID="activity-month-previous-year"
                accessibilityRole="button"
                accessibilityLabel={translateLiteral('Previous year', locale)}
                onPress={() => setMonthPickerYear(Math.max(1, pickerYear - 1))}
                style={[styles.monthYearButton, { backgroundColor: c.secondary }]}
              >
                <Feather name="chevron-left" size={18} color={c.secondaryForeground} />
              </Pressable>
              <Text accessibilityRole="header" style={[styles.monthYearValue, { color: c.foreground }]}>{pickerYear}</Text>
              <Pressable
                testID="activity-month-next-year"
                accessibilityRole="button"
                accessibilityLabel={translateLiteral('Next year', locale)}
                onPress={() => setMonthPickerYear(Math.min(9999, pickerYear + 1))}
                style={[styles.monthYearButton, { backgroundColor: c.secondary }]}
              >
                <Feather name="chevron-right" size={18} color={c.secondaryForeground} />
              </Pressable>
            </View>
            <View style={styles.monthOptions}>
              {monthOptions.map((option) => {
                const selected = option.value === selectedMonth;
                return (
                  <Pressable
                    key={option.value}
                    testID={`activity-month-${option.value}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.label} ${pickerYear}`}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setActivityMonth(option.value);
                      setMonthPickerOpen(false);
                    }}
                    style={[styles.monthOption, { backgroundColor: selected ? c.primary : c.secondary }]}
                  >
                    <Text style={{ color: selected ? c.primaryForeground : c.secondaryForeground, fontFamily: selected ? 'Inter_700Bold' : 'Inter_500Medium' }}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[styles.monthPickerFooter, { borderTopColor: c.border }]}>
              <Pressable
                testID="activity-month-current"
                accessibilityRole="button"
                onPress={() => {
                  setActivityMonth(null);
                  setMonthPickerYear(null);
                  setMonthPickerOpen(false);
                }}
                style={[styles.monthCurrentButton, { backgroundColor: c.secondary }]}
              >
                <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold' }}>{translateLiteral('This month', locale)}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18, paddingTop: 20 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 30, marginBottom: 15 },
  filterRow: { flexDirection: 'row', gap: 10, marginBottom: 10, zIndex: 20, elevation: 8 },
  compactFilterSection: { flex: 1, minWidth: 0, marginBottom: 0 },
  compactPicker: { minHeight: 44, paddingHorizontal: 9, gap: 7 },
  compactPickerValue: { fontSize: 14 },
  compactScopeIcon: { width: 28, height: 28, borderRadius: 9 },
  compactSearch: { marginBottom: 10 },
  scopeSection: { zIndex: 10, elevation: 4, marginBottom: 12 },
  scopeSectionOpen: { zIndex: 30, elevation: 20 },
  scopeLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 7 },
  scopePickerContainer: { position: 'relative' },
  scopePicker: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  scopeIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  scopeValue: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  scopeMenu: { position: 'absolute', top: 52, left: 0, right: 0, borderWidth: 1, borderRadius: 13, overflow: 'hidden', zIndex: 20, elevation: 8 },
  scopeOption: { minHeight: 48, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  monthFilter: { marginBottom: 12 },
  monthPickerButton: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
  monthPickerValue: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  monthPickerBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 18, backgroundColor: 'rgba(0,0,0,0.36)' },
  monthPickerModal: { width: '100%', maxWidth: 360, borderWidth: 1, borderRadius: 22, padding: 18, gap: 14 },
  monthYearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthYearButton: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  monthYearValue: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  monthOptions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  monthOption: { width: '31%', minHeight: 42, paddingHorizontal: 5, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  monthPickerFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, alignItems: 'center' },
  monthCurrentButton: { minHeight: 40, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  search: { height: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  summaryCard: { marginTop: 4, gap: 10 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  summaryLabel: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  summaryAmount: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  summaryDivider: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 2 },
  summaryHeading: { fontFamily: 'Inter_700Bold', fontSize: 13, marginBottom: 2 },
  summaryMemberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  summaryMemberDetails: { flex: 1, gap: 3 },
  summaryMember: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  summaryMemberShare: { fontSize: 11 },
  summaryDifference: { maxWidth: '62%', textAlign: 'right', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  summaryHint: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  icon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  note: { fontFamily: 'Inter_600SemiBold', fontSize: 15, marginBottom: 4, textTransform: 'capitalize' },
  dateLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  amount: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  status: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 5 },
  forecastBadge: { alignSelf: 'flex-start', marginTop: 7, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginBottom: 5 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.32)' },
  modal: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12, maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  helper: { lineHeight: 19 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  categoryWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryPill: { borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 },
});