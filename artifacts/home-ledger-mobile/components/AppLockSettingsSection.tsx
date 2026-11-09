import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Card, Field } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useAppLock } from '@/components/AppLockProvider';
import { translateLiteral, useI18n } from '@/lib/i18n';
import { isValidAppPin } from '@/lib/app-lock-policy';

export function AppLockSettingsSection() {
  const c = useColors();
  const lock = useAppLock();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const [settingUp, setSettingUp] = useState(false);
  const [changing, setChanging] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [nextPin, setNextPin] = useState('');
  const [nextConfirmation, setNextConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const unavailable = Platform.OS === 'web' || lock.storageLoading || busy;

  const enable = async () => {
    if (!isValidAppPin(pin)) { setMessage(tr('Enter a four-digit PIN.')); return; }
    if (pin !== confirmation) { setMessage(tr('The PINs do not match.')); return; }
    setBusy(true);
    setMessage('');
    try {
      await lock.enableWithPin(pin);
      setSettingUp(false);
      setPin('');
      setConfirmation('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tr('Could not enable app lock.'));
    } finally {
      setBusy(false);
    }
  };

  const disable = () => Alert.alert(
    tr('Turn off app lock?'),
    tr('This removes the PIN and biometric lock from this device. Household access and server permissions are unchanged.'),
    [
      { text: tr('Cancel'), style: 'cancel' },
      {
        text: tr('Turn off'),
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void lock.disable().then(() => {
            setChanging(false);
            setMessage('');
          }).catch((error) => {
            setMessage(error instanceof Error ? error.message : tr('Could not turn off app lock.'));
          }).finally(() => setBusy(false));
        },
      },
    ],
  );

  const change = async () => {
    if (!isValidAppPin(nextPin)) { setMessage(tr('Choose a four-digit PIN.')); return; }
    if (nextPin !== nextConfirmation) { setMessage(tr('The PINs do not match.')); return; }
    setBusy(true);
    setMessage('');
    try {
      const changed = await lock.changePin(currentPin, nextPin);
      if (!changed) {
        setMessage(lock.pinError || tr('The current PIN is not correct.'));
        return;
      }
      setChanging(false);
      setCurrentPin('');
      setNextPin('');
      setNextConfirmation('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tr('Could not change the app PIN.'));
    } finally {
      setBusy(false);
    }
  };

  return <Card>
    <View style={styles.headingRow}>
      <View style={[styles.iconCircle, { backgroundColor: c.secondary }]}>
        <Feather name="shield" size={19} color={c.primary} />
      </View>
      <View style={styles.headingCopy}>
        <Text style={[styles.title, { color: c.foreground }]}>{tr('App security')}</Text>
        <Text style={[styles.description, { color: c.mutedForeground }]}>
          {tr('Use biometrics when available, with your app PIN as fallback.')}
        </Text>
      </View>
    </View>
    <Text style={[styles.securityNote, { color: c.mutedForeground }]}>
      {tr('The app lock does not encrypt local files or authenticate server requests.')}
    </Text>
    <View style={[styles.toggleRow, { borderTopColor: c.border }]}>
      <View style={styles.toggleCopy}>
        <Text style={[styles.toggleTitle, { color: c.foreground }]}>{tr('Lock app on open')}</Text>
        <Text style={[styles.description, { color: c.mutedForeground }]}>
          {lock.enabled ? tr('Locks at startup and after more than 30 seconds away.') : tr('Optional on this device; the lock does not encrypt ledger files.')}
        </Text>
      </View>
      <Switch
        value={lock.enabled}
        disabled={unavailable}
        onValueChange={(value) => {
          setMessage('');
          if (value) {
            setSettingUp(true);
            setChanging(false);
          } else {
            disable();
          }
        }}
        trackColor={{ false: c.muted, true: c.primary }}
        thumbColor={c.card}
        ios_backgroundColor={c.muted}
        accessibilityLabel={tr('Lock app on open')}
        testID="app-lock-enabled"
      />
    </View>
    {Platform.OS === 'web' ? (
      <Text style={[styles.description, { color: c.mutedForeground }]}>{tr('Device lock is available only in the installed iOS or Android app.')}</Text>
    ) : null}
    {settingUp ? (
      <View style={[styles.form, { borderTopColor: c.border }]}>
        <Text style={[styles.formTitle, { color: c.foreground }]}>{tr('Create a four-digit app PIN')}</Text>
        <Field label={tr('New PIN')} value={pin} onChangeText={(value) => setPin(value.replace(/\D/g, '').slice(0, 4))} keyboardType="numeric" secureTextEntry testID="app-lock-new-pin" />
        <Field label={tr('Confirm PIN')} value={confirmation} onChangeText={(value) => setConfirmation(value.replace(/\D/g, '').slice(0, 4))} keyboardType="numeric" secureTextEntry testID="app-lock-confirm-pin" />
        {message ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: c.destructive }]}>{message}</Text> : null}
        <Button label={busy ? tr('Saving…') : tr('Enable app lock')} onPress={() => void enable()} disabled={busy} />
        <Button label={tr('Cancel')} secondary onPress={() => { setSettingUp(false); setPin(''); setConfirmation(''); setMessage(''); }} />
      </View>
    ) : null}
    {lock.enabled ? (
      <View style={[styles.form, { borderTopColor: c.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: changing }}
          onPress={() => { setChanging((value) => !value); setSettingUp(false); setMessage(''); }}
          style={styles.changeRow}
          testID="app-lock-change-pin-toggle"
        >
          <Feather name="key" color={c.primary} size={18} />
          <Text style={[styles.changeText, { color: c.primary }]}>{tr('Change PIN')}</Text>
          <Feather name={changing ? 'chevron-up' : 'chevron-right'} color={c.mutedForeground} size={18} />
        </Pressable>
        {changing ? (
          <View style={styles.changeForm}>
            <Field label={tr('Current PIN')} value={currentPin} onChangeText={(value) => setCurrentPin(value.replace(/\D/g, '').slice(0, 4))} keyboardType="numeric" secureTextEntry testID="app-lock-current-pin" />
            <Field label={tr('New PIN')} value={nextPin} onChangeText={(value) => setNextPin(value.replace(/\D/g, '').slice(0, 4))} keyboardType="numeric" secureTextEntry testID="app-lock-next-pin" />
            <Field label={tr('Confirm new PIN')} value={nextConfirmation} onChangeText={(value) => setNextConfirmation(value.replace(/\D/g, '').slice(0, 4))} keyboardType="numeric" secureTextEntry testID="app-lock-next-confirm-pin" />
            {message ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: c.destructive }]}>{tr(message)}</Text> : null}
            <Button label={busy ? tr('Saving…') : tr('Save new PIN')} onPress={() => void change()} disabled={busy} />
          </View>
        ) : null}
      </View>
    ) : null}
  </Card>;
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 15 },
  iconCircle: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  headingCopy: { flex: 1 },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  description: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 5 },
  securityNote: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginBottom: 11 },
  toggleRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  toggleCopy: { flex: 1 },
  toggleTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  form: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 14, paddingTop: 14, gap: 4 },
  formTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, marginBottom: 12 },
  message: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18, marginBottom: 8 },
  changeRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10 },
  changeText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  changeForm: { marginTop: 12 },
});

