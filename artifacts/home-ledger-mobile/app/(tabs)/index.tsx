import { Feather } from '@expo/vector-icons';
import { Link } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useLedger } from '@/lib/ledger-context';
import { buildSavingsOverview } from '@/lib/savings-overview';
import { formatTransactionDate, getTransactionDirection, getTransactionOwnerName } from '@/lib/transaction-display';
import { Card, SectionTitle } from '@/components/Ui';
import { BalanceHistoryCard } from '@/components/BalanceHistoryCard';
import { CategorySpendingBudgetCard } from '@/components/CategorySpendingBudgetCard';
import { SavingsOverviewCard } from '@/components/SavingsOverviewCard';
import { BackupAttention } from '@/components/BackupAttention';
import { categorySpendingBudgetRows } from '@/lib/category-spending-budget';
import { SharedMonthlyCard } from '@/components/SharedMonthlyCard';
import { pendingLedgerTransactions } from '@/lib/shared-expense';
import { sharedGoalMonthlySummary } from '@/lib/shared-monthly-summary';
import { businessMonth, businessNow } from '@/lib/app-time';
import { balanceWithPendingEntries } from '@/lib/current-balance';
import { personalBankEstimate } from '@/lib/personal-bank-estimate';
import { sumPostedExpenseAmounts, sumPostedExpenseAmountsByEntryCreator, sumPostedExpenseSharesByMember } from '@/lib/member-spending';
import { isSharedIncomeInflow, sumSharedIncomeByMember } from '@/lib/member-income';
import { formatCurrency, translateLiteral, useI18n } from '@/lib/i18n';
export default function Dashboard() {
  const c = useColors(); const insets = useSafeAreaInsets(); const { locale } = useI18n(); const tr = (value: string) => translateLiteral(value, locale); const { state, session, dashboard, outbox, online, sync, discoveringServer, discoveryMessage, dashboardPersonalAccountId: personalAccountId } = useLedger(); const [shared, setShared] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [showBalanceDetails, setShowBalanceDetails] = useState(false);
  const [showBankEstimate, setShowBankEstimate] = useState(false);
  const [showAllBalanceAccounts, setShowAllBalanceAccounts] = useState(false);
  const money = (minor: number) => formatCurrency(minor, state?.baseCurrency ?? 'USD', locale);
  const personalAccounts = useMemo(() => state?.accounts.filter((a) => a.kind === 'personal' && a.ownerUserId === session?.user.id) ?? [], [session?.user.id, state?.accounts]);
  const selectedPersonalAccount = personalAccounts.find((a) => a.id === personalAccountId && !a.archived);
  const aggregatePersonal = !shared && !selectedPersonalAccount;
  const account = useMemo(() => shared ? state?.accounts.find((a) => a.kind === 'shared') : selectedPersonalAccount ?? personalAccounts.find((a) => a.role === 'main'), [personalAccounts, selectedPersonalAccount, shared, state?.accounts]);
  const balanceAccounts = useMemo(() => {
    const scopedAccounts = shared
      ? state?.accounts.filter((a) => a.kind === 'shared') ?? []
      : selectedPersonalAccount ? [selectedPersonalAccount] : personalAccounts;
    return [...scopedAccounts].sort((a, b) => {
      const aOrder = a.kind === 'shared' || a.role === 'main' ? 0 : 1;
      const bOrder = b.kind === 'shared' || b.role === 'main' ? 0 : 1;
      return Number(a.archived) - Number(b.archived) || aOrder - bOrder || a.name.localeCompare(b.name);
    });
  }, [personalAccounts, selectedPersonalAccount, shared, state?.accounts]);
  const visibleAccountIds = useMemo(() => shared ? new Set(state?.accounts.filter((a) => a.kind === 'shared').map((a) => a.id)) : selectedPersonalAccount ? new Set([selectedPersonalAccount.id]) : new Set(personalAccounts.map((a) => a.id)), [personalAccounts, selectedPersonalAccount, shared, state?.accounts]);
  const serverTransactions = state?.transactions ?? [];
  const pendingTransactions = pendingLedgerTransactions(outbox);
  const historyTransactions = useMemo(() => {
    const pendingIds = new Set(pendingLedgerTransactions(outbox).map((transaction) => transaction.id));
    return serverTransactions.filter((transaction) => !pendingIds.has(transaction.id));
  }, [outbox, serverTransactions]);
  const historyAccounts = useMemo(() => balanceAccounts.map((item) => ({
    id: item.id,
    name: item.name,
    balanceMinor: item.balanceMinor ?? dashboard?.accountBalances.find((entry) => entry.accountId === item.id)?.balanceMinor,
  })), [balanceAccounts, dashboard?.accountBalances]);
  const localBalance = (accountId: string) => {
    const account = state?.accounts.find((item) => item.id === accountId);
    const authoritative = account?.balanceMinor ?? (dashboard?.accountBalances.find((item) => item.accountId === accountId)?.balanceMinor ?? 0);
    return balanceWithPendingEntries(authoritative, accountId, pendingTransactions, businessNow(state));
  };
  const balanceItems = balanceAccounts.map((account) => ({ account, balanceMinor: localBalance(account.id) }));
  const maxAbsAccountBalance = Math.max(1, ...balanceItems.map((item) => Math.abs(item.balanceMinor)));
  const hasNegativeAccountBalance = balanceItems.some((item) => item.balanceMinor < 0);
  const balance = shared && !state?.accounts
    ? dashboard?.sharedBalanceMinor ?? 0
    : balanceItems.reduce((sum, item) => sum + item.balanceMinor, 0);
  const allPersonal = !shared && !selectedPersonalAccount;
  const bankEstimate = personalBankEstimate({
    accounts: balanceItems.map(({ account, balanceMinor }) => ({ id: account.id, balanceMinor })),
    sharedAccountIds: new Set((state?.accounts ?? []).filter((item) => item.kind === 'shared').map((item) => item.id)),
    transactions: state?.transactions ?? [],
    asOfDate: businessNow(state).toISOString().slice(0, 10),
  });
  const hasBankEstimate = !shared && (bankEstimate.allocationsMinor > 0 || bankEstimate.sharedPurchasesMinor > 0);
  const visibleTransactions = useMemo(() => {
    const transactions = state?.transactions ?? [];
    return transactions
      .filter((tx) => [tx.accountId, tx.destinationAccountId].some((id) => id ? visibleAccountIds.has(id) : false))
      .filter((tx) => !(aggregatePersonal
        && tx.kind === 'transfer'
        && visibleAccountIds.has(tx.accountId)
        && tx.destinationAccountId
        && visibleAccountIds.has(tx.destinationAccountId)));
  }, [aggregatePersonal, state?.transactions, visibleAccountIds]);
  const recent = visibleTransactions.filter((transaction) => !shared || !transaction.linkedExpenseTransactionId).slice(0, 4);
  const currentMonth = businessMonth(state);
  const monthTransactions = useMemo(() => visibleTransactions.filter((tx) => tx.occurredAt.startsWith(currentMonth) && tx.status === 'posted'
    && tx.occurredAt.slice(0, 10) <= businessNow(state).toISOString().slice(0, 10)), [currentMonth, state, visibleTransactions]);
  const monthInflows = useMemo(() => monthTransactions.filter((tx) => {
    return shared ? isSharedIncomeInflow(tx, visibleAccountIds) : tx.kind === 'income';
  }), [monthTransactions, shared, visibleAccountIds]);
  const monthIncomeMinor = monthInflows.reduce((sum, tx) => sum + tx.amountMinor, 0);
  const incomeBreakdown = useMemo(() => {
    const amounts = shared ? sumSharedIncomeByMember(monthInflows, visibleAccountIds) : new Map<string, number>();
    return (state?.users ?? []).map((user) => ({ user, amountMinor: amounts.get(user.id) ?? 0 }));
  }, [monthInflows, shared, state?.users, visibleAccountIds]);
   const monthExpenseMinor = sumPostedExpenseAmounts(monthTransactions.filter((tx) => !(allPersonal && tx.kind === 'transfer' && tx.destinationAccountId && visibleAccountIds.has(tx.accountId) && visibleAccountIds.has(tx.destinationAccountId))));
  const expenseByShare = useMemo(() => {
    const users = state?.users ?? [];
     const shares = shared ? sumPostedExpenseSharesByMember(monthTransactions) : new Map<string, number>();
     const enteredAmounts = shared ? sumPostedExpenseAmountsByEntryCreator(monthTransactions) : new Map<string, number>();
    const activeIds = new Set(users.map((user) => user.id));
    const formerIds = [...new Set([...shares.keys(), ...enteredAmounts.keys()])].filter((id) => !activeIds.has(id));
    const amountsFor = (userId: string) => ({
      shareAmountMinor: shares.get(userId) ?? 0,
      enteredAmountMinor: enteredAmounts.get(userId) ?? 0,
    });
    return [
      ...users.map((user) => ({ user, ...amountsFor(user.id) })),
      ...formerIds.map((id, index) => ({
        user: { id, displayName: `${translateLiteral('Former member', locale)}${formerIds.length > 1 ? ` ${index + 1}` : ''}` },
        ...amountsFor(id),
      })),
    ];
  }, [locale, monthTransactions, shared, state?.users]);
  const categoryTotals = useMemo(() => categorySpendingBudgetRows(
    state?.categories ?? [], monthTransactions, state?.budgets ?? [], currentMonth, shared, session?.user.id,
  ), [currentMonth, monthTransactions, session?.user.id, shared, state?.budgets, state?.categories]);
  const selectedCategory = categoryTotals.find((category) => category.categoryId === selectedCategoryId);
  const monthlyBudgetMinor = categoryTotals.reduce((sum, item) => sum + (item.budget ? Math.max(0, item.budget.limitMinor + item.budget.rolloverMinor) : 0), 0);
  const sharedGoalSummary = sharedGoalMonthlySummary(state?.savingsGoals ?? [], businessNow(state));
  const categoryEntries = selectedCategory
    ? monthTransactions.filter((tx) => tx.kind === 'expense' && tx.categoryId === selectedCategory.categoryId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    : [];
  const savingsOverview = useMemo(() => buildSavingsOverview({
    goals: state?.savingsGoals ?? [],
    transactions: state?.transactions ?? [],
    accountIds: visibleAccountIds,
    shared,
    ownerUserId: session?.user.id,
    selectedAccountId: shared ? undefined : selectedPersonalAccount?.id,
    month: currentMonth,
  }), [currentMonth, selectedPersonalAccount?.id, session?.user.id, shared, state?.savingsGoals, state?.transactions, visibleAccountIds]);
   return <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={() => { void sync(); }} tintColor={c.primary} />}>
     <View style={styles.greeting}><View><Text style={[styles.kicker, { color: c.primary }]}>{tr('HOME LEDGER')}</Text><Text style={[styles.title, { color: c.foreground }]}>{tr('Good morning, ')}{session?.user.displayName ?? tr('there')}{tr('.')}</Text></View><View style={[styles.sync, { backgroundColor: online ? c.secondary : c.accent }]}><View style={[styles.syncDot, { backgroundColor: online ? c.primary : c.tint }]} /><Text style={{ color: online ? c.primary : c.tint, fontFamily: 'Inter_600SemiBold', fontSize: 11 }}>{tr(online ? 'SYNCED' : 'OFFLINE')}</Text></View></View>
      {!online || outbox.length > 0 ? <View testID="connection-status" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{tr(online ? 'Connected · changes pending' : outbox.length ? 'Offline · changes pending' : 'Offline · retrying automatically')}{outbox.length ? ` (${outbox.length})` : ''}</Text>
          {!online ? <Text accessibilityLiveRegion="polite" style={{ color: c.mutedForeground, fontSize: 12 }}>{tr(discoveringServer ? 'Finding your server on Wi-Fi…' : discoveryMessage || 'Server unreachable. Check Wi-Fi and the server address.')}</Text> : null}
          {!online && discoveryMessage.includes('Choose one in Settings') ? <Link href="/(tabs)/settings" style={{ color: c.primary, fontSize: 12 }}>{tr('Choose server')}</Link> : null}
        </View>
        <Pressable testID="retry-connection" accessibilityRole="button" disabled={discoveringServer} onPress={() => { void sync(true); }} style={{ paddingVertical: 12 }}>
          <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold' }}>{tr('Retry now')}</Text>
        </Pressable>
      </View> : null}
      <BackupAttention />
     <View style={styles.switcher}><SwitchButton active={shared} label={tr('Shared household')} icon="users" onPress={() => { setSelectedCategoryId(null); setShowBankEstimate(false); setShared(true); }} /><SwitchButton active={!shared} label={tr('Personal')} icon="user" onPress={() => { setSelectedCategoryId(null); setShared(false); }} /></View><BudgetAlertBanner shared={shared} userId={session?.user.id} />
      {shared ? <SharedMonthlyCard balanceMinor={balance} expenseMinor={monthExpenseMinor} budgetMinor={monthlyBudgetMinor}
        contributionMinor={sharedGoalSummary.contributionMinor} planMinor={sharedGoalSummary.planMinor}
        currency={state?.baseCurrency ?? 'USD'} month={currentMonth} expanded={showBalanceDetails}
        onPress={() => setShowBalanceDetails((visible) => !visible)} /> : <Pressable
        testID="toggle-balances-by-account"
        accessibilityRole="button"
        accessibilityLabel={`${tr('Available balance')}: ${money(balance)}`}
        accessibilityHint={tr(showBalanceDetails ? 'Tap card to return' : 'Tap for balances and history')}
        accessibilityState={{ expanded: showBalanceDetails }}
        onPress={() => setShowBalanceDetails((visible) => !visible)}
        style={[styles.balanceCard, { backgroundColor: c.primary, justifyContent: 'flex-start' }]}
      >
        <Text style={{ color: c.primaryForeground, opacity: 0.76, fontFamily: 'Inter_500Medium' }}>
          {shared ? tr('Shared total') : selectedPersonalAccount?.name ?? tr('Personal total')}
        </Text>
        <Text style={[styles.balance, { color: c.primaryForeground }]}>{money(balance)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Text style={{ color: c.primaryForeground, opacity: 0.75 }}>{tr('Available balance')} · {state?.baseCurrency}</Text>
          <Feather name={showBalanceDetails ? 'chevron-up' : 'chevron-down'} size={17} color={c.primaryForeground} />
        </View>
        <Text style={{ color: c.primaryForeground, opacity: 0.72, fontFamily: 'Inter_500Medium', fontSize: 10, marginTop: 6 }}>
          {tr(showBalanceDetails ? 'Tap card to return' : 'Tap for balances and history')}
        </Text>
      </Pressable>}
      {hasBankEstimate ? (
        <View testID="personal-bank-estimate">
          <Pressable
            testID="toggle-personal-bank-estimate"
            accessibilityRole="button"
            accessibilityLabel={`${tr('Estimated bank cash')}: ${money(bankEstimate.estimateMinor)}`}
            accessibilityState={{ expanded: showBankEstimate }}
            onPress={() => setShowBankEstimate((visible) => !visible)}
            style={({ pressed }) => [{
              minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 14, borderWidth: 1, borderColor: c.border, borderRadius: 12,
              backgroundColor: c.card, opacity: pressed ? 0.82 : 1,
            }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Feather name="credit-card" size={16} color={c.primary} />
              <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>{tr('Estimated bank cash')}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: c.foreground, fontFamily: 'Inter_700Bold', fontSize: 14 }}>{money(bankEstimate.estimateMinor)}</Text>
              <Feather name={showBankEstimate ? 'chevron-up' : 'chevron-down'} size={16} color={c.mutedForeground} />
            </View>
          </Pressable>
          {showBankEstimate ? (
            <Card style={{ paddingVertical: 11, paddingHorizontal: 14, gap: 7, marginTop: 7 }}>
              <EstimateRow label={tr('Home Ledger balance')} value={bankEstimate.balanceMinor} money={money} />
              <EstimateRow label={tr('Shared allocations')} value={bankEstimate.allocationsMinor} money={money} prefix="+" />
              <EstimateRow label={tr('Shared purchases paid personally')} value={bankEstimate.sharedPurchasesMinor} money={money} prefix="−" />
              <Text style={{ color: c.mutedForeground, fontSize: 10, marginTop: 1 }}>{tr('Estimated from recorded activity')}</Text>
            </Card>
          ) : null}
        </View>
      ) : null}
      {showBalanceDetails ? (
        <View style={{ gap: 10 }}>
          <Pressable
            testID="return-to-available-balance"
            accessibilityRole="button"
            accessibilityLabel={tr('Back to available balance')}
            onPress={() => setShowBalanceDetails(false)}
            style={{ alignSelf: 'flex-start', minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6 }}
          >
            <Feather name="chevron-up" size={17} color={c.primary} />
            <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>
              {tr('Back to available balance')}
            </Text>
          </Pressable>
          <Card style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: c.foreground, fontFamily: 'Inter_700Bold', fontSize: 17 }}>{tr('Balances by account')}</Text>
              <Feather name="bar-chart-2" size={17} color={c.primary} />
            </View>
            <View style={{ gap: 11, marginTop: 11 }}>
            {(showAllBalanceAccounts ? balanceItems : balanceItems.slice(0, 3)).map(({ account: balanceAccount, balanceMinor }) => {
              const barWidth = Math.abs(balanceMinor) / maxAbsAccountBalance * (hasNegativeAccountBalance ? 50 : 100);
              const category = balanceAccount.kind === 'shared'
                ? tr('Shared account')
                : balanceAccount.role === 'main' ? tr('Main') : tr('Savings');
              return (
                <View key={balanceAccount.id} testID={`balance-account-${balanceAccount.id}`} accessibilityLabel={`${balanceAccount.name}, ${money(balanceMinor)}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Feather
                      name={balanceAccount.kind === 'shared' ? 'users' : balanceAccount.role === 'main' ? 'user' : 'archive'}
                      size={12}
                      color={c.foreground}
                    />
                    <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontSize: 11, fontFamily: 'Inter_500Medium' }}>
                      {balanceAccount.name}
                    </Text>
                    <Text style={{ color: c.mutedForeground, fontSize: 9 }}>{category}</Text>
                    <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 11, minWidth: 65, textAlign: 'right' }}>
                      {money(balanceMinor)}
                    </Text>
                  </View>
                  <View style={{ height: 6, position: 'relative', overflow: 'hidden', borderRadius: 4, backgroundColor: c.balanceTrack, marginTop: 4 }}>
                    {hasNegativeAccountBalance ? <View style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: c.mutedForeground }} /> : null}
                    {barWidth > 0 ? (
                      <View style={{
                        position: 'absolute',
                        left: hasNegativeAccountBalance ? (balanceMinor >= 0 ? '50%' : `${50 - barWidth}%`) : '0%',
                        width: `${barWidth}%`,
                        height: '100%',
                        borderRadius: 4,
                        backgroundColor: balanceMinor >= 0 ? c.positiveBar : c.negativeBar,
                      }} />
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
          {balanceItems.length > 3 ? (
            <Pressable
              testID="toggle-balance-account-list"
              onPress={() => setShowAllBalanceAccounts((visible) => !visible)}
              accessibilityRole="button"
              style={{ alignSelf: 'flex-start', paddingVertical: 8 }}
            >
              <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold', fontSize: 11 }}>
                {tr(showAllBalanceAccounts ? 'Show fewer accounts' : 'Show all accounts')}
              </Text>
            </Pressable>
          ) : null}
            <Text style={{ color: c.mutedForeground, fontSize: 10, marginTop: 8 }}>
              {tr('Savings-goal progress is shown separately')}
            </Text>
          </Card>
          <BalanceHistoryCard
            key={`${shared ? 'shared' : 'personal'}:${selectedPersonalAccount?.id ?? 'all'}`}
            accounts={historyAccounts}
            transactions={historyTransactions}
            currency={state?.baseCurrency ?? 'USD'}
            now={businessNow(state)}
            scopeLabel={tr(shared ? 'Shared household' : 'Personal')}
            hasPending={outbox.length > 0}
          />
        </View>
      ) : null}
      <View style={styles.stats}><IncomeStat key={shared ? 'shared' : 'personal'} active={shared} monthIncomeMinor={monthIncomeMinor} users={incomeBreakdown} /><ExpenseStat key={`expense-${shared ? 'shared' : 'personal'}`} active={shared} monthExpenseMinor={monthExpenseMinor} users={expenseByShare} /></View>
      <CategorySpendingBudgetCard rows={categoryTotals} month={currentMonth} scope={shared ? tr('Shared household') : `${tr('Personal')} · ${selectedPersonalAccount?.name ?? tr('All personal accounts')}`}
        currency={state?.baseCurrency ?? 'USD'} expenseMinor={monthExpenseMinor} selectedPersonalAccount={!shared && !!selectedPersonalAccount} onSelect={setSelectedCategoryId} />
      <SavingsOverviewCard overview={savingsOverview} users={state?.users ?? []}
        shared={shared} currency={state?.baseCurrency ?? 'USD'} now={businessNow(state)} />
      <SectionTitle action={outbox.length ? <Text style={{ color: c.tint, fontSize: 12 }}>{outbox.length} {tr('pending')}</Text> : null}>{tr('Recent activity')}</SectionTitle>{recent.map((tx) => { const direction = getTransactionDirection(tx, account?.id); const outgoing = direction === 'out'; const owner = getTransactionOwnerName(tx, state?.accounts ?? [], state?.users ?? []); return <View key={tx.id} style={styles.recent}><View style={[styles.recentIcon, { backgroundColor: outgoing ? c.accent : c.secondary }]}><Feather name={tx.kind === 'transfer' ? 'repeat' : outgoing ? 'arrow-up-right' : 'arrow-down-left'} size={15} color={outgoing ? c.tint : c.primary} /></View><View style={{ flex: 1 }}><Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>{tx.note}</Text><Text style={{ color: c.mutedForeground, fontSize: 12 }}>{owner ? `${owner} · ` : ''}{formatTransactionDate(tx.occurredAt, locale)}</Text></View><Text style={{ color: outgoing ? c.tint : c.primary, fontFamily: 'Inter_700Bold' }}>{outgoing ? '-' : '+'}{money(tx.amountMinor)}</Text></View>; })}
      <Modal visible={Boolean(selectedCategory)} transparent animationType="slide" onRequestClose={() => setSelectedCategoryId(null)}>
        <View style={styles.categoryModalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedCategoryId(null)} accessibilityLabel={tr('Close')} />
          <View style={[styles.categoryModal, { backgroundColor: c.card, paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.categoryModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.categoryModalTitle, { color: c.foreground }]}>{selectedCategory?.name}</Text>
                <Text style={{ color: c.mutedForeground, marginTop: 4 }}>{tr('Entries this month')} · {currentMonth}</Text>
              </View>
              <Pressable testID="close-category-entries" accessibilityRole="button" accessibilityLabel={tr('Close')} onPress={() => setSelectedCategoryId(null)} hitSlop={12}><Feather name="x" size={22} color={c.mutedForeground} /></Pressable>
            </View>
            <Text style={{ color: c.tint, fontFamily: 'Inter_700Bold', fontSize: 22, marginBottom: 16 }}>{money(selectedCategory?.amountMinor ?? 0)}</Text>
            <ScrollView nestedScrollEnabled style={[styles.categoryEntries, { flexShrink: 1, minHeight: 0 }]} showsVerticalScrollIndicator>
              {!categoryEntries.length ? <Text style={{ color: c.mutedForeground }}>{tr('No entries this month.')}</Text> : null}
              {categoryEntries.map((tx) => <View key={tx.id} style={[styles.categoryEntry, { borderTopColor: c.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>{tx.note}</Text>
                  <Text style={{ color: c.mutedForeground, fontSize: 12, marginTop: 4 }}>{getTransactionOwnerName(tx, state?.accounts ?? [], state?.users ?? [])}{' · '}{formatTransactionDate(tx.occurredAt, locale)}</Text>
                </View>
                <Text style={{ color: c.tint, fontFamily: 'Inter_700Bold', fontSize: 14 }}>{money(tx.amountMinor)}</Text>
              </View>)}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>;
}
function SwitchButton({ active, label, icon, onPress }: { active: boolean; label: string; icon: keyof typeof Feather.glyphMap; onPress: () => void }) {
  const c = useColors();
  const { state, session, dashboardPersonalAccountId, setDashboardPersonalAccountId } = useLedger(); const { locale } = useI18n(); const tr = (value: string) => translateLiteral(value, locale);
  const [menuOpen, setMenuOpen] = useState(false);
   const isPersonal = label === tr('Personal');
  const accounts = (state?.accounts ?? []).filter((account) => account.kind === 'personal' && account.ownerUserId === session?.user.id && !account.archived);
  const selected = accounts.find((account) => account.id === dashboardPersonalAccountId);
  const handlePress = () => {
    if (!isPersonal || !active) {
      onPress();
      setMenuOpen(false);
      return;
    }
    setMenuOpen((open) => !open);
  };
  return <View style={{ position: 'relative', zIndex: menuOpen ? 30 : 0 }}>
    <Pressable testID={`switch-${label}`} onPress={handlePress} style={[styles.switch, { backgroundColor: active ? c.primary : c.secondary }]}>
      <Feather name={icon} size={15} color={active ? c.primaryForeground : c.secondaryForeground} />
       <Text numberOfLines={1} style={{ color: active ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>{isPersonal && active ? `${tr('Personal')} · ${selected?.name ?? tr('All')}` : label}</Text>
      {isPersonal && active ? <Feather name={menuOpen ? 'chevron-up' : 'chevron-down'} size={14} color={c.primaryForeground} /> : null}
    </Pressable>
    {isPersonal && active && menuOpen ? <View style={{ position: 'absolute', top: 43, left: 0, width: 230, borderWidth: 1, borderColor: c.border, borderRadius: 12, overflow: 'hidden', backgroundColor: c.card, elevation: 8, zIndex: 40 }}>
      <Pressable testID="home-personal-all" onPress={() => { setDashboardPersonalAccountId(null); setMenuOpen(false); }} style={{ minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }}>
        <Feather name="layers" size={15} color={!selected ? c.primary : c.mutedForeground} />
         <Text style={{ color: c.foreground, fontFamily: !selected ? 'Inter_700Bold' : 'Inter_500Medium' }}>{tr('All personal accounts')}</Text>
      </Pressable>
      {accounts.map((account) => <Pressable key={account.id} testID={`home-personal-${account.id}`} onPress={() => { setDashboardPersonalAccountId(account.id); setMenuOpen(false); }} style={{ minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }}>
        <Feather name={account.role === 'savings' ? 'archive' : 'user'} size={15} color={account.id === selected?.id ? c.primary : c.mutedForeground} />
        <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontFamily: account.id === selected?.id ? 'Inter_700Bold' : 'Inter_500Medium' }}>{account.name}</Text>
      </Pressable>)}
    </View> : null}
  </View>;
}
function BudgetAlertBanner({ shared, userId }: { shared: boolean; userId?: string }) {
  const c = useColors();
  const { state, dismissBudgetAlert } = useLedger(); const { locale } = useI18n(); const tr = (value: string) => translateLiteral(value, locale);
  const alert = (state?.budgetAlerts ?? []).find((item) => {
    const category = state?.categories.find((candidate) => candidate.id === item.categoryId);
    return shared ? category?.scope === 'shared' : category?.scope === 'personal' && category.ownerUserId === userId;
  });
  if (!alert) return null;
  const category = state?.categories.find((item) => item.id === alert.categoryId);
   const message = alert.type === 'over' ? tr('is over its monthly budget') : tr('has reached its budget warning level');
   return <View style={[styles.budgetAlert, { backgroundColor: c.accent, borderColor: c.tint }]}><Feather name="alert-triangle" size={18} color={c.tint} /><Text style={{ color: c.foreground, flex: 1, lineHeight: 19 }}><Text style={{ fontFamily: 'Inter_700Bold' }}>{category?.name ?? tr('A category')}</Text> {message}.</Text><Pressable testID={`dismiss-budget-alert-${alert.id}`} accessibilityLabel={tr('Dismiss budget alert')} hitSlop={10} onPress={() => void dismissBudgetAlert(alert.id).catch((error) => Alert.alert(tr('Could not dismiss alert'), error instanceof Error ? error.message : tr('Try again.')))}><Feather name="x" size={18} color={c.tint} /></Pressable></View>;
}
function Stat({ label, value, color }: { label: string; value: string; color: string }) { const c = useColors(); return <View style={[styles.stat, { backgroundColor: c.card, borderColor: c.border }]}><View style={[styles.statDot, { backgroundColor: color }]} /><Text style={{ color: c.mutedForeground, fontSize: 12, marginBottom: 5 }}>{label}</Text><Text style={{ color: c.foreground, fontFamily: 'Inter_700Bold', fontSize: 16 }}>{value}</Text></View>; }
function IncomeStat({ active, monthIncomeMinor, users }: { active: boolean; monthIncomeMinor: number; users: { user: { id: string; displayName: string }; amountMinor: number }[] }) {
  const c = useColors();
  const { state } = useLedger(); const { locale } = useI18n(); const tr = (value: string) => translateLiteral(value, locale); const money = (minor: number) => formatCurrency(minor, state?.baseCurrency ?? 'USD', locale);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selected = users.find((item) => item.user.id === selectedUserId) ?? users[0];
  const toggleCard = () => {
    if (!active) return;
    setShowBreakdown((current) => !current);
    setDropdownOpen(false);
  };
  return <Pressable testID="income-this-month-toggle" accessibilityRole={active ? 'button' : undefined} accessibilityLabel={showBreakdown && active ? tr('Income and transfers by household member') : tr('Income this month')} accessibilityHint={active ? tr('Double tap to switch between monthly inflow and each member’s income and transfers') : undefined} disabled={!active} onPress={toggleCard} style={[styles.stat, { backgroundColor: c.card, borderColor: c.border, zIndex: dropdownOpen ? 5 : 0 }]}>{showBreakdown && active ? <><View style={[styles.statDot, { backgroundColor: c.primary }]} />{selected ? <><Pressable testID="income-user-picker" onPress={(event) => { event.stopPropagation(); setDropdownOpen((current) => !current); }} style={[styles.expensePicker, { backgroundColor: c.muted }]}><Text numberOfLines={1} style={{ color: c.foreground, flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>{selected.user.displayName}</Text><Feather name={dropdownOpen ? 'chevron-up' : 'chevron-down'} size={14} color={c.mutedForeground} /></Pressable><Text style={{ color: c.primary, fontFamily: 'Inter_700Bold', fontSize: 16, marginTop: 6 }}>{money(selected.amountMinor)}</Text></> : <Text numberOfLines={2} style={{ color: c.mutedForeground, fontSize: 12 }}>{tr('No shared income this month')}</Text>}<Text style={{ color: c.mutedForeground, fontSize: 9, marginTop: 'auto' }}>{tr('Tap card to return')}</Text>{dropdownOpen ? <View style={[styles.expenseDropdown, { backgroundColor: c.card, borderColor: c.border }]}><ScrollView nestedScrollEnabled showsVerticalScrollIndicator={users.length > 2}>{users.map((item) => <Pressable key={item.user.id} onPress={(event) => { event.stopPropagation(); setSelectedUserId(item.user.id); setDropdownOpen(false); }} style={[styles.expenseDropdownRow, { borderBottomColor: c.border }]}><Text numberOfLines={1} style={{ color: c.foreground, flex: 1, fontSize: 12 }}>{item.user.displayName}</Text><Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>{money(item.amountMinor)}</Text></Pressable>)}</ScrollView></View> : null}</> : <><View style={[styles.statDot, { backgroundColor: c.primary }]} /><Text style={{ color: c.mutedForeground, fontSize: 12, marginBottom: 5 }}>{tr('Income this month')}</Text><Text style={{ color: c.foreground, fontFamily: 'Inter_700Bold', fontSize: 16 }}>{money(monthIncomeMinor)}</Text>{active ? <Text style={{ color: c.mutedForeground, fontSize: 9, marginTop: 'auto' }}>{tr('Includes transfers in · tap for members')}</Text> : null}</>}</Pressable>;
}
function ExpenseStat({ active, monthExpenseMinor, users }: {
  active: boolean;
  monthExpenseMinor: number;
  users: { user: { id: string; displayName: string }; shareAmountMinor: number; enteredAmountMinor: number }[];
}) {
  const c = useColors();
  const { state } = useLedger();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const money = (minor: number) => formatCurrency(minor, state?.baseCurrency ?? 'USD', locale);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selected = users.find((item) => item.user.id === selectedUserId) ?? users[0];
  const difference = selected ? selected.enteredAmountMinor - selected.shareAmountMinor : 0;
  const scale = Math.max(selected?.shareAmountMinor ?? 0, selected?.enteredAmountMinor ?? 0, 1);
  const differenceText = (amount: number) => amount === 0
    ? `${money(0)} ${tr('On share')}`
    : `${amount > 0 ? '+' : '−'}${money(Math.abs(amount))} ${tr(amount > 0 ? 'Above share' : 'Below share')}`;
  const differenceColor = (amount: number) => amount > 0 ? c.tint : amount < 0 ? c.primary : c.mutedForeground;
  const toggleCard = () => {
    if (!active) return;
    setShowBreakdown((current) => !current);
    setDropdownOpen(false);
  };
  return (
    <Pressable
      testID="spent-this-month-toggle"
      accessibilityRole={active ? 'button' : undefined}
      accessibilityLabel={showBreakdown && active ? tr('Household expense shares and entered expenses by member') : tr('Spent this month')}
      accessibilityHint={active ? tr('Double tap to compare each member’s share with expenses entered by that member') : undefined}
      disabled={!active}
      onPress={toggleCard}
      style={[styles.stat, showBreakdown && active && { height: 190 }, { backgroundColor: c.card, borderColor: c.border, zIndex: dropdownOpen ? 5 : 0 }]}
    >
      <View style={[styles.statDot, { backgroundColor: c.tint }]} />
      {showBreakdown && active ? (
        <>
          {selected ? (
            <>
              <Pressable
                testID="effective-expense-user-picker"
                onPress={(event) => { event.stopPropagation(); setDropdownOpen((current) => !current); }}
                style={[styles.expensePicker, { backgroundColor: c.muted }]}
              >
                <Text numberOfLines={1} style={{ color: c.foreground, flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>{selected.user.displayName}</Text>
                <Feather name={dropdownOpen ? 'chevron-up' : 'chevron-down'} size={14} color={c.mutedForeground} />
              </Pressable>
              <View style={{ gap: 5, marginTop: 9 }}>
                {([
                  { label: tr('Share'), amount: selected.shareAmountMinor, color: c.primary },
                  { label: tr('Entered'), amount: selected.enteredAmountMinor, color: c.tint },
                ]).map((item) => (
                  <View key={item.label}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: c.mutedForeground, fontSize: 10 }}>{item.label}</Text>
                      <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 11 }}>{money(item.amount)}</Text>
                    </View>
                    <View style={{ height: 5, borderRadius: 3, backgroundColor: c.muted, overflow: 'hidden', marginTop: 3 }}>
                      <View style={{ height: '100%', width: `${Math.min(100, item.amount / scale * 100)}%`, borderRadius: 3, backgroundColor: item.color }} />
                    </View>
                  </View>
                ))}
              </View>
              <Text numberOfLines={1} style={{ color: differenceColor(difference), fontFamily: 'Inter_700Bold', fontSize: 11, marginTop: 8 }}>
                {differenceText(difference)}
              </Text>
            </>
          ) : <Text numberOfLines={2} style={{ color: c.mutedForeground, fontSize: 12 }}>{tr('No shared expenses this month')}</Text>}
          <Text style={{ color: c.mutedForeground, fontSize: 9, marginTop: 'auto' }}>{tr('Tap card to return')}</Text>
          {dropdownOpen ? (
            <View style={[styles.expenseDropdown, { backgroundColor: c.card, borderColor: c.border, maxHeight: 116 }]}>
              <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={users.length > 2}>
                {users.map((item) => {
                  const itemDifference = item.enteredAmountMinor - item.shareAmountMinor;
                  return (
                    <Pressable
                      key={item.user.id}
                      onPress={(event) => { event.stopPropagation(); setSelectedUserId(item.user.id); setDropdownOpen(false); }}
                      style={[styles.expenseDropdownRow, { borderBottomColor: c.border, minHeight: 44, flexDirection: 'column', alignItems: 'stretch', gap: 1, justifyContent: 'center' }]}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <Text numberOfLines={1} style={{ color: c.foreground, flex: 1, fontSize: 11 }}>{item.user.displayName}</Text>
                        <Text style={{ color: c.mutedForeground, fontSize: 9 }}>{money(item.shareAmountMinor)}</Text>
                      </View>
                      <Text numberOfLines={1} style={{ color: differenceColor(itemDifference), fontFamily: 'Inter_600SemiBold', fontSize: 9 }}>{differenceText(itemDifference)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </>
      ) : (
        <>
          <Text style={{ color: c.mutedForeground, fontSize: 12, marginBottom: 5 }}>{tr('Spent this month')}</Text>
          <Text style={{ color: c.foreground, fontFamily: 'Inter_700Bold', fontSize: 16 }}>{money(monthExpenseMinor)}</Text>
          {active ? <Text style={{ color: c.mutedForeground, fontSize: 9, marginTop: 'auto' }}>{tr('Tap for member shares')}</Text> : null}
        </>
      )}
    </Pressable>
  );
}
function EstimateRow({ label, value, money, prefix = '' }: {
  label: string; value: number; money: (minor: number) => string; prefix?: string;
}) {
  const c = useColors();
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
    <Text style={{ flex: 1, color: c.mutedForeground, fontSize: 11 }}>{label}</Text>
    <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 11 }}>{prefix}{money(value)}</Text>
  </View>;
}

const styles = StyleSheet.create({ content: { padding: 18, paddingBottom: 120, gap: 14 }, greeting: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, kicker: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 2, marginBottom: 8 }, title: { fontFamily: 'Inter_700Bold', fontSize: 29 }, sync: { borderRadius: 30, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6 }, syncDot: { width: 7, height: 7, borderRadius: 4 }, switcher: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, switch: { borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 9 }, backupWarning: { borderWidth: 1, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, backupLink: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, paddingVertical: 10, minHeight: 44 }, budgetAlert: { width: '100%', borderWidth: 1, borderRadius: 16, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, budgetSummary: { width: '100%', borderWidth: 1, borderRadius: 18, padding: 14 }, dot: { width: 9, height: 9, borderRadius: 5 }, balanceCard: { borderRadius: 22, padding: 20, minHeight: 153, justifyContent: 'center' }, balance: { fontFamily: 'Inter_700Bold', fontSize: 38, marginVertical: 8 }, stats: { flexDirection: 'row', gap: 10 }, stat: { flex: 1, height: 112, borderRadius: 16, borderWidth: 1, padding: 13 }, statDot: { width: 8, height: 8, borderRadius: 4 }, expensePicker: { minHeight: 27, borderRadius: 8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }, expenseDropdown: { position: 'absolute', top: 42, left: 7, right: 7, maxHeight: 70, borderWidth: 1, borderRadius: 9, overflow: 'hidden', zIndex: 10, elevation: 6 }, expenseDropdownRow: { minHeight: 34, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: StyleSheet.hairlineWidth }, categoryList: { maxHeight: 215 }, category: { marginBottom: 14 }, categoryTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7, gap: 8 }, track: { height: 8, borderRadius: 4, overflow: 'hidden' }, fill: { height: '100%', borderRadius: 4 }, categoryModalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.32)' }, categoryModal: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 20, maxHeight: '78%' }, categoryModalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 }, categoryModalTitle: { fontFamily: 'Inter_700Bold', fontSize: 22 }, categoryEntries: { flexGrow: 0 }, categoryEntry: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth }, goalName: { fontFamily: 'Inter_600SemiBold', fontSize: 15, marginBottom: 10 }, goalLine: { flexDirection: 'row', alignItems: 'baseline', gap: 3, marginBottom: 10 }, recent: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7 }, recentIcon: { width: 34, height: 34, borderRadius: 11, justifyContent: 'center', alignItems: 'center' } });