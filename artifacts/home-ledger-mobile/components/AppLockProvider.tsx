import * as LocalAuthentication from 'expo-local-authentication';
import { router, useSegments } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useLedger } from '@/lib/ledger-context';
import { translateLiteral, useI18n } from '@/lib/i18n';
import {
  getAppLockWaitMs,
  isValidAppPin,
  nextAppLockAttempts,
  resetAppLockAttempts,
  shouldRelockAfterBackground,
} from '@/lib/app-lock-policy';
import {
  defaultAppLockSettings,
  loadAppLockSettings,
  saveAppLockSettings,
  type AppLockSettings,
} from '@/lib/app-lock-storage';

type AppLockContextValue = {
  enabled: boolean;
  locked: boolean;
  setupRequired: boolean;
  recoveryMode: boolean;
  isNative: boolean;
  biometricAvailable: boolean;
  storageLoading: boolean;
  storageError: string;
  pinError: string;
  recoveryMessage: string;
  busy: boolean;
  lockoutUntil: number;
  retryStorage: () => Promise<void>;
  enableWithPin: (pin: string) => Promise<void>;
  disable: () => Promise<void>;
  changePin: (currentPin: string, nextPin: string) => Promise<boolean>;
  unlockWithPin: (pin: string) => Promise<boolean>;
  unlockWithBiometrics: () => Promise<boolean>;
  setPinAfterRecovery: (pin: string) => Promise<void>;
  beginRecovery: () => Promise<void>;
  finishRecovery: () => Promise<void>;
};

const AppLockContext = createContext<AppLockContextValue | null>(null);

