import { Feather } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Button, Card, Field } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useLedger } from '@/lib/ledger-context';
import { formatCurrency, translateLiteral, useI18n } from '@/lib/i18n';

export default function PersonalAccounts() {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const { state, session, online, addSavingsAccount, editSavingsAccount } = useLedger();
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [busy, setBusy] = useState(false);
  const accounts = useMemo(
    () => (state?.accounts ?? []).filter((account) => account.ownerUserId === session?.user.id),
    [session?.user.id, state?.accounts],
  );
  const saveNew = async () => {
    if (!name.trim()) {
      Alert.alert(tr('Name your account'), tr('Enter a name such as Emergency fund or Holiday savings.'));
      return;
    }
    setBusy(true);
    try {
      await addSavingsAccount({ name: name.trim() });
      setName('');
    } catch (error) {
      Alert.alert(tr('Could not create account'), error instanceof Error ? error.message : tr('Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const saveEdit = async (accountId: string) => {
    if (!editingName.trim()) {
      Alert.alert(tr('Name your account'), tr('Enter a name before saving.'));
      return;
    }
    setBusy(true);
    try {
      await editSavingsAccount(accountId, { name: editingName.trim() });
      setEditingId(null);
    } catch (error) {
      Alert.alert(tr('Could not rename account'), error instanceof Error ? error.message : tr('Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const toggleArchive = (account: typeof accounts[number]) => {
    const nextArchived = !account.archived;
    Alert.alert(
      tr(nextArchived ? 'Archive this account?' : 'Restore this account?'),
      tr(nextArchived ? 'It will remain visible in history but cannot be used for new entries.' : 'It will be available for new entries again.'),
      [
        { text: tr('Cancel'), style: 'cancel' },
        { text: tr(nextArchived ? 'Archive' : 'Restore'), onPress: () => {
          setBusy(true);
          void editSavingsAccount(account.id, { archived: nextArchived })
            .catch((error) => Alert.alert(tr('Could not update account'), error instanceof Error ? error.message : tr('Try again.')))
            .finally(() => setBusy(false));
        } },
      ],
    );
  };
  return (
    <KeyboardAwareScrollViewCompat style={{ backgroundColor: c.background }} contentContainerStyle={styles.content} bottomOffset={70} keyboardShouldPersistTaps="handled">
      <Text style={[styles.heading, { color: c.foreground }]}>{tr('Personal accounts')}</Text>
      <Text style={[styles.intro, { color: c.mutedForeground }]}>{tr('Your main account and savings accounts are kept separate so every transfer remains auditable.')}</Text>
      <Card>
        <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('Add savings account')}</Text>
        <Field label={tr('Account name')} value={name} onChangeText={setName} placeholder={tr('Emergency fund')} testID="savings-account-name" />
        <Button label={busy ? tr('Saving…') : tr('Create savings account')} icon="plus" onPress={() => void saveNew()} disabled={busy || !online} testID="create-savings-account" />
      </Card>
      {accounts.map((account) => (
        <Card key={account.id} style={{ opacity: account.archived ? 0.65 : 1 }}>
          <View style={styles.accountHeader}>
            <View style={[styles.iconCircle, { backgroundColor: c.secondary }]}>
              <Feather name={account.role === 'savings' ? 'archive' : 'user'} size={18} color={c.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.foreground }]}>{account.name}</Text>
              <Text style={{ color: c.mutedForeground, marginTop: 3 }}>
                {tr(account.role === 'main' ? 'Main account' : account.archived ? 'Savings account · Archived' : 'Savings account')}
              </Text>
            </View>
          </View>
           {account.role === 'savings' ? (
             <View style={[styles.allocationBox, { backgroundColor: c.muted, borderColor: c.border }]}>
                <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 4 }}>{tr('Goal allocations')}</Text>
                <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>{tr('Balance is the real account total. Allocated amounts are attributed to goals; unallocated money has no goal yet.')}</Text>
               <View style={styles.allocationSummary}>
                  <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{tr('Allocated')}</Text>
                  <Text style={{ color: c.foreground, fontFamily: 'Inter_700Bold' }}>{formatCurrency(account.allocatedMinor ?? 0, state?.baseCurrency ?? 'USD', locale)}</Text>
                  <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{tr('Unallocated')}</Text>
                  <Text style={{ color: c.primary, fontFamily: 'Inter_700Bold' }}>{formatCurrency(account.unallocatedMinor ?? 0, state?.baseCurrency ?? 'USD', locale)}</Text>
               </View>
               {(account.allocations ?? []).length ? (account.allocations ?? []).map((allocation) => (
                 <View key={allocation.goalId} style={[styles.allocationRow, { borderTopColor: c.border }]}>
                   <Text style={{ color: c.foreground, flex: 1 }} numberOfLines={1}>{allocation.goalName}</Text>
                    <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>{formatCurrency(allocation.amountMinor, state?.baseCurrency ?? 'USD', locale)}</Text>
                 </View>
               )) : <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{tr('No active goal allocations yet.')}</Text>}
             </View>
           ) : null}
          {account.role === 'main' ? (
            <Text style={{ color: c.mutedForeground, lineHeight: 19 }}>{tr('Your main account cannot be archived.')}</Text>
          ) : editingId === account.id ? (
            <>
              <Field label={tr('New name')} value={editingName} onChangeText={setEditingName} testID={`rename-savings-account-${account.id}`} />
              <View style={styles.actions}>
                <Button label={tr('Save name')} icon="check" onPress={() => void saveEdit(account.id)} disabled={busy} />
                <Button label={tr('Cancel')} secondary onPress={() => setEditingId(null)} disabled={busy} />
              </View>
            </>
          ) : (
            <View style={styles.actions}>
              <Button label={tr('Rename')} icon="edit-2" onPress={() => { setEditingId(account.id); setEditingName(account.name); }} secondary testID={`rename-account-${account.id}`} />
              <Button label={tr(account.archived ? 'Restore' : 'Archive')} icon={account.archived ? 'rotate-ccw' : 'archive'} onPress={() => toggleArchive(account)} secondary disabled={busy} testID={`${account.archived ? 'restore' : 'archive'}-account-${account.id}`} />
            </View>
          )}
        </Card>
      ))}
      {accounts.length === 0 ? <Card><Text style={[styles.title, { color: c.foreground }]}>{tr('No personal account yet')}</Text><Text style={{ color: c.mutedForeground, marginTop: 5 }}>{tr('Pair this device with a household to manage accounts.')}</Text></Card> : null}
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 80, gap: 14 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 30 },
  intro: { lineHeight: 21 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  accountHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  iconCircle: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  actions: { flexDirection: 'row', gap: 8 },
  allocationBox: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginBottom: 14 },
  allocationSummary: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  allocationRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, marginTop: 8, flexDirection: 'row', alignItems: 'center' },
});