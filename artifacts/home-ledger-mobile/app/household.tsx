import { Feather } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import React from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Button, Card, SectionTitle } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { HouseholdInvitations } from '@/components/HouseholdInvitations';
import { useLedger } from '@/lib/ledger-context';
import { translateLiteral, useI18n } from '@/lib/i18n';

export default function Household() {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const { state, session, online, updateAllocations, transferMaster, removeMember } = useLedger();
  const canManage = session?.user.role === 'master';
  const [shares, setShares] = React.useState<Record<string, string>>(() =>
    Object.fromEntries((state?.users ?? []).map((user) => [user.id, String(user.defaultShareBps / 100)])),
  );
  const [busy, setBusy] = React.useState(false);
  const parsed = (state?.users ?? []).map((user) => ({
    userId: user.id,
    basisPoints: Math.round(Number(shares[user.id] ?? '') * 100),
  }));
  const total = parsed.reduce((sum, allocation) => sum + (Number.isFinite(allocation.basisPoints) ? allocation.basisPoints : 0), 0);
  const valid = parsed.every((allocation) => Number.isInteger(allocation.basisPoints) && allocation.basisPoints >= 0 && allocation.basisPoints <= 10000) && total === 10000;

  const save = async () => {
    if (!valid) {
      Alert.alert(tr('Check the percentages'), tr('Each percentage must be between 0 and 100, and the total must equal 100%.'));
      return;
    }
    setBusy(true);
    try {
      await updateAllocations(parsed);
      Alert.alert(tr('Allocations saved'), tr('New shared expenses will use these percentages. Existing transactions were not changed.'));
    } catch (error) {
      Alert.alert(tr('Could not save'), error instanceof Error ? error.message : tr('Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = (userId: string, displayName: string) => Alert.alert(
    `${tr('Remove')} ${displayName}?`,
    tr('All of this member’s paired devices will be revoked immediately. Their past transaction history will remain.'),
    [
      { text: tr('Cancel'), style: 'cancel' },
      {
        text: tr('Remove access'),
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void removeMember(userId)
            .then(() => Alert.alert(tr('Access removed'), `${displayName} ${tr('can no longer use this household.')}`))
            .catch((error) => Alert.alert(tr('Could not remove member'), error instanceof Error ? error.message : tr('Try again.')))
            .finally(() => setBusy(false));
        },
      },
    ],
  );

  const confirmTransfer = (userId: string, displayName: string) => Alert.alert(
    `${tr('Make')} ${displayName} ${tr('the master?')}`,
    `${tr('You will become a regular member immediately.')} ${displayName} ${tr('will be the only person who can manage household access and allocations.')}`,
    [
      { text: tr('Cancel'), style: 'cancel' },
      {
        text: tr('Transfer master role'),
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void transferMaster(userId)
            .then(() => Alert.alert(tr('Master role transferred'), `${displayName} ${tr('is now the household master.')}`))
            .catch((error) => Alert.alert(tr('Could not transfer role'), error instanceof Error ? error.message : tr('Try again.')))
            .finally(() => setBusy(false));
        },
      },
    ],
  );
  return (
    <>
      <Stack.Screen options={{ title: tr('Household') }} />
      <KeyboardAwareScrollViewCompat style={{ backgroundColor: c.background }} contentContainerStyle={styles.content} bottomOffset={20} keyboardShouldPersistTaps="handled">
        <Text style={[styles.heading, { color: c.foreground }]}>{tr('Household access')}</Text>
        <Text style={[styles.intro, { color: c.mutedForeground }]}>
          {canManage ? tr('Set how new shared expenses are divided and manage member access.') : tr('You can view household members, allocations, and paired devices. Only the master can make changes.')}
        </Text>
        <SectionTitle>{tr('Members and allocations')}</SectionTitle>
        <Card>
          {state?.users.map((user) => {
            const devices = state.devices.filter((device) => device.userId === user.id);
            const deviceGroups = [...devices.reduce((groups, device) => {
              const name = device.name.trim() || tr('Unnamed device');
              const current = groups.get(name);
              if (current) {
                current.count += 1;
                if (device.lastSeenAt > current.lastSeenAt) {
                  current.latest = device;
                  current.lastSeenAt = device.lastSeenAt;
                }
              } else {
                groups.set(name, { name, count: 1, latest: device, lastSeenAt: device.lastSeenAt });
              }
              return groups;
            }, new Map<string, { name: string; count: number; latest: typeof devices[number]; lastSeenAt: string }>()).values()];
            return (
              <View key={user.id} style={[styles.member, { borderBottomColor: c.border }]}>
                <View style={styles.memberHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.memberName, { color: c.foreground }]}>{user.displayName}{user.id === session?.user.id ? ` (${tr('you')})` : ''}</Text>
                    <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{tr(user.role === 'master' ? 'Master' : 'Member')}</Text>
                  </View>
                  {canManage ? (
                    <View style={styles.shareInput}>
                      <TextInput
                        testID={`allocation-${user.id}`}
                        value={shares[user.id] ?? ''}
                        onChangeText={(value) => setShares((current) => ({ ...current, [user.id]: value.replace(/[^0-9.]/g, '') }))}
                        keyboardType="decimal-pad"
                        editable={!busy}
                        style={[styles.input, { color: c.foreground, borderColor: c.input, backgroundColor: c.background }]}
                      />
                      <Text style={{ color: c.mutedForeground }}>%</Text>
                    </View>
                  ) : <Text style={[styles.percent, { color: c.foreground }]}>{user.defaultShareBps / 100}%</Text>}
                </View>
                <View style={styles.devices}>
                  {deviceGroups.length ? deviceGroups.map((group) => (
                    <View key={group.name} style={styles.device}>
                      <Feather name={group.latest.revoked ? 'slash' : 'smartphone'} size={14} color={group.latest.revoked ? c.destructive : c.mutedForeground} />
                        <Text style={{ color: c.mutedForeground, flex: 1, fontSize: 12 }}>{group.name}{group.count > 1 ? ` · ${group.count} ${tr('sessions')}` : ''}{group.latest.revoked ? ` · ${tr('revoked')}` : ''}</Text>
                    </View>
                  )) : <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{tr('No paired devices')}</Text>}
                </View>
                {canManage && user.role !== 'master' ? (
                  <View style={styles.memberActions}>
                    <Pressable testID={`transfer-master-${user.id}`} disabled={busy || !online} onPress={() => confirmTransfer(user.id, user.displayName)} style={styles.action}>
                      <Feather name="key" size={15} color={c.primary} />
                      <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold' }}>{tr('Make master')}</Text>
                    </Pressable>
                    <Pressable testID={`remove-member-${user.id}`} disabled={busy || !online} onPress={() => confirmRemove(user.id, user.displayName)} style={styles.action}>
                      <Feather name="user-x" size={15} color={c.destructive} />
                      <Text style={{ color: c.destructive, fontFamily: 'Inter_600SemiBold' }}>{tr('Remove access')}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
          {canManage ? (
            <>
              <View style={styles.total}>
                <Text style={{ color: c.mutedForeground }}>{tr('Total')}</Text>
                <Text style={[styles.totalValue, { color: total === 10000 ? c.primary : c.destructive }]}>{total / 100}%</Text>
              </View>
              <Button label={busy ? tr('Saving…') : tr('Save allocations')} icon="check" onPress={() => void save()} disabled={busy || !online || !valid} testID="save-allocations" />
            </>
          ) : null}
        </Card>
        <HouseholdInvitations key={`${session?.user.id}:${session?.deviceId}`} />
      </KeyboardAwareScrollViewCompat>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 50, gap: 14 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 28 },
  intro: { lineHeight: 21, marginBottom: 8 },
  member: { paddingVertical: 14, borderBottomWidth: 1, gap: 10 },
  memberHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  memberName: { fontFamily: 'Inter_700Bold', fontSize: 16, marginBottom: 3 },
  shareInput: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { width: 74, minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, textAlign: 'right', fontFamily: 'Inter_600SemiBold' },
  percent: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  devices: { gap: 7 },
  device: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  memberActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4 },
  total: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 15 },
  totalValue: { fontFamily: 'Inter_700Bold', fontSize: 17 },
});