export function useAppLock() {
  const context = useContext(AppLockContext);
  if (!context) throw new Error('useAppLock must be used within AppLockProvider');
  return context;
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { loading: ledgerLoading, quarantinedOutbox, syncForDeviceRecovery } = useLedger();
  const [settings, setSettings] = useState<AppLockSettings>(defaultAppLockSettings);
  const [locked, setLocked] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [storageLoading, setStorageLoading] = useState(Platform.OS !== 'web');
  const [storageError, setStorageError] = useState('');
  const [pinError, setPinError] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [lockSequence, setLockSequence] = useState(0);
  const settingsRef = useRef(settings);
  const lockedRef = useRef(locked);
  const backgroundedAt = useRef<number | null>(null);
  const biometricPromptActive = useRef(false);
  const pinAttemptActive = useRef(false);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { lockedRef.current = locked; }, [locked]);

  const loadSettings = useCallback(async () => {
    if (Platform.OS === 'web') {
      setSettings({ ...defaultAppLockSettings });
      setStorageLoading(false);
      setLocked(false);
      return;
    }
    setStorageLoading(true);
    setStorageError('');
    try {
      const [saved, hasHardware, enrolled] = await Promise.all([
        loadAppLockSettings(),
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      setSettings(saved);
      setBiometricAvailable(hasHardware && enrolled);
      setSetupRequired(saved.enabled && saved.pin === null);
      setLocked(saved.enabled);
      if (saved.enabled) setLockSequence((value) => value + 1);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Could not read app-lock settings.');
      setLocked(true);
    } finally {
      setStorageLoading(false);
    }
  }, []);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const save = useCallback(async (next: AppLockSettings) => {
    await saveAppLockSettings(next);
    setSettings(next);
    setStorageError('');
    setPinError('');
  }, []);

  const enableWithPin = useCallback(async (pin: string) => {
    if (!isValidAppPin(pin)) throw new Error('Enter a four-digit PIN.');
    await save({ ...settingsRef.current, version: 1, enabled: true, pin, ...resetAppLockAttempts() });
    setSetupRequired(false);
    setRecoveryMessage('');
  }, [save]);

  const disable = useCallback(async () => {
    await save({ ...settingsRef.current, version: 1, enabled: false, pin: null, ...resetAppLockAttempts() });
    setSetupRequired(false);
  }, [save]);

  const changePin = useCallback(async (currentPin: string, nextPin: string) => {
    const current = settingsRef.current;
    if (!current.enabled || !current.pin) return false;
    const waitMs = getAppLockWaitMs(current);
    if (waitMs > 0) {
      setPinError(`Try again in ${Math.ceil(waitMs / 1000)} seconds.`);
      return false;
    }
    if (current.pin !== currentPin) {
      const failed = { ...current, ...nextAppLockAttempts(current) };
      await save(failed);
      setPinError(failed.lockoutUntil > Date.now()
        ? `Too many attempts. Try again in ${Math.ceil((failed.lockoutUntil - Date.now()) / 1000)} seconds.`
        : 'The current PIN is not correct.');
      return false;
    }
    if (!isValidAppPin(nextPin)) {
      setPinError('Choose a four-digit PIN.');
      return false;
    }
    await save({ ...current, pin: nextPin, ...resetAppLockAttempts() });
    return true;
  }, [save]);

  const unlockWithPin = useCallback(async (pin: string) => {
    if (pinAttemptActive.current) return false;
    pinAttemptActive.current = true;
    setBusy(true);
    try {
      const current = settingsRef.current;
      setPinError('');
      if (!current.enabled || !current.pin) return false;
      const waitMs = getAppLockWaitMs(current);
      if (waitMs > 0) {
        setPinError(`Too many attempts. Try again in ${Math.ceil(waitMs / 1000)} seconds.`);
        return false;
      }
      if (current.pin !== pin) {
        const failed = { ...current, ...nextAppLockAttempts(current) };
        try {
          await save(failed);
        } catch (error) {
          setStorageError(error instanceof Error ? error.message : 'Could not save the failed attempt.');
          return false;
        }
        setPinError(failed.lockoutUntil > Date.now()
          ? `Too many attempts. Try again in ${Math.ceil((failed.lockoutUntil - Date.now()) / 1000)} seconds.`
          : 'That PIN is not correct.');
        return false;
      }
      try {
        await save({ ...current, ...resetAppLockAttempts() });
        setLocked(false);
        setPinError('');
        return true;
      } catch (error) {
        setStorageError(error instanceof Error ? error.message : 'Could not verify app-lock settings.');
        return false;
      }
    } finally {
      pinAttemptActive.current = false;
      setBusy(false);
    }
  }, [save]);

  const unlockWithBiometrics = useCallback(async () => {
    if (Platform.OS === 'web' || !settingsRef.current.enabled || biometricPromptActive.current) return false;
    biometricPromptActive.current = true;
    setBusy(true);
    setPinError('');
    try {
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      setBiometricAvailable(hasHardware && enrolled);
      if (!hasHardware || !enrolled) return false;
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Home Ledger',
        cancelLabel: 'Use PIN',
        fallbackLabel: 'Use PIN',
        disableDeviceFallback: true,
        biometricsSecurityLevel: 'strong',
      });
      if (!result.success) return false;
      const current = settingsRef.current;
      await save({ ...current, ...resetAppLockAttempts() });
      setLocked(false);
      return true;
    } catch (error) {
      setPinError(error instanceof Error ? error.message : 'Biometric unlock is unavailable. Enter your app PIN.');
      return false;
    } finally {
      biometricPromptActive.current = false;
      setBusy(false);
    }
  }, [save]);

  const setPinAfterRecovery = useCallback(async (pin: string) => {
    if (!isValidAppPin(pin)) throw new Error('Choose a four-digit PIN.');
    if (!settingsRef.current.enabled || !setupRequired) throw new Error('PIN recovery is not active.');
    await save({ ...settingsRef.current, version: 1, enabled: true, pin, ...resetAppLockAttempts() });
    setSetupRequired(false);
    setLocked(false);
    setPinError('');
  }, [save, setupRequired]);

  const beginRecovery = useCallback(async () => {
    setBusy(true);
    setRecoveryMessage('');
    try {
      if (ledgerLoading) {
        setRecoveryMessage('Household data is still loading. Wait a moment and retry.');
        return;
      }
      if (quarantinedOutbox.some((entry) => !entry.reviewedAt)) {
        setRecoveryMessage('Some pending changes need review. Unlock with your PIN or biometrics before recovering this device.');
        return;
      }
      const synced = await syncForDeviceRecovery();
      if (!synced) {
        setRecoveryMessage('Home Ledger could not confirm that all changes are synced. Check the server connection and retry. Nothing has been erased.');
        return;
      }
      setRecoveryMode(true);
      setRecoveryMessage('');
      router.replace('/pair' as never);
    } finally {
      setBusy(false);
    }
  }, [ledgerLoading, quarantinedOutbox, syncForDeviceRecovery]);

  const finishRecovery = useCallback(async () => {
    if (!recoveryMode) throw new Error('Device recovery is not active.');
    const next = {
      ...settingsRef.current,
      version: 1 as const,
      enabled: true,
      pin: null,
      ...resetAppLockAttempts(),
    };
    await save(next);
    setRecoveryMode(false);
    setSetupRequired(true);
    setLocked(true);
  }, [recoveryMode, save]);

  useEffect(() => {
    if (storageLoading || !settings.enabled || !locked || lockSequence === 0) return;
    void unlockWithBiometrics();
  }, [lockSequence, locked, settings.enabled, storageLoading, unlockWithBiometrics]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'inactive' || nextState === 'background') {
        if (!biometricPromptActive.current && backgroundedAt.current === null) backgroundedAt.current = Date.now();
        return;
      }
      if (nextState !== 'active') return;
      const startedAt = backgroundedAt.current;
      backgroundedAt.current = null;
      if (startedAt !== null && shouldRelockAfterBackground(
        Date.now() - startedAt,
        settingsRef.current.enabled,
        lockedRef.current,
      )) {
        lockedRef.current = true;
        setLocked(true);
        setLockSequence((value) => value + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  const value = useMemo<AppLockContextValue>(() => ({
    enabled: settings.enabled,
    locked,
    setupRequired,
    recoveryMode,
    isNative: Platform.OS !== 'web',
    biometricAvailable,
    storageLoading,
    storageError,
    pinError,
    recoveryMessage,
    busy,
    lockoutUntil: settings.lockoutUntil,
    retryStorage: loadSettings,
    enableWithPin,
    disable,
    changePin,
    unlockWithPin,
    unlockWithBiometrics,
    setPinAfterRecovery,
    beginRecovery,
    finishRecovery,
  }), [
    settings, locked, setupRequired, recoveryMode, biometricAvailable, storageLoading,
    storageError, pinError, recoveryMessage, busy, loadSettings, enableWithPin,
    disable, changePin, unlockWithPin, unlockWithBiometrics, setPinAfterRecovery,
    beginRecovery, finishRecovery,
  ]);

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function AppLockGate({ children }: { children: ReactNode }) {
  const lock = useAppLock();
  const segments = useSegments();
  if (Platform.OS === 'web') return <>{children}</>;
  if (lock.storageLoading) return <GateMessage title="Checking app security…" />;
  if (lock.storageError) return <GateMessage title="App security could not be checked" detail={lock.storageError} action="Retry" onPress={() => void lock.retryStorage()} />;
  if (lock.setupRequired) return <AppPinSetup />;
  if (lock.recoveryMode && segments[0] === 'pair') return <>{children}</>;
  if (lock.locked || lock.recoveryMode) return <AppLockScreen />;
  return <>{children}</>;
}

function AppPinSetup() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const lock = useAppLock();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!isValidAppPin(pin)) { setMessage(tr('Enter a four-digit PIN.')); return; }
    if (pin !== confirmation) { setMessage(tr('The PINs do not match.')); return; }
    setBusy(true);
    setMessage('');
    try {
      await lock.setPinAfterRecovery(pin);
      setPin('');
      setConfirmation('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tr('Could not save the new PIN.'));
    } finally {
      setBusy(false);
    }
  };
  return <GateFrame>
    <View style={[styles.brandMark, { backgroundColor: c.primary }]}><Feather name="shield" size={25} color={c.primaryForeground} /></View>
    <Text style={[styles.eyebrow, { color: c.mutedForeground }]}>{tr('APP SECURITY')}</Text>
    <Text style={[styles.title, { color: c.foreground }]}>{tr('Create a new app PIN')}</Text>
    <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{tr('Household access is restored. Set a new four-digit PIN to protect this device.')}</Text>
    <TextInput
      accessibilityLabel={tr('New four-digit app PIN')}
      value={pin}
      onChangeText={(value) => setPin(value.replace(/\D/g, '').slice(0, 4))}
      placeholder="••••"
      placeholderTextColor={c.mutedForeground}
      keyboardType="number-pad"
      secureTextEntry
      maxLength={4}
      autoComplete="off"
      contextMenuHidden
      style={[styles.pinInput, { backgroundColor: c.card, borderColor: c.border, color: c.foreground }]}
      testID="recovery-new-pin"
    />
    <TextInput
      accessibilityLabel={tr('Confirm new four-digit app PIN')}
      value={confirmation}
      onChangeText={(value) => setConfirmation(value.replace(/\D/g, '').slice(0, 4))}
      placeholder={tr('Confirm PIN')}
      placeholderTextColor={c.mutedForeground}
      keyboardType="number-pad"
      secureTextEntry
      maxLength={4}
      autoComplete="off"
      contextMenuHidden
      style={[styles.pinInput, styles.confirmInput, { backgroundColor: c.card, borderColor: c.border, color: c.foreground }]}
      testID="recovery-confirm-pin"
    />
    {message ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: c.destructive }]}>{message}</Text> : null}
    <ActionButton label={busy ? tr('Saving…') : tr('Set app PIN')} onPress={() => void submit()} disabled={busy} />
  </GateFrame>;
}

