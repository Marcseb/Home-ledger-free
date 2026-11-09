import { Feather } from '@expo/vector-icons';
import type { Transaction } from '@workspace/api-client-react';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Field } from '@/components/Ui';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { DatePickerField, DatePickerModal } from '@/components/DatePicker';
import { useColors } from '@/hooks/useColors';
import { useLedger } from '@/lib/ledger-context';
import { formatCurrency, translateLiteral, useI18n } from '@/lib/i18n';
import { businessDateValue } from '@/lib/app-time';
import { parseTransactionDateInput } from '@/lib/transaction-display';

export default function AddTransaction() {
  const c = useColors();
  const router = useRouter();
  const { state, session, online, outbox, addTransaction } = useLedger();
  const { t, locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const [kind, setKind] = useState<Transaction['kind']>('expense');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedDestinationAccountId, setSelectedDestinationAccountId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<'account' | 'destination' | 'category' | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(businessDateValue(state).slice(0, 7));

  useFocusEffect(useCallback(() => {
    setAmount('');
    setNote('');
    setDate('');
    setOpenDropdown(null);
    setCalendarOpen(false);
  }, []));

  const today = businessDateValue(state);
  const entryDate = date || today;

  const openDatePicker = () => {
    setCalendarMonth(entryDate.slice(0, 7));
    setCalendarOpen(true);
  };

  const accounts = useMemo(
    () => state?.accounts.filter((item) => !item.archived && (item.kind === 'shared' || item.ownerUserId === session?.user.id)) ?? [],
    [session?.user.id, state?.accounts],
  );
  const account = accounts.find((item) => item.id === selectedAccountId)
    ?? accounts.find((item) => item.kind === 'shared')
    ?? accounts[0];
  const destinationAccounts = accounts.filter((item) => {
    if (item.id === account?.id) return false;
    if (account?.role === 'savings' || item.role === 'savings') {
      return item.ownerUserId === session?.user.id && (item.role === 'main' || item.role === 'savings')
        && account?.ownerUserId === session?.user.id;
    }
    return true;
  });
  const destinationAccount = destinationAccounts.find((item) => item.id === selectedDestinationAccountId) ?? destinationAccounts[0];
  const categories = useMemo(() => {
    const all = state?.categories ?? [];
    if (kind === 'income') return all.filter((item) => item.id === 'income');
    if (kind === 'transfer') return all.filter((item) => item.id === 'transfer');
    if (!account) return [];
    return all.filter((item) => !item.archived && !item.system && item.scope === account.kind && (item.scope === 'shared' || item.ownerUserId === session?.user.id));
  }, [account, kind, session?.user.id, state?.categories]);
  const category = categories.find((item) => item.id === selectedCategoryId) ?? categories[0];

  const chooseAccount = (accountId: string) => {
    setSelectedAccountId(accountId);
    setSelectedCategoryId(null);
    setOpenDropdown(null);
  };
  const chooseKind = (next: Transaction['kind']) => {
    setKind(next);
    setSelectedCategoryId(null);
    setOpenDropdown(null);
  };
  const save = async () => {
    const parsed = Number(amount.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0 || !account) {
      Alert.alert(t('checkDetails'), t('requiredAmount'));
      return;
    }
    if (!category) {
      Alert.alert(t('chooseCategory'), kind === 'expense' ? t('noCategories') : t('error'));
      return;
    }
    const occurredAt = parseTransactionDateInput(entryDate);
    if (!occurredAt) {
      Alert.alert(t('checkDetails'), tr('Use YYYY-MM-DD format.'));
      return;
    }
    if (kind === 'transfer' && (!destinationAccount || destinationAccount.id === account.id)) {
      Alert.alert(t('checkDetails'), tr('Transfers need a different destination account.'));
      return;
    }
    const amountMinor = Math.round(parsed * 100);
    const accountLabel = account.kind === 'shared' ? t('household') : account.name;
    const destinationLabel = kind === 'transfer' ? `\n${t('account')}: ${destinationAccount?.name ?? '—'}` : '';
    const summary = `${t(kind === 'reversal' ? 'expense' : kind)}\n${t('amount')}: ${formatCurrency(amountMinor, state?.baseCurrency ?? 'USD', locale)}\n${t('account')}: ${accountLabel}${destinationLabel}\n${t('category')}: ${category.name}\n${tr('Date (YYYY-MM-DD)')}: ${entryDate}\n${t('manage')}: ${note.trim() || '—'}`;
    const commit = () => {
      setBusy(true);
      void addTransaction(
        kind, amountMinor, note, account.id, category.id,
        kind === 'transfer' ? destinationAccount?.id : undefined, occurredAt,
      )
        .then(() => router.replace('/(tabs)'))
        .catch((error) => {
          const message = error instanceof Error ? error.message : t('tryAgain');
          if (Platform.OS === 'web') globalThis.alert(`${t('error')}\n${message}`);
          else Alert.alert(t('error'), message);
        })
        .finally(() => setBusy(false));
    };
    if (Platform.OS === 'web') {
      if (globalThis.confirm(`${t('checkDetails')}\n${summary}`)) commit();
    } else {
      Alert.alert(t('checkDetails'), summary, [
        { text: t('cancel'), style: 'cancel' },
        { text: t('saveLedger'), onPress: commit },
      ]);
    }
  };
  return (
    <KeyboardAwareScrollViewCompat style={{ backgroundColor: c.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bottomOffset={20}>
      <Text style={[styles.heading, { color: c.foreground }]}>{t('newEntry')}</Text>
      <Text style={[styles.intro, { color: c.mutedForeground }]}>{online ? tr('Connected') : t('offline')} · {outbox.length ? tr('Changes pending') : t('synced')}</Text>
      <Card>
        <DropdownField
          label={kind === 'transfer' ? `${t('account')} ${tr('(from)')}` : t('account')}
          testID="account-dropdown"
          value={account?.kind === 'shared' ? tr('Shared household') : account?.name ?? ''}
          selectedId={account?.id}
          options={accounts.map((item) => ({
            id: item.id,
            label: item.kind === 'shared' ? tr('Shared household') : item.name,
            icon: item.kind === 'shared' ? 'users' : item.role === 'savings' ? 'archive' : 'user',
          }))}
          open={openDropdown === 'account'}
          onToggle={() => setOpenDropdown(openDropdown === 'account' ? null : 'account')}
          onSelect={chooseAccount}
          colors={c}
        />
        {kind === 'transfer' ? <DropdownField
          label={`${t('account')} ${tr('(to)')}`}
          testID="destination-account-dropdown"
          value={destinationAccount?.kind === 'shared' ? tr('Shared household') : destinationAccount?.name ?? ''}
          selectedId={destinationAccount?.id}
          options={destinationAccounts.map((item) => ({
            id: item.id,
            label: item.kind === 'shared' ? tr('Shared household') : item.name,
            icon: item.kind === 'shared' ? 'users' : item.role === 'savings' ? 'archive' : 'user',
          }))}
          open={openDropdown === 'destination'}
          onToggle={() => setOpenDropdown(openDropdown === 'destination' ? null : 'destination')}
          onSelect={(id) => { setSelectedDestinationAccountId(id); setOpenDropdown(null); }}
          colors={c}
        /> : null}
        <Text style={[styles.label, { color: c.mutedForeground }]}>{t('type')}</Text>
        <View style={styles.pills}>{(['expense', 'income', 'transfer'] as const).map((value) => <Pressable testID={`type-${value}`} key={value} onPress={() => chooseKind(value)} style={[styles.pill, { backgroundColor: kind === value ? c.primary : c.secondary }]}><Text style={{ color: kind === value ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{t(value)}</Text></Pressable>)}</View>
        {kind === 'expense' ? <>
          <View style={styles.labelRow}><Text style={[styles.label, { color: c.mutedForeground, marginBottom: 0 }]}>{t('category')}</Text><Pressable onPress={() => { setOpenDropdown(null); router.push('/categories' as never); }}><Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>{t('manage')}</Text></Pressable></View>
          <DropdownField
            label=""
            accessibilityLabel={t('category')}
            testID="category-dropdown"
            value={category?.name ?? ''}
            selectedId={category?.id}
            options={categories.map((item) => ({ id: item.id, label: item.name, color: item.color }))}
            open={openDropdown === 'category'}
            onToggle={() => setOpenDropdown(openDropdown === 'category' ? null : 'category')}
            onSelect={(id) => { setSelectedCategoryId(id); setOpenDropdown(null); }}
            emptyLabel={t('noCategories')}
            colors={c}
          />
        </> : null}
        <Field label={t('amount')} value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="numeric" testID="amount" />
        <Field label={tr('Description')} value={note} onChangeText={setNote} placeholder={tr('Groceries, rent, salary…')} testID="note" />
        <DatePickerField testID="transaction-date" value={entryDate} onPress={openDatePicker} />
        <Button label={busy ? `${t('save')}…` : t('saveLedger')} icon="check" onPress={() => void save()} disabled={busy} testID="save-transaction" />
      </Card>
      <DatePickerModal
        visible={calendarOpen}
        month={calendarMonth}
        selectedDate={entryDate}
        today={today}
        onMonthChange={setCalendarMonth}
        onClose={() => setCalendarOpen(false)}
        onSelect={(value) => { setDate(value); setCalendarOpen(false); }}
      />
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 120 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 30, marginBottom: 8 },
  intro: { lineHeight: 21, marginBottom: 20 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  dropdown: { marginBottom: 20 },
  dropdownLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  dropdownTrigger: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  dropdownValue: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  dropdownMenu: { maxHeight: 190, marginTop: 7, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  dropdownOption: { minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  dropdownDot: { width: 10, height: 10, borderRadius: 5 },
  pills: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  pill: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
});

type DropdownOption = { id: string; label: string; icon?: keyof typeof Feather.glyphMap; color?: string };

function DropdownField({
  label,
  accessibilityLabel,
  testID,
  value,
  selectedId,
  options,
  open,
  onToggle,
  onSelect,
  emptyLabel,
  colors,
}: {
  label: string;
  accessibilityLabel?: string;
  testID: string;
  value: string;
  selectedId?: string;
  options: DropdownOption[];
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  emptyLabel?: string;
  colors: ReturnType<typeof useColors>;
}) {
  const disabled = options.length === 0;
  return <View style={styles.dropdown}>
    {label ? <Text style={[styles.dropdownLabel, { color: colors.mutedForeground }]}>{label}</Text> : null}
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${accessibilityLabel ?? label}: ${value || emptyLabel || '—'}`}
      accessibilityState={{ disabled, expanded: open }}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => [styles.dropdownTrigger, { borderColor: colors.input, backgroundColor: colors.card, opacity: disabled ? 0.65 : pressed ? 0.8 : 1 }]}
    >
      <Text numberOfLines={1} style={[styles.dropdownValue, { color: colors.foreground }]}>{value || emptyLabel || '—'}</Text>
      <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
    </Pressable>
    {open ? <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={[styles.dropdownMenu, { borderColor: colors.border, backgroundColor: colors.card }]} showsVerticalScrollIndicator={options.length > 4}>
      {options.map((option) => {
        const selected = option.id === selectedId;
        return <Pressable
          key={option.id}
          testID={`${testID}-option-${option.id}`}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          onPress={() => onSelect(option.id)}
          style={({ pressed }) => [styles.dropdownOption, { borderBottomColor: colors.border, backgroundColor: pressed ? colors.secondary : colors.card }]}
        >
          {option.color ? <View style={[styles.dropdownDot, { backgroundColor: option.color }]} /> : option.icon ? <Feather name={option.icon} size={16} color={colors.mutedForeground} /> : null}
          <Text numberOfLines={1} style={[styles.dropdownValue, { color: colors.foreground }]}>{option.label}</Text>
          {selected ? <Feather name="check" size={16} color={colors.primary} /> : null}
        </Pressable>;
      })}
    </ScrollView> : null}
  </View>;
}
