import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Button, Card, Field } from '@/components/Ui';
import { PendingChangesReview } from '@/components/PendingChangesReview';
import { FindLocalServer } from '@/components/FindLocalServer';
import { useColors } from '@/hooks/useColors';
import { useLedger } from '@/lib/ledger-context';
import { localizeInvitationError, pairText } from '@/lib/invitation-i18n';
import { translateLiteral, useI18n } from '@/lib/i18n';
import { useAppLock } from '@/components/AppLockProvider';

export default function PairScreen() {
  const c = useColors(); const insets = useSafeAreaInsets(); const { pairing, demo, quarantinedOutbox, acknowledgeQuarantinedOutbox } = useLedger();
  const { recoveryMode, finishRecovery } = useAppLock();
  const { t, locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const [server, setServer] = useState(process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '');
  const [code, setCode] = useState(''); const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [setupMode, setSetupMode] = useState(false); const [householdName, setHouseholdName] = useState(''); const [currency, setCurrency] = useState<'EUR' | 'USD' | 'GBP'>('EUR');
  const { setupHousehold } = useLedger();
  const pt = pairText[locale];
  const submit = async () => {
    const clean = code.replace(/[\s-]/g, '').toLowerCase();
    if (!/^[0-9a-f]{20}$/.test(clean) || !server.trim()) { setMessage(pt.bad); return; }
    setBusy(true); setMessage('');
    try {
      await pairing(server.trim(), clean);
      if (recoveryMode) await finishRecovery();
      setCode('');
      router.replace('/(tabs)');
    } catch (error) {
      setMessage(recoveryMode
        ? (error instanceof Error ? error.message : tr('Household access was authorized, but app security could not be reset. The app remains locked.'))
        : (error instanceof Error ? localizeInvitationError(error.message, locale) : pt.fail));
    } finally { setBusy(false); }
  };
  const makeDemo = async () => {
    if (recoveryMode) return;
    if (!server.trim()) { setMessage(tr('Enter the desktop server address first.')); return; }
    try {
      await demo(server.trim());
      setCode('');
      setMessage(pt.demo);
    } catch {
      Alert.alert(t('error'), tr('Start the Home Ledger server on the local PC, then try again.'));
    }
  };
  const submitSetup = async () => {
    if (!server.trim() || !householdName.trim() || !name.trim()) { setMessage(tr('Enter a server address, household name, and master name.')); return; }
    setBusy(true); setMessage('');
    try {
      await setupHousehold(server.trim(), { householdName: householdName.trim(), displayName: name.trim(), currency });
      router.replace('/(tabs)');
    } catch (error) { setMessage(error instanceof Error ? error.message : tr('Could not set up this household. If it is already initialized, use pairing instead.')); }
    finally { setBusy(false); }
  };
  return <KeyboardAwareScrollViewCompat style={[styles.screen, { backgroundColor: c.background }]} contentContainerStyle={{ paddingTop: 26, paddingBottom: insets.bottom + 30 }} bottomOffset={20} keyboardShouldPersistTaps="handled">
    <View style={styles.brand}><View style={[styles.mark, { backgroundColor: c.primary }]}><Text style={{ color: c.primaryForeground, fontSize: 25 }}>HL</Text></View><Text style={[styles.eyebrow, { color: c.primary }]}>{tr('PRIVATE BY DEFAULT')}</Text><Text style={[styles.title, { color: c.foreground }]}>{tr('Your household,')}<Text style={{ color: c.tint }}>{tr(' together.')}</Text></Text><Text style={[styles.subtitle, { color: c.mutedForeground }]}>{tr('A calm, local ledger for the people and plans that matter. Nothing leaves your network.')}</Text></View>
      <PendingChangesReview items={quarantinedOutbox} onDismiss={() => void acknowledgeQuarantinedOutbox()} hideReviewed />
      <Card>
        <Field label={tr('Server address')} value={server} onChangeText={setServer} placeholder="http://192.168.1.20:5000" keyboardType="url" testID="server-address" />
        <FindLocalServer address={server} onSelect={setServer} />
        {setupMode && !recoveryMode ? (
          <>
            <Field label={tr('Household name')} value={householdName} onChangeText={setHouseholdName} placeholder={tr('The Smiths')} testID="household-name" />
            <Field label={tr('Master display name')} value={name} onChangeText={setName} placeholder="Alex" testID="display-name" />
            <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('Base currency (cannot change without full household reinitialization)')}</Text>
            <View style={styles.currencyRow}>
              {(['EUR', 'USD', 'GBP'] as const).map((item) => (
                <Pressable key={item} onPress={() => setCurrency(item)} style={[styles.currency, { backgroundColor: currency === item ? c.primary : c.secondary }]}>
                  <Text style={{ color: currency === item ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{item}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <>
            <Field label={pt.code} value={code} onChangeText={setCode} placeholder={pt.ph} testID="pairing-code" />
            <Text style={[styles.label, { color: c.mutedForeground }]}>{pt.hint}</Text>
          </>
        )}
        {message ? <Text style={[styles.message, { color: c.tint }]}>{message}</Text> : null}
        <Button label={tr(busy ? (setupMode ? 'Setting up…' : 'Pairing…') : (setupMode ? 'Create household' : 'Join household'))} icon={setupMode ? 'home' : 'link'} onPress={setupMode ? submitSetup : submit} disabled={busy || (recoveryMode && setupMode)} testID={setupMode ? 'setup-household' : 'join-household'} />
        {!recoveryMode ? <Pressable onPress={() => { setSetupMode(!setupMode); setMessage(''); }}>
          <Text style={[styles.demo, { color: c.primary }]}>{tr(setupMode ? 'Already have a household? Pair this device' : 'First time here? Set up a household')}</Text>
        </Pressable> : <Text style={[styles.message, { color: c.mutedForeground }]}>{tr('A fresh household invitation is required to complete device recovery.')}</Text>}
        {!recoveryMode ? <PressDemo onPress={makeDemo} /> : null}
      </Card>
    <View style={styles.privacy}><Text style={[styles.privacyTitle, { color: c.foreground }]}>{tr('Local-only by design')}</Text><Text style={{ color: c.mutedForeground, lineHeight: 20 }}>{tr('Your PC is the server. Pair devices over your home network and keep your financial history off the cloud.')}</Text></View>
  </KeyboardAwareScrollViewCompat>;
}
function PressDemo({ onPress }: { onPress: () => void }) { const c = useColors(); const { locale } = useI18n(); return <Text onPress={onPress} style={[styles.demo, { color: c.primary }]}>{translateLiteral('Set up a local demo household', locale)}</Text>; }
 const styles = StyleSheet.create({ screen: { flex: 1, paddingHorizontal: 20 }, brand: { marginBottom: 25 }, mark: { width: 50, height: 50, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }, eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 2, marginBottom: 10 }, title: { fontFamily: 'Inter_700Bold', fontSize: 36, lineHeight: 42, maxWidth: 350 }, subtitle: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 23, marginTop: 13, maxWidth: 340 }, message: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 12, lineHeight: 18 }, demo: { fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginTop: 18 }, label: { fontSize: 12, marginBottom: 7 }, currencyRow: { flexDirection: 'row', gap: 8, marginBottom: 12 }, currency: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 }, privacy: { padding: 18, marginTop: 17 }, privacyTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, marginBottom: 5 } });