function AppLockScreen() {
  const c = useColors();
  const lock = useAppLock();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const [pin, setPin] = useState('');
  const [secondsNow, setSecondsNow] = useState(Date.now());
  const [showRecovery, setShowRecovery] = useState(false);
  const waitMs = getAppLockWaitMs({ failedAttempts: 0, lockoutUntil: lock.lockoutUntil }, secondsNow);

  useEffect(() => {
    if (!lock.lockoutUntil) return undefined;
    const timer = setInterval(() => setSecondsNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [lock.lockoutUntil]);

  const submit = async () => {
    if (pin.length !== 4 || waitMs > 0) return;
    const accepted = await lock.unlockWithPin(pin);
    setPin('');
    if (accepted) setShowRecovery(false);
  };
  const confirmRecovery = () => Alert.alert(
    tr('Recover this device?'),
    tr('Home Ledger will sync pending changes, then ask for a fresh household invitation. If syncing or authorization fails, your saved data will stay in place.'),
    [
      { text: tr('Cancel'), style: 'cancel' },
      { text: tr('Continue'), onPress: () => void lock.beginRecovery() },
    ],
  );

  return <GateFrame>
    <View style={[styles.brandMark, { backgroundColor: c.primary }]}><Feather name="lock" size={24} color={c.primaryForeground} /></View>
    <Text style={[styles.eyebrow, { color: c.mutedForeground }]}>{tr('HOME LEDGER')}</Text>
    <Text style={[styles.title, { color: c.foreground }]}>{tr('Unlock Home Ledger')}</Text>
    <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
      {lock.recoveryMode
        ? tr('Complete recovery with a fresh household invitation. Your ledger remains locked.')
        : tr('Use your device biometrics or enter your four-digit app PIN.')}
    </Text>
    {lock.recoveryMode ? (
      <>
        {lock.recoveryMessage ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: c.destructive }]}>{tr(lock.recoveryMessage)}</Text> : null}
        <ActionButton label={lock.busy ? tr('Checking pending changes…') : tr('Retry household recovery')} onPress={() => void lock.beginRecovery()} disabled={lock.busy} />
      </>
    ) : (
      <>
        <TextInput
          accessibilityLabel={tr('Four-digit app PIN')}
          value={pin}
          onChangeText={(value) => setPin(value.replace(/\D/g, '').slice(0, 4))}
          placeholder="••••"
          placeholderTextColor={c.mutedForeground}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          autoComplete="off"
          contextMenuHidden
          editable={waitMs === 0 && !lock.busy}
          onSubmitEditing={() => void submit()}
          returnKeyType="done"
          style={[styles.pinInput, { backgroundColor: c.card, borderColor: c.border, color: c.foreground }]}
          testID="app-lock-pin"
        />
        {lock.pinError ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: c.destructive }]}>{tr(lock.pinError)}</Text> : null}
        {lock.storageError ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: c.destructive }]}>{lock.storageError}</Text> : null}
        {waitMs > 0 ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: c.destructive }]}>{tr('Too many attempts. Try again in')} {Math.ceil(waitMs / 1000)} {tr('seconds.')}</Text> : null}
        <ActionButton label={lock.busy ? tr('Checking…') : tr('Continue')} onPress={() => void submit()} disabled={pin.length !== 4 || waitMs > 0 || lock.busy} />
        {lock.biometricAvailable ? (
          <Pressable accessibilityRole="button" accessibilityLabel={tr('Unlock with device biometrics')} onPress={() => void lock.unlockWithBiometrics()} style={styles.secondaryAction} testID="app-lock-biometric">
            <Feather name="shield" color={c.primary} size={18} />
            <Text style={[styles.secondaryActionText, { color: c.primary }]}>{tr('Use biometrics')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowRecovery((value) => !value)}
          style={styles.forgotAction}
          testID="app-lock-recovery-toggle"
        >
          <Text style={[styles.forgotText, { color: c.mutedForeground }]}>{tr('Forgot your PIN?')}</Text>
        </Pressable>
        {showRecovery ? (
          <View style={[styles.recoveryBox, { borderColor: c.border, backgroundColor: c.card }]}>
            <Text style={[styles.recoveryText, { color: c.mutedForeground }]}>
              {tr('Recovery requires a fresh household invitation. Pending changes must sync first; if the server is unavailable, nothing will be erased.')}
            </Text>
            {lock.recoveryMessage ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: c.destructive }]}>{tr(lock.recoveryMessage)}</Text> : null}
            <ActionButton label={lock.busy ? tr('Syncing…') : tr('Start recovery')} onPress={confirmRecovery} disabled={lock.busy} />
          </View>
        ) : null}
      </>
    )}
  </GateFrame>;
}

