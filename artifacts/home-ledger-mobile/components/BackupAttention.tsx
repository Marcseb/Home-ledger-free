import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useGetBackupStatus } from '@workspace/api-client-react';
import { Link, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useLedger } from '@/lib/ledger-context';
import { translateLiteral, useI18n } from '@/lib/i18n';
import { backupProblemMessage, updateBackupAlarm, type BackupAlarm } from '@/lib/backup-attention';

export function BackupAttention() {
  const { session, state } = useLedger();
  if (!session || !state || session.user.role !== 'master') return null;
  const scope = JSON.stringify([session.serverScope ?? session.serverAddress, state.groupId, session.user.id]);
  return <ScopedBackupAttention key={scope} storageKey={`home-ledger.backup-attention:${scope}`} />;
}

function ScopedBackupAttention({ storageKey }: { storageKey: string }) {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (text: string) => translateLiteral(text, locale);
  const { session, online } = useLedger();
  const [alarm, setAlarm] = useState<BackupAlarm | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [details, setDetails] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const writes = useRef(Promise.resolve());
  const backup = useGetBackupStatus({
    query: { queryKey: ['/api/backups/status', session?.token], enabled: online, refetchInterval: 60_000, retry: false },
    request: { headers: { 'x-device-token': session?.token ?? '' }, timeoutMs: 15_000 },
  });
  const refetch = useRef(backup.refetch);
  refetch.current = backup.refetch;
  useFocusEffect(useCallback(() => {
    if (online) void refetch.current();
  }, [online]));
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active' && online) void refetch.current();
    });
    return () => listener.remove();
  }, [online]);
  useEffect(() => {
    let current = true;
    void AsyncStorage.getItem(storageKey).then((saved) => {
      if (!current) return;
      if (saved) {
        const parsed = JSON.parse(saved) as BackupAlarm;
        if (!(parsed.problem in backupProblemMessage) || typeof parsed.acknowledged !== 'boolean') throw new Error('Invalid backup reminder');
        setAlarm(parsed);
      }
      setLoaded(true);
    }).catch(() => { if (current) { setStorageError(true); setLoaded(true); } });
    return () => { current = false; };
  }, [storageKey]);
  useEffect(() => {
    if (loaded) setAlarm((previous) => updateBackupAlarm(previous, online && !backup.isError ? backup.data ?? null : null));
  }, [loaded, online, backup.isError, backup.data]);
  useEffect(() => {
    if (!loaded) return;
    writes.current = writes.current.then(async () => {
      if (alarm) await AsyncStorage.setItem(storageKey, JSON.stringify(alarm));
      else await AsyncStorage.removeItem(storageKey);
      setStorageError(false);
    }).catch(() => { setStorageError(true); });
  }, [alarm, loaded, storageKey]);

  const acknowledge = () => {
    setAlarm((previous) => previous ? { ...previous, acknowledged: true } : null);
    setDetails(false);
  };
  if (backup.data?.reviewDemo) return null;
  const lastSuccessfulAt = online && !backup.isError ? backup.data?.lastSuccessfulAt ?? alarm?.lastSuccessfulAt : alarm?.lastSuccessfulAt;
  const body = alarm ? <>
    <Text style={{ color: c.foreground, lineHeight: 21 }}>{tr(backupProblemMessage[alarm.problem])}</Text>
    <Text style={{ color: c.mutedForeground, fontSize: 12 }}>
      {lastSuccessfulAt
        ? `${tr('Last successful server backup: ')}${new Date(lastSuccessfulAt).toLocaleString(locale)}`
        : tr('Last successful server backup: none recorded')}
    </Text>
    {!online ? <Text style={{ color: c.mutedForeground }}>{tr('Backup status cannot be checked while offline.')}</Text> : null}
    <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{tr('The reminder clears after a new successful server backup.')}</Text>
    <Link href={{ pathname: '/settings', params: { backup: '1' } }} asChild>
      <Pressable testID="open-backup-settings" accessibilityRole="link" onPress={() => setDetails(false)} style={{ paddingVertical: 12, flexDirection: 'row', gap: 8 }}>
        <Text style={{ color: c.primary, fontFamily: 'Inter_700Bold' }}>{tr('Review backup settings')}</Text>
        <Feather name="arrow-right" size={18} color={c.primary} />
      </Pressable>
    </Link>
  </> : null;

  if (!loaded) return null;
  return <>
    {alarm ? <View style={{ alignItems: 'flex-end' }}>
      <Pressable testID="backup-alarm-bell" accessibilityRole="button" accessibilityLabel={tr('Server backups need attention')} onPress={() => setDetails(true)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="bell" size={24} color={c.destructive} />
        <View style={{ position: 'absolute', top: 8, right: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: c.destructive }} />
      </Pressable>
    </View> : null}
    {alarm && !alarm.acknowledged ? <View testID="automatic-backup-warning" accessibilityLiveRegion="polite" style={{ padding: 16, borderWidth: 1, borderColor: c.destructive, borderRadius: 20, backgroundColor: c.card, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Feather name="alert-triangle" size={20} color={c.destructive} />
        <Text style={{ flex: 1, color: c.foreground, fontFamily: 'Inter_700Bold' }}>{tr('Server backups need attention')}</Text>
        <Pressable testID="dismiss-backup-warning" accessibilityRole="button" accessibilityLabel={tr('Dismiss backup warning')} onPress={acknowledge} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="x" size={22} color={c.foreground} />
        </Pressable>
      </View>
      {body}
    </View> : null}
    {online && backup.isError ? <Text accessibilityLiveRegion="polite" style={{ color: c.mutedForeground, fontSize: 12 }}>{tr('Backup status could not be checked. Retrying automatically.')}</Text> : null}
    {storageError ? <Text style={{ color: c.destructive }}>{tr('Could not save the backup reminder on this device.')}</Text> : null}
    <Modal visible={details && !!alarm} transparent animationType="fade" onRequestClose={() => setDetails(false)}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: c.background }}>
        <View style={{ padding: 20, backgroundColor: c.card, borderRadius: 20, gap: 12 }}>
          <Text style={{ color: c.foreground, fontFamily: 'Inter_700Bold', fontSize: 18 }}>{tr('Server backups need attention')}</Text>
          {body}
          <Pressable accessibilityRole="button" onPress={acknowledge} style={{ padding: 14, alignItems: 'center' }}>
            <Text style={{ color: c.primary, fontFamily: 'Inter_700Bold' }}>{tr('Close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  </>;
}
