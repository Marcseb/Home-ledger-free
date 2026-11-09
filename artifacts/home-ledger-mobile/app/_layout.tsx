import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { LedgerProvider } from '@/lib/ledger-context';
import { I18nProvider, translateLiteral, useI18n } from '@/lib/i18n';
import { HelpButton } from '@/components/HelpButton';
import { getHelpUi } from '@/lib/help-content';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { AppLockGate, AppLockProvider } from '@/components/AppLockProvider';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const { t, locale } = useI18n();
  return (
    <Stack screenOptions={{ headerBackTitle: t('back'), headerShown: true, headerRight: () => <HelpButton /> }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: isLiquidGlassAvailable(), title: 'Home Ledger' }} />
      <Stack.Screen name="pair" options={{ title: 'Home Ledger', headerBackVisible: false }} />
      <Stack.Screen name="help" options={{ title: getHelpUi(locale).helpTitle, headerRight: () => null }} />
      <Stack.Screen name="accounts" options={{ title: translateLiteral('Personal accounts', locale) }} />
      <Stack.Screen name="household" options={{ title: t('household') }} />
      <Stack.Screen name="recurring" options={{ headerShown: true, title: t('recurring') }} />
      <Stack.Screen name="categories" options={{ headerShown: true, title: t('categories') }} />
      <Stack.Screen name="goals" options={{ headerShown: true, title: t('goals') }} />
      <Stack.Screen name="shared-goal-guide" options={{ headerShown: true, title: t('goals') }} />
      <Stack.Screen name="backup-recovery-guide" options={{ headerShown: true, title: translateLiteral('Backup & recovery guide', locale) }} />
      <Stack.Screen name="budgets" options={{ headerShown: true, title: t('budgets') }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ErrorBoundary>
            <LedgerProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <AppLockProvider>
                  <AppLockGate>
                    <RootLayoutNav />
                  </AppLockGate>
                </AppLockProvider>
              </KeyboardProvider>
              </GestureHandlerRootView>
            </LedgerProvider>
          </ErrorBoundary>
        </I18nProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
