import Constants from 'expo-constants';
import type { HouseholdState } from '@workspace/api-client-react';

export const isAcceleratedTestBuild = Constants.expoConfig?.extra?.appVariant === 'accelerated-test';

export function businessNow(state?: HouseholdState | null): Date {
  if (isAcceleratedTestBuild && state?.acceleratedTest && state.serverNow) return new Date(state.serverNow);
  return new Date();
}

export function businessMonth(state?: HouseholdState | null): string {
  return businessNow(state).toISOString().slice(0, 7);
}

export function businessDateValue(state?: HouseholdState | null): string {
  return businessNow(state).toISOString().slice(0, 10);
}