function GateFrame({ children }: { children: ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return <KeyboardAvoidingView style={[styles.screen, { backgroundColor: c.background }]} behavior="padding">
    <View style={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 28 }]}>
      {children}
    </View>
  </KeyboardAvoidingView>;
}

function GateMessage({ title, detail, action, onPress }: { title: string; detail?: string; action?: string; onPress?: () => void }) {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  return <View style={[styles.messageScreen, { backgroundColor: c.background }]}>
    <Text style={[styles.title, { color: c.foreground }]}>{tr(title)}</Text>
    {detail ? <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{detail}</Text> : null}
    {action && onPress ? <ActionButton label={tr(action)} onPress={onPress} /> : null}
  </View>;
}

function ActionButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return <Pressable
    accessibilityRole="button"
    disabled={disabled}
    onPress={onPress}
    style={[styles.primaryButton, { backgroundColor: disabled ? c.muted : c.primary }]}
  >
    <Text style={[styles.primaryButtonText, { color: disabled ? c.mutedForeground : c.primaryForeground }]}>{label}</Text>
    <Feather name="arrow-right" size={19} color={disabled ? c.mutedForeground : c.primaryForeground} />
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 26 },
  messageScreen: { flex: 1, justifyContent: 'center', paddingHorizontal: 26, gap: 16 },
  brandMark: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 27 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 1.8, marginBottom: 12 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, lineHeight: 37, marginBottom: 10 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, marginBottom: 28 },
  pinInput: { minHeight: 66, borderWidth: 1, borderRadius: 16, paddingHorizontal: 18, fontFamily: 'Inter_600SemiBold', fontSize: 24, letterSpacing: 10, textAlign: 'center', marginBottom: 14 },
  confirmInput: { fontSize: 17, letterSpacing: 1 },
  primaryButton: { minHeight: 58, borderRadius: 16, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 6 },
  primaryButtonText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  secondaryAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 48, marginTop: 10 },
  secondaryActionText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  forgotAction: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 8 },
  forgotText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  recoveryBox: { borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 8 },
  recoveryText: { fontFamily: 'Inter_400Regular', lineHeight: 20, marginBottom: 8 },
  message: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18, marginBottom: 10 },
});

