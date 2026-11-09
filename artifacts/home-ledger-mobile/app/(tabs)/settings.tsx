import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ServerConnectionControls } from '@/components/ServerConnectionControls';
import { Alert, AppState, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Field, SectionTitle } from '@/components/Ui';
import { ContextHelp } from '@/components/HelpButton';
import { PendingChangesReview } from '@/components/PendingChangesReview';
import { useColors } from '@/hooks/useColors';
import { useLedger } from '@/lib/ledger-context';
import { isAcceleratedTestBuild } from '@/lib/app-time';
import { translateLiteral, useI18n, type Locale } from '@/lib/i18n';
import { saveFileToAndroidFolder } from '@/lib/file-export';
import { getBackupStatus, saveBackupToServer } from '@workspace/api-client-react';
import type { BackupStatus } from '@workspace/api-client-react';
import { File, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { buildTransactionCsv } from '@/lib/transaction-export';
import { AppLockSettingsSection } from '@/components/AppLockSettingsSection';

export default function Settings() {
  const c = useColors();
  const router = useRouter();
  const { backup } = useLocalSearchParams<{ backup?: string }>();
  const scrollRef = React.useRef<ScrollView>(null);
  const backupY = React.useRef<number | null>(null);
  const { online, outbox, state, session, resetLedger, reinitializeHousehold, sync, logout, advanceBusinessTime, quarantinedOutbox, acknowledgeQuarantinedOutbox } = useLedger();
  const canResetLedger = session?.user.role === 'master';
  const { t, locale, setLocale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const canUseTestClock = isAcceleratedTestBuild && state?.acceleratedTest === true && session?.user.role === 'master';
  const [clockBusy, setClockBusy] = React.useState(false);
  const [reinitOpen, setReinitOpen] = React.useState(false);
  const [reinitBusy, setReinitBusy] = React.useState(false);
  const [reinitName, setReinitName] = React.useState('');
  const [reinitMaster, setReinitMaster] = React.useState('');
  const [reinitCurrency, setReinitCurrency] = React.useState<'EUR' | 'USD' | 'GBP'>('EUR');
  const [reinitConfirmation, setReinitConfirmation] = React.useState('');
  const [backupStatus, setBackupStatus] = React.useState<BackupStatus | null>(null);
  const [backupStatusError, setBackupStatusError] = React.useState('');
  const [backupStatusBusy, setBackupStatusBusy] = React.useState(false);
  const [backupExportBusy, setBackupExportBusy] = React.useState(false);
  const [csvExportBusy, setCsvExportBusy] = React.useState(false);
  const [serverBackupBusy, setServerBackupBusy] = React.useState(false);
  const [serverBackupResult, setServerBackupResult] = React.useState<{ message: string; failed: boolean } | null>(null);
  const sessionToken = session?.token;
  const sessionRole = session?.user.role;
  const sessionTokenRef = React.useRef(sessionToken);
  const statusRequestToken = React.useRef<string | null>(null);
  const backupScrollHandled = React.useRef(false);
  sessionTokenRef.current = sessionToken;
  const signOut = async () => {
    try {
      await logout();
      router.replace('/pair' as never);
    } catch {
      // The provider reports storage errors; stay here so sign-out can be retried.
    }
  };
  const confirmResetLedger = () => {
    if (!canResetLedger) return;
    Alert.alert(
      tr('Reset ledger?'),
      tr('This removes all transactions, recurring entries, budgets, and savings goals for every paired device. Household members and pairing stay intact.'),
      [
        { text: tr('Cancel'), style: 'cancel' },
        { text: t('resetLedger'), style: 'destructive', onPress: () => void resetLedger().catch((error) => Alert.alert(tr('Could not reset ledger'), error instanceof Error ? error.message : t('tryAgain'))) },
      ],
    );
  };
  const advanceClock = async (unit: 'day' | 'week' | 'month') => {
    setClockBusy(true);
    try {
      await advanceBusinessTime(unit);
    } catch (error) {
      Alert.alert(tr('Could not advance test time'), error instanceof Error ? error.message : t('tryAgain'));
    } finally {
      setClockBusy(false);
    }
  };
  const submitReinitialize = async () => {
    if (reinitConfirmation !== 'REINITIALIZE HOUSEHOLD' || !reinitName.trim() || !reinitMaster.trim()) return;
    setReinitBusy(true);
    try {
      await reinitializeHousehold({ householdName: reinitName.trim(), displayName: reinitMaster.trim(), currency: reinitCurrency });
      setReinitOpen(false); setReinitConfirmation(''); setReinitName(''); setReinitMaster('');
    } catch (error) {
      Alert.alert(tr('Could not reinitialize household'), error instanceof Error ? error.message : t('tryAgain'));
    } finally { setReinitBusy(false); }
  };
  const refreshBackupStatus = React.useCallback(async () => {
    if (!sessionToken || sessionRole !== 'master' || statusRequestToken.current === sessionToken) return;
    const token = sessionToken;
    statusRequestToken.current = token;
    setBackupStatusBusy(true);
    setBackupStatusError('');
    try {
      const result = await getBackupStatus({ headers: { 'x-device-token': token } });
      if (sessionTokenRef.current === token) setBackupStatus(result);
    } catch (error) {
      if (sessionTokenRef.current === token) setBackupStatusError(error instanceof Error ? error.message : tr('Could not load backup status.'));
    } finally {
      if (statusRequestToken.current === token) statusRequestToken.current = null;
      if (sessionTokenRef.current === token) setBackupStatusBusy(false);
    }
  }, [sessionToken, sessionRole, locale]);
  React.useEffect(() => {
    setBackupStatus(null);
    setBackupStatusError('');
    setBackupStatusBusy(false);
    setServerBackupResult(null);
  }, [sessionToken]);
  useFocusEffect(React.useCallback(() => {
    if (sessionRole === 'master') void refreshBackupStatus();
    if (backup === '1' && sessionRole === 'master' && backupY.current !== null && !backupScrollHandled.current) {
      backupScrollHandled.current = true;
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: backupY.current ?? 0, animated: false }));
    }
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active' && sessionRole === 'master') void refreshBackupStatus();
    });
    return () => { listener.remove(); backupScrollHandled.current = false; };
  }, [backup, refreshBackupStatus, sessionRole]));
  const saveOnServerMount = async () => {
    if (!sessionToken || sessionRole !== 'master' || serverBackupBusy) return;
    const token = sessionToken;
    setServerBackupBusy(true);
    setServerBackupResult(null);
    try {
      const result = await saveBackupToServer({ headers: { 'x-device-token': token } });
      if (sessionTokenRef.current === token) {
        setServerBackupResult({
          message: `${tr('Encrypted backup saved on the server’s configured mount at ')}${new Date(result.savedAt).toLocaleString(locale)}. ${tr('Verify that the configured mount is your USB/NAS drive.')}`,
          failed: false,
        });
      }
    } catch (error) {
      if (sessionTokenRef.current === token) {
        setServerBackupResult({
          message: `${tr('Could not save on the server mount: ')}${error instanceof Error ? error.message : t('tryAgain')}`,
          failed: true,
        });
      }
    } finally {
      if (sessionTokenRef.current === token) {
        setServerBackupBusy(false);
        void refreshBackupStatus();
      }
    }
  };
  const saveEncryptedBackup = async () => {
    if (!session || session.user.role !== 'master') return;
    setBackupExportBusy(true);
    try {
      const serverAddress = session.serverAddress.startsWith('http') ? session.serverAddress : `http://${session.serverAddress}`;
      const response = await fetch(`${serverAddress.replace(/\/+$/, '')}/api/backups/export`, {
        method: 'POST',
        headers: { 'x-device-token': session.token, Accept: 'application/octet-stream' },
      });
      if (!response.ok) {
        const detail = (await response.text()).trim();
        throw new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status} ${response.statusText}`);
      }
      const bytes = await response.arrayBuffer();
      const filename = `home-ledger-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.hlbackup`;
      if (Platform.OS === 'web') {
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        Alert.alert(tr('Download started'), tr('Check your browser downloads, then move the encrypted backup off this PC. Home Ledger cannot verify where it is stored.'));
      } else if (Platform.OS === 'android') {
        const permission = await LegacyFileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permission.granted) return;
        const file = new File(Paths.cache, filename);
        file.create({ overwrite: true });
        try {
          file.write(new Uint8Array(bytes));
          const destination = await LegacyFileSystem.StorageAccessFramework.createFileAsync(
            permission.directoryUri, filename, 'application/octet-stream',
          );
          try {
            await LegacyFileSystem.StorageAccessFramework.writeAsStringAsync(
              destination, await file.base64(), { encoding: LegacyFileSystem.EncodingType.Base64 },
            );
            const [source, saved] = await Promise.all([
              LegacyFileSystem.getInfoAsync(file.uri, { md5: true }),
              LegacyFileSystem.getInfoAsync(destination, { md5: true }),
            ]);
            if (!source.exists || !saved.exists || source.size !== bytes.byteLength
              || !source.md5 || source.md5 !== saved.md5) {
              throw new Error(tr('Backup could not be verified in the selected folder.'));
            }
          } catch (error) {
            await LegacyFileSystem.StorageAccessFramework.deleteAsync(destination, { idempotent: true }).catch(() => {});
            throw error;
          }
        } finally {
          try { file.delete(); } catch { /* The temporary archive is encrypted and may be cleared by the OS. */ }
        }
        Alert.alert(tr('Backup saved on this device'), tr('Check the selected folder for the .hlbackup file. To put it on a USB drive connected to your PC, transfer the file from this device first.'));
      } else {
        const file = new File(Paths.cache, filename);
        file.create({ overwrite: true });
        file.write(new Uint8Array(bytes));
        if (!(await Sharing.isAvailableAsync())) throw new Error(tr('Sharing is not available on this device.'));
        await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', dialogTitle: tr('Save encrypted backup'), UTI: 'public.data' });
        Alert.alert(tr('Share sheet closed'), tr('Home Ledger cannot confirm whether or where you saved the backup. Verify that the .hlbackup file is stored off this PC.'));
      }
      await refreshBackupStatus();
    } catch (error) {
      Alert.alert(tr('Could not export backup'), error instanceof Error ? error.message : t('tryAgain'));
    } finally {
      setBackupExportBusy(false);
    }
  };
  const exportTransactionsCsv = async (destination: 'share' | 'folder' = 'share') => {
    if (!session || !state || csvExportBusy) return;
    setCsvExportBusy(true);
    try {
      const csv = buildTransactionCsv({
        transactions: state.transactions,
        accounts: state.accounts,
        categories: state.categories,
        users: state.users,
      });
      const filename = `home-ledger-transactions-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const file = new File(Paths.cache, filename);
        file.create({ overwrite: true });
        file.write(csv);
        if (Platform.OS === 'android' && destination === 'folder') {
          const saved = await saveFileToAndroidFolder(
            file,
            filename,
            'text/csv',
            tr('The file could not be verified in the selected folder.'),
          );
          if (saved) Alert.alert(tr('File saved'), tr('The file was verified in the selected folder.'));
        } else {
          if (!(await Sharing.isAvailableAsync())) throw new Error(tr('Sharing is not available on this device.'));
          await Sharing.shareAsync(file.uri, {
            mimeType: 'text/csv',
            dialogTitle: tr('Export transactions (CSV)'),
            UTI: 'public.comma-separated-values-text',
          });
        }
      }
    } catch (error) {
      Alert.alert(tr('Could not export CSV'), error instanceof Error ? error.message : t('tryAgain'));
    } finally {
      setCsvExportBusy(false);
    }
  };
  const requestCsvExport = () => {
    if (Platform.OS !== 'android') {
      void exportTransactionsCsv('share');
      return;
    }
    Alert.alert(tr('Save or share CSV'), tr('Choose Save to folder to select Downloads, or Share file to send the CSV to another app.'), [
      { text: tr('Save to folder'), onPress: () => void exportTransactionsCsv('folder') },
      { text: tr('Share file'), onPress: () => void exportTransactionsCsv('share') },
      { text: tr('Cancel'), style: 'cancel' },
    ]);
  };
  const backupReadiness = () => {
    if (backupStatusBusy && !backupStatus) return tr('Checking backup readiness…');
    if (backupStatusError) return backupStatusError;
    if (!backupStatus) return tr('Backup status is not available.');
    if (!backupStatus.enrolled) return tr('Recovery enrollment is needed on the server.');
    if (!backupStatus.destinationConfigured) return tr('Backup destination is not configured on the server.');
    if (!backupStatus.destinationAvailable) return tr('Configured backup destination is unavailable.');
    if (backupStatus.lastError) return `${tr('Last backup failed: ')}${backupStatus.lastError}`;
    if (backupStatus.lastSuccessfulAt) return `${tr('Last successful backup: ')}${new Date(backupStatus.lastSuccessfulAt).toLocaleString(locale)}`;
    return tr('Destination is ready; no successful backup is recorded yet.');
  };

  return (
    <ScrollView ref={scrollRef} style={{ backgroundColor: c.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.heading, { color: c.foreground }]}>{t('settings')}</Text>
      <Card>
        <Text style={[styles.title, { color: c.foreground }]}>{t('language')}</Text>
        <View style={styles.languageRow}>
          {([
            ['en', t('english')],
            ['fr', t('french')],
            ['it', t('italian')],
          ] as [Locale, string][]).map(([value, label]) => (
            <Button key={value} label={label} secondary={locale !== value} onPress={() => void setLocale(value)} testID={`language-${value}`} />
          ))}
        </View>
      </Card>
      <Card>
        <View style={styles.statusRow}>
          <View style={[styles.iconCircle, { backgroundColor: online ? c.secondary : c.muted }]}>
            <Feather name={online ? 'wifi' : 'wifi-off'} color={online ? c.primary : c.tint} size={20} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: c.foreground }]}>{online ? t('connected') : t('offline')}</Text>
            <Text style={{ color: c.mutedForeground, marginTop: 3 }}>{outbox.length ? t('changesWaiting', outbox.length) : t('synced')}</Text>
          </View>
        </View>
        <Button label={t('syncNow')} icon="refresh-cw" onPress={() => void sync(true)} secondary />
        <ServerConnectionControls />
      </Card>
      {canUseTestClock ? <Card>
        <Text style={[styles.title, { color: c.foreground }]}>{tr('Accelerated test time')}</Text>
        <Text style={[styles.description, { color: c.mutedForeground }]}>{tr('Business dates are simulated for this private test build. Authentication still uses real time.')}</Text>
        <Text accessibilityLabel={tr('Simulated current date and time')} style={[styles.clock, { color: c.primary }]}>{new Date(state.serverNow).toLocaleString(locale)}</Text>
        <View style={styles.clockActions}>
          <Button label={tr('Advance 1 day')} icon="chevron-right" onPress={() => void advanceClock('day')} disabled={clockBusy} secondary testID="advance-test-clock-day" accessibilityLabel={tr('Advance simulated time by one day')} />
          <Button label={tr('Advance 1 week')} icon="chevron-right" onPress={() => void advanceClock('week')} disabled={clockBusy} secondary testID="advance-test-clock-week" accessibilityLabel={tr('Advance simulated time by one week')} />
          <Button label={tr('Advance 1 month')} icon="chevron-right" onPress={() => void advanceClock('month')} disabled={clockBusy} secondary testID="advance-test-clock-month" accessibilityLabel={tr('Advance simulated time by one month')} />
        </View>
      </Card> : null}

      <SectionTitle>{tr('Categories')}</SectionTitle>
      <Card>
        <Text style={[styles.title, { color: c.foreground }]}>{tr('Personal accounts')}</Text>
        <Text style={[styles.description, { color: c.mutedForeground }]}>{tr('Create and organize separate savings accounts for your personal plans.')}</Text>
        <Button label={tr('Manage personal accounts')} icon="briefcase" onPress={() => router.push('/accounts' as never)} testID="manage-personal-accounts" />
      </Card>
      <Card>
        <Text style={[styles.title, { color: c.foreground }]}>{tr('Expense categories')}</Text>
        <Text style={[styles.description, { color: c.mutedForeground }]}>
          {session?.user.role === 'master' ? tr('Create shared household categories or manage your personal ones.') : tr('Create and manage categories for your personal account.')}
        </Text>
        <Button label={tr('Manage categories')} icon="tag" onPress={() => router.push('/categories' as never)} />
      </Card>

      <SectionTitle>{tr('Automation')}</SectionTitle>
      <Card>
        <Text style={[styles.title, { color: c.foreground }]}>{tr('Category budgets')}</Text>
        <Text style={[styles.description, { color: c.mutedForeground }]}>{tr('Track monthly category limits and get in-app warnings as spending approaches the limit.')}</Text>
        <Button label={tr('Manage budgets')} icon="pie-chart" onPress={() => router.push('/budgets' as never)} testID="manage-budgets" />
      </Card>
      <Card>
        <Text style={[styles.title, { color: c.foreground }]}>{t('recurring')}</Text>
        <Text style={[styles.description, { color: c.mutedForeground }]}>{tr('Schedule bills and income. Your household server creates each due transaction once.')}</Text>
        <Button label={tr('Manage recurring entries')} icon="repeat" onPress={() => router.push('/recurring' as never)} />
      </Card>

      <SectionTitle>{tr('App security')}</SectionTitle>
      <AppLockSettingsSection />

      <SectionTitle>{tr('Access')}</SectionTitle>
      <Card>
        <View style={styles.identityRow}>
          <View style={[styles.avatar, { backgroundColor: c.secondary }]}><Text style={[styles.avatarText, { color: c.secondaryForeground }]}>{session?.user.displayName?.slice(0, 2).toUpperCase() || tr('ME')}</Text></View>
          <View>
            <Text style={[styles.title, { color: c.foreground }]}>{session?.user.displayName || tr('Paired user')}</Text>
            <Text style={{ color: c.mutedForeground }}>{session?.user.role === 'master' ? tr('Master user') : tr('Household member')}</Text>
          </View>
        </View>
        <Button label={t('household')} icon="users" onPress={() => router.push('/household' as never)} />
      </Card>

      <SectionTitle>{tr('Data')}</SectionTitle>
      <Card>
        <Text style={[styles.title, { color: c.foreground }]}>{tr('Export transactions (CSV)')}</Text>
        <Text style={[styles.description, { color: c.mutedForeground }]}>{tr('Exports the ledger entries currently stored on this device, including their status and audit details. Sync first if you need the latest household activity.')}</Text>
        <Text style={[styles.warning, { color: c.destructive }]}>{tr('CSV is plain text, not encrypted. It contains only records and account details visible to this signed-in user. Store and share it carefully.')}</Text>
        {Platform.OS === 'android' ? <Text style={[styles.description, { color: c.mutedForeground }]}>{tr('On Android, choose Save to folder, then select Downloads.')}</Text> : null}
        <Button label={csvExportBusy ? tr('Preparing CSV…') : tr('Export CSV')} icon="download" onPress={requestCsvExport} disabled={csvExportBusy || !session || !state} testID="export-transactions-csv" />
      </Card>
      {canResetLedger && backupStatus?.reviewDemo ? <Card>
        <Text style={[styles.title, { color: c.foreground }]}>{tr('Hosted reviewer demo')}</Text>
        <Text style={[styles.description, { color: c.mutedForeground }]}>This is a shared fictional household. Do not enter private information. Encrypted recovery files and USB/NAS backups are available on your own local Home Ledger server, not on this review service.</Text>
      </Card> : null}
      {canResetLedger && !backupStatus?.reviewDemo ? <View onLayout={(event) => {
         backupY.current = event.nativeEvent.layout.y;
          if (backup === '1' && !backupScrollHandled.current) {
            backupScrollHandled.current = true;
            scrollRef.current?.scrollTo({ y: backupY.current, animated: false });
          }
       }}><Card>
        <Text style={[styles.title, { color: c.foreground }]}>{tr('Encrypted backup')}</Text>
        <ContextHelp topic="backups" />
        <Text accessibilityLiveRegion="polite" testID="backup-status" style={[styles.description, { color: backupStatusError || backupStatus?.lastError ? c.destructive : c.mutedForeground }]}>{backupReadiness()}</Text>
        {backupStatus?.enrolled === false ? <View style={styles.backupSetup}>
          <Text style={[styles.description, { color: c.mutedForeground }]}>{tr('Enrollment is run locally on the server PC. Run this exact command there:')}</Text>
          <Text selectable testID="backup-enrollment-command" style={[styles.command, { color: c.primary, backgroundColor: c.secondary }]}>{'pnpm --filter @workspace/api-server run backup:enroll'}</Text>
          <Text style={[styles.warning, { color: c.destructive }]}>{tr('Keep the recovery phrase OFF this PC in a secure place. Protect it carefully; Home Ledger will never ask you to enter or send it.')}</Text>
        </View> : null}
        <Text style={[styles.description, { color: c.mutedForeground }]}>{tr('Save an encrypted copy directly to the mount configured on your server PC. Verify that it is your USB/NAS drive. Nothing is downloaded to this phone. The server must be enrolled and the mount available.')}</Text>
        <Button label={serverBackupBusy ? tr('Saving on server…') : tr('Save to server USB/NAS')} icon="hard-drive" onPress={() => void saveOnServerMount()} disabled={serverBackupBusy || !session} testID="save-backup-to-server-mount" />
        {serverBackupResult ? <Text accessibilityLiveRegion="polite" testID="server-backup-result" style={[styles.description, { color: serverBackupResult.failed ? c.destructive : c.primary }]}>{serverBackupResult.message}</Text> : null}
        <Text style={[styles.title, { color: c.foreground, marginTop: 18 }]}>{tr('Export to this device')}</Text>
        <Text style={[styles.warning, { color: c.destructive }]}>{Platform.OS === 'android'
          ? tr('Choose a folder on this device to save the encrypted file. A USB drive connected to your PC is not visible from your phone. Check the saved file and keep the recovery phrase separately.')
          : tr('This file is encrypted, but it remains on this device or PC until you choose a separate destination. Store it OFF the PC and protect the recovery phrase. Opening the share sheet does not mean the backup was saved.')}
        </Text>
        <View style={styles.backupActions}>
          <Button label={backupExportBusy ? tr('Preparing encrypted backup…') : tr('Save encrypted backup')} icon="download" onPress={() => void saveEncryptedBackup()} disabled={backupExportBusy || !session} testID="save-encrypted-backup" />
          <Button label={backupStatusBusy ? tr('Checking…') : tr('Refresh backup status')} icon="refresh-cw" onPress={() => void refreshBackupStatus()} disabled={backupStatusBusy} secondary testID="refresh-backup-status" />
          <Button label={tr('Backup & recovery guide')} icon="book-open" onPress={() => router.push('/backup-recovery-guide')} secondary testID="open-backup-recovery-guide" />
        </View>
      </Card></View> : null}
      <PendingChangesReview items={quarantinedOutbox} onDismiss={() => void acknowledgeQuarantinedOutbox()} />
      <Card style={styles.reinitializeCard}>
        {canResetLedger ? <View style={[styles.reinitialize, { borderBottomColor: c.border }]}>
          <Text style={[styles.title, { color: c.destructive }]}>{tr('Full household reinitialization')}</Text>
          <Text style={[styles.description, { color: c.mutedForeground }]}>{tr('Permanently removes all household data, members, pairing devices, and history. The new currency will be locked for this household.')}</Text>
          {!reinitOpen ? <Button label={tr('Reinitialize household')} icon="alert-triangle" onPress={() => setReinitOpen(true)} secondary testID="open-reinitialize-household" /> : <>
            <Text style={[styles.warning, { color: c.destructive }]}>{tr('This cannot be undone. This is different from Reset ledger, which preserves household membership and currency.')}</Text>
            <Field label={tr('New household name')} value={reinitName} onChangeText={setReinitName} placeholder={tr('Household name')} testID="reinitialize-household-name" />
            <Field label={tr('New master display name')} value={reinitMaster} onChangeText={setReinitMaster} placeholder={tr('Master name')} testID="reinitialize-master-name" />
            <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('New base currency (locked)')}</Text>
            <View style={styles.currencyRow}>{(['EUR', 'USD', 'GBP'] as const).map((currency) => <Button key={currency} label={currency} secondary={reinitCurrency !== currency} onPress={() => setReinitCurrency(currency)} />)}</View>
            <Field label={tr('Type REINITIALIZE HOUSEHOLD to confirm')} value={reinitConfirmation} onChangeText={setReinitConfirmation} placeholder="REINITIALIZE HOUSEHOLD" testID="reinitialize-confirmation" />
            <View style={styles.formActions}><Button label={tr('Cancel')} secondary onPress={() => setReinitOpen(false)} /><Button label={reinitBusy ? tr('Reinitializing…') : tr('Permanently reinitialize')} icon="trash-2" onPress={() => void submitReinitialize()} disabled={reinitBusy || reinitConfirmation !== 'REINITIALIZE HOUSEHOLD' || !reinitName.trim() || !reinitMaster.trim()} testID="reinitialize-household" /></View>
          </>}
        </View> : null}
        <View style={styles.dataActions}>
          {canResetLedger ? <Button label={t('resetLedger')} icon="trash-2" onPress={confirmResetLedger} secondary /> : null}
          <Button label={t('signOut')} icon="log-out" onPress={() => void signOut()} secondary />
        </View>
      </Card>
      <Text style={[styles.footer, { color: c.mutedForeground }]}>{tr('Home Ledger · household data stays on your paired server')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 120 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 30, marginBottom: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  iconCircle: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  description: { lineHeight: 20, marginTop: 6, marginBottom: 14 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  pairingCode: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 18, paddingTop: 18 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold' },
  footer: { textAlign: 'center', fontSize: 12, marginTop: 26 },
  dataActions: { gap: 8 },
  backupActions: { gap: 8 },
  reinitializeCard: { marginTop: 14 },
  languageRow: { gap: 8, marginTop: 10 },
  clock: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 14 },
  clockActions: { gap: 8 },
  reinitialize: { borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 18, paddingBottom: 18 },
  warning: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  backupSetup: { marginBottom: 8 },
  command: { fontFamily: 'Inter_600SemiBold', fontSize: 12, padding: 10, borderRadius: 10, overflow: 'hidden', marginBottom: 10 },
  label: { fontSize: 12, marginBottom: 7 },
  currencyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  formActions: { gap: 8 },
});