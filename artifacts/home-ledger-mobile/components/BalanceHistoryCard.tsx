import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/Ui';
import { BalanceHistoryPlot, type HistoryView } from '@/components/BalanceHistoryPlot';
import { useColors } from '@/hooks/useColors';
import { buildBalanceHistory, type HistoryAccount, type HistoryInterval, type HistoryTransaction } from '@/lib/balance-history';
import { formatCurrency, useI18n } from '@/lib/i18n';

type AccountOption = Omit<HistoryAccount, 'balanceMinor'> & { balanceMinor?: number };

type Props = {
  accounts: AccountOption[];
  transactions: HistoryTransaction[];
  currency: string;
  now: Date;
  scopeLabel: string;
  hasPending: boolean;
};

function closingDate(value: string, locale: 'en' | 'fr' | 'it'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(value));
}

export function BalanceHistoryCard({ accounts, transactions, currency, now, scopeLabel, hasPending }: Props) {
  const c = useColors();
  const { t, locale } = useI18n();
  const [interval, setInterval] = useState<HistoryInterval>('week');
  const [view, setView] = useState<HistoryView>('trend');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const selectedAccount = accounts.find((account) => account.id === accountId);
  const visibleAccounts = useMemo(() => selectedAccount ? [selectedAccount] : accounts, [accounts, selectedAccount]);
  const resolvedAccounts = useMemo<HistoryAccount[]>(() => visibleAccounts.flatMap((account) => (
    typeof account.balanceMinor === 'number' ? [{ ...account, balanceMinor: account.balanceMinor }] : []
  )), [visibleAccounts]);
  const missingBalance = resolvedAccounts.length !== visibleAccounts.length;
  const accountIds = useMemo(() => new Set(resolvedAccounts.map((account) => account.id)), [resolvedAccounts]);
  const hasEntries = transactions.some((transaction) => transaction.status === 'posted'
    && transaction.kind !== 'reversal'
    && (accountIds.has(transaction.accountId)
      || (transaction.destinationAccountId ? accountIds.has(transaction.destinationAccountId) : false)));
  const history = useMemo(() => {
    if (missingBalance || !resolvedAccounts.length) return { points: [], error: false };
    try {
      return { points: buildBalanceHistory(resolvedAccounts, transactions, interval, now), error: false };
    } catch (error) {
      console.error('Balance history could not be calculated', error);
      return { points: [], error: true };
    }
  }, [resolvedAccounts, transactions, interval, now, missingBalance]);
  const points = history.points;
  const activeIndex = selectedIndex === null ? points.length - 1 : Math.max(0, Math.min(selectedIndex, points.length - 1));
  const selectedPoint = points[activeIndex];
  const activeView: HistoryView = selectedAccount || accounts.length < 2 ? 'trend' : view;
  const chooseAccount = (id: string | null) => {
    setAccountId(id);
    setView('trend');
    setSelectedIndex(null);
    setPickerOpen(false);
  };

  return <>
    <View testID="balance-history-heading" style={styles.sectionHeading}>
      <Text style={[styles.sectionToggleTitle, { color: c.foreground }]}>{t('balanceHistory')}</Text>
    </View>
    <Card style={{ padding: 16 }}>
      <View style={styles.heading}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.kicker, { color: c.mutedForeground }]}>{scopeLabel}</Text>
          <Text style={[styles.title, { color: c.foreground }]}>{t('closingBalance')}</Text>
        </View>
        {accounts.length > 1 ? (
          <View style={[styles.modeSwitch, { backgroundColor: c.muted }]}>
            {(['trend', 'composition'] as const).map((option) => (
              <Pressable
                key={option}
                testID={`balance-history-view-${option}`}
                accessibilityRole="button"
                accessibilityState={{ selected: activeView === option }}
                onPress={() => { setAccountId(null); setView(option); setSelectedIndex(null); }}
                style={[styles.modeButton, activeView === option && { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }]}
              >
                <Text style={[styles.modeLabel, { color: activeView === option ? c.primary : c.mutedForeground }]}>
                  {t(option === 'trend' ? 'trend' : 'composition')}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.filterRow}>
        {accounts.length > 1 ? (
          <Pressable
            testID="balance-history-account-picker"
            accessibilityRole="button"
            accessibilityLabel={`${t('account')}: ${selectedAccount?.name ?? t('allAccounts')}`}
            onPress={() => setPickerOpen(true)}
            style={[styles.accountPicker, { borderColor: c.border, backgroundColor: c.background }]}
          >
            <Feather name="layers" size={14} color={c.primary} />
            <Text numberOfLines={1} style={[styles.accountName, { color: c.foreground }]}>
              {selectedAccount?.name ?? t('allAccounts')}
            </Text>
            <Feather name="chevron-down" size={14} color={c.mutedForeground} />
          </Pressable>
        ) : <Text numberOfLines={1} style={[styles.singleAccount, { color: c.mutedForeground }]}>
          {accounts[0]?.name ?? t('allAccounts')}
        </Text>}
      </View>

      <View style={[styles.intervalSwitch, { backgroundColor: c.muted }]}>
        {(['day', 'week', 'month'] as const).map((option) => (
          <Pressable
            key={option}
            testID={`balance-history-interval-${option}`}
            accessibilityRole="button"
            accessibilityState={{ selected: interval === option }}
            onPress={() => { setInterval(option); setSelectedIndex(null); }}
            style={[styles.intervalButton, interval === option && { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }]}
          >
            <Text style={[styles.intervalLabel, { color: interval === option ? c.primary : c.mutedForeground }]}>
              {t(option)}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ color: c.mutedForeground, fontSize: 11, marginBottom: 9 }}>
        {t(interval === 'day' ? 'last30Days' : interval === 'week' ? 'last12Weeks' : 'last12Months')}
      </Text>

      {!accounts.length || missingBalance || history.error ? (
        <View style={[styles.empty, { backgroundColor: c.muted }]}>
          <Feather name="activity" size={21} color={c.mutedForeground} />
          <Text style={{ color: c.mutedForeground, textAlign: 'center', fontSize: 13, marginTop: 8 }}>
            {!accounts.length ? t('noHistoryAccounts') : t('historyUnavailable')}
          </Text>
        </View>
      ) : <>
        <BalanceHistoryPlot
          points={points}
          accounts={resolvedAccounts}
          interval={interval}
          view={activeView}
          selectedIndex={activeIndex}
          onSelect={setSelectedIndex}
          currency={currency}
          locale={locale}
        />
        <Text style={[styles.tapHint, { color: c.mutedForeground }]}>{t('tapHistory')}</Text>
        {activeView === 'composition' ? (
          <View style={styles.legend}>
            {resolvedAccounts.map((account, index) => (
              <View key={account.id} style={styles.legendEntry}>
                <View style={[styles.legendDot, { backgroundColor: c.historySeries[index % c.historySeries.length] }]} />
                <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 11, flex: 1 }}>{account.name}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View
          testID="balance-history-tooltip"
          accessibilityLiveRegion="polite"
          style={[styles.tooltip, { backgroundColor: c.muted, borderColor: c.border }]}
        >
          <Text style={{ color: c.mutedForeground, fontSize: 11, fontFamily: 'Inter_500Medium' }}>
            {selectedPoint.currentPeriod ? t('asOf') : t('closedOn')} {closingDate(selectedPoint.closingAt, locale)}
          </Text>
          <Text style={{ color: c.foreground, fontFamily: 'Inter_700Bold', fontSize: 21, marginTop: 3 }}>
            {formatCurrency(selectedPoint.totalMinor, currency, locale)}
          </Text>
          {activeView === 'composition' ? resolvedAccounts.map((account, index) => (
            <View key={account.id} style={styles.breakdownRow}>
              <View style={[styles.legendDot, { backgroundColor: c.historySeries[index % c.historySeries.length] }]} />
              <Text numberOfLines={1} style={{ color: c.secondaryForeground, fontSize: 11, flex: 1 }}>{account.name}</Text>
              <Text style={{ color: c.foreground, fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>
                {formatCurrency(selectedPoint.balances[account.id], currency, locale)}
              </Text>
            </View>
          )) : null}
          {selectedPoint.unverifiedStart ? (
            <Text style={{ color: c.mutedForeground, fontSize: 11, lineHeight: 16, marginTop: 8 }}>
              {t('historyUnverifiedPoint')}
            </Text>
          ) : null}
        </View>
        {!hasEntries ? <Text style={[styles.footnote, { color: c.mutedForeground }]}>{t('noPostedHistory')}</Text> : null}
        {points.some((point) => point.unverifiedStart) ? (
          <Text style={[styles.footnote, { color: c.mutedForeground }]}>
            {t(activeView === 'trend' ? 'historyUnverifiedGuide' : 'historyUnverifiedAreaGuide')}
          </Text>
        ) : null}
        {activeView === 'composition' ? (
          <Text style={[styles.footnote, { color: c.mutedForeground }]}>{t('compositionGuide')}</Text>
        ) : null}
      </>}
      <Text style={[styles.footnote, { color: c.mutedForeground }]}>{t('savedHistory')}</Text>
      {hasPending ? <Text style={[styles.footnote, { color: c.tint }]}>{t('pendingHistory')}</Text> : null}
    </Card>
    <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPickerOpen(false)} accessibilityLabel={t('cancel')} />
        <View style={[styles.modalSheet, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.modalTitle, { color: c.foreground }]}>{t('chooseHistoryAccount')}</Text>
          <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled>
            {[{ id: null, name: t('allAccounts') }, ...accounts].map((option) => (
              <Pressable
                key={option.id ?? 'all'}
                testID={`balance-history-account-${option.id ?? 'all'}`}
                accessibilityRole="button"
                accessibilityState={{ selected: (selectedAccount?.id ?? null) === option.id }}
                onPress={() => chooseAccount(option.id)}
                style={[styles.modalOption, { borderBottomColor: c.border }]}
              >
                <Text numberOfLines={1} style={{ color: (selectedAccount?.id ?? null) === option.id ? c.primary : c.foreground, fontFamily: 'Inter_600SemiBold', flex: 1 }}>
                  {option.name}
                </Text>
                {(selectedAccount?.id ?? null) === option.id ? <Feather name="check" size={17} color={c.primary} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  sectionHeading: { minHeight: 36, justifyContent: 'center', marginBottom: 11 },
  sectionToggleTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kicker: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.8, textTransform: 'uppercase' },
  title: { fontSize: 17, fontFamily: 'Inter_700Bold', marginTop: 3 },
  modeSwitch: { flexDirection: 'row', borderRadius: 11, padding: 3, gap: 2 },
  modeButton: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: 'transparent' },
  modeLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  filterRow: { minHeight: 40, justifyContent: 'center', marginTop: 12, marginBottom: 9 },
  accountPicker: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, borderWidth: 1, borderRadius: 10 },
  accountName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', flexShrink: 1 },
  singleAccount: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  intervalSwitch: { flexDirection: 'row', borderRadius: 12, padding: 3, gap: 3, marginBottom: 12 },
  intervalButton: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 34, borderRadius: 9, borderWidth: 1, borderColor: 'transparent' },
  intervalLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  empty: { minHeight: 170, alignItems: 'center', justifyContent: 'center', padding: 16, borderRadius: 12 },
  tapHint: { fontSize: 10, textAlign: 'center', marginTop: 8 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, rowGap: 7 },
  legendEntry: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 10 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  tooltip: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 12 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 7 },
  footnote: { fontSize: 10, lineHeight: 15, marginTop: 9 },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet: { borderRadius: 18, borderWidth: 1, padding: 16, maxHeight: '75%' },
  modalTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  modalOption: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});