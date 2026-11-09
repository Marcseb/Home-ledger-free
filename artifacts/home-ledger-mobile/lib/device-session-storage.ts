import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createSessionStorage } from './session-storage';

// No requireAuthentication option, Face ID permission, or biometric prompt.
// This device-only accessibility also prevents iOS keychain backup migration.
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const deviceSessionStorage = createSessionStorage(
  AsyncStorage,
  Platform.OS === 'web' ? null : {
    getItem: (key) => SecureStore.getItemAsync(key, options),
    setItem: (key, value) => SecureStore.setItemAsync(key, value, options),
    removeItem: (key) => SecureStore.deleteItemAsync(key, options),
  },
);