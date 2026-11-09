import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { cancelSavingsGoalContribution as cancelSavingsGoalContributionRequest } from '@workspace/api-client-react';
import { acknowledgeBudgetAlert as acknowledgeBudgetAlertRequest, advanceTestClock, cancelSavingsGoal as cancelSavingsGoalRequest, cancelTransaction as cancelTransactionRequest, contributeToSavingsGoal as contributeToSavingsGoalRequest, correctTransaction as correctTransactionRequest, createCategory as createCategoryRequest, createRecurringRule as createRecurringRuleRequest, createSavingsGoal as createSavingsGoalRequest, createSavingsAccount as createSavingsAccountRequest, createBudget as createBudgetRequest, deleteBudget as deleteBudgetRequest, deleteRecurringRule as deleteRecurringRuleRequest, getBootstrap, getDashboard, inviteSavingsGoalParticipant as inviteSavingsGoalParticipantRequest, redeemHouseholdInvitation, removeHouseholdMember as removeHouseholdMemberRequest, reinitializeHousehold as reinitializeHouseholdRequest, resetDemo, resetLedger as resetLedgerRequest, respondToSavingsGoalInvitation as respondToSavingsGoalInvitationRequest, setAuthTokenGetter, setBaseUrl, setupHousehold as setupHouseholdRequest, settleSavingsGoal as settleSavingsGoalRequest, syncOperations, transferHouseholdMaster as transferHouseholdMasterRequest, updateBudget as updateBudgetRequest, updateCategory as updateCategoryRequest, updateHouseholdAllocations as updateHouseholdAllocationsRequest, updateRecurringRule as updateRecurringRuleRequest, updateSavingsGoal as updateSavingsGoalRequest, updateSavingsAccount as updateSavingsAccountRequest } from '@workspace/api-client-react';
import type { BudgetInput, CategoryInput, CategoryUpdate, Dashboard, HouseholdAllocation, HouseholdReinitializationInput, HouseholdSetupInput, HouseholdState, RecurringRuleInput, SavingsAccountInput, SavingsAccountUpdate, SavingsGoalCancellationInput, SavingsGoalContributionInput, SavingsGoalInput, SavingsGoalInvitationResponse, SavingsGoalParticipantInput, SavingsGoalUpdate, SyncOperation, Transaction, TransactionCancellationInput, TransactionCorrectionInput } from '@workspace/api-client-react';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import * as Network from 'expo-network';
import { router } from 'expo-router';
import { businessNow, isAcceleratedTestBuild } from './app-time';
import { defaultPersonalPayerAccountId, pendingLedgerTransactions, projectPurchase, sharedOnlyOperations } from './shared-expense';
import { appendQuarantinedOperations, canPersistGeneration, createSerialQueue, mergeUniqueOperations, preservePendingForReplacement, markReviewedOperations } from './storage-queue';
import { deviceSessionStorage } from './device-session-storage';
import { reconcileSyncSnapshot } from './sync-state';
import { SessionStorageError } from './session-storage';
import { createHouseholdStorage, HouseholdStorageError } from './household-storage';
import { createSyncGate, withNetworkDeadline } from './network-recovery';
import { discoverLanServers, identifyServer, localServerPort, normalizeServerAddress, preferredServer, verifyServer, type LanServer } from './server-discovery';

setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
const DEVICE = 'home-ledger.device';
const STATE = 'home-ledger.state';
const OUTBOX = 'home-ledger.outbox';
const CURSOR = 'home-ledger.cursor';
const QUARANTINED_OUTBOX = 'home-ledger.quarantined-outbox';
const enqueueStorage = createSerialQueue();
const householdStorage = createHouseholdStorage(AsyncStorage, deviceSessionStorage);
const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
const pairedDeviceName = () => Constants.deviceName?.trim() || (Platform.OS === 'web' ? 'Web browser' : `${Platform.OS[0].toUpperCase()}${Platform.OS.slice(1)} device`);
const deviceHeaders = (token: string) => ({ 'x-device-token': token, 'x-device-name': pairedDeviceName() });

type Session = { token: string; user: HouseholdState['users'][number]; deviceId: string; serverAddress: string; serverId?: string; serverScope?: string };
type OutboxItem = SyncOperation;
export type QuarantinedOutboxItem = { operation: OutboxItem; quarantinedAt: string; reviewedAt?: string };
type LedgerContextValue = {
  session: Session | null; state: HouseholdState | null; dashboard: Dashboard | null; outbox: OutboxItem[];
  quarantinedOutbox: QuarantinedOutboxItem[]; acknowledgeQuarantinedOutbox: () => Promise<void>;
  dashboardPersonalAccountId: string | null; setDashboardPersonalAccountId: (accountId: string | null) => void;
  loading: boolean; online: boolean; pairing: (serverAddress: string, code: string) => Promise<void>; setupHousehold: (serverAddress: string, input: Omit<HouseholdSetupInput, 'deviceId' | 'deviceName'>) => Promise<void>; reinitializeHousehold: (input: Omit<HouseholdReinitializationInput, 'deviceId' | 'deviceName' | 'confirmation'>) => Promise<void>;
  discoveringServer: boolean; discoveryMessage: string; discoveredServers: LanServer[];
  findServer: () => Promise<void>; changeServerAddress: (address: string) => Promise<void>;
  advanceBusinessTime: (unit: 'day' | 'week' | 'month') => Promise<void>;
  demo: (serverAddress: string) => Promise<void>; logout: () => Promise<void>; resetLedger: () => Promise<void>; sync: (searchNow?: boolean) => Promise<void>;
  syncForDeviceRecovery: () => Promise<boolean>;
  addTransaction: (kind: Transaction['kind'], amountMinor: number, note: string, accountId: string, categoryId: string, destinationAccountId?: string, occurredAt?: string, personalPayerAccountId?: string | null) => Promise<void>;
  correctTransaction: (transactionId: string, input: Omit<TransactionCorrectionInput, 'operationId'>) => Promise<void>;
  cancelTransaction: (transactionId: string) => Promise<void>;
  cancelSavingsGoalContribution: (goalId: string, contributionId: string, operationId?: string) => Promise<void>;
  addRecurringRule: (input: RecurringRuleInput) => Promise<void>; editRecurringRule: (ruleId: string, input: RecurringRuleInput) => Promise<void>; setRecurringRuleActive: (ruleId: string, active: boolean) => Promise<void>; removeRecurringRule: (ruleId: string) => Promise<void>;
  addCategory: (input: CategoryInput) => Promise<void>; editCategory: (categoryId: string, input: CategoryUpdate) => Promise<void>;
  addBudget: (input: BudgetInput) => Promise<void>; editBudget: (categoryId: string, input: BudgetInput) => Promise<void>; removeBudget: (categoryId: string) => Promise<void>; dismissBudgetAlert: (alertId: string) => Promise<void>;
  addSavingsGoal: (input: SavingsGoalInput) => Promise<void>; editSavingsGoal: (goalId: string, input: SavingsGoalUpdate) => Promise<void>; cancelSavingsGoal: (goalId: string, input?: Pick<SavingsGoalCancellationInput, 'returnFunds'>) => Promise<void>; settleSavingsGoal: (goalId: string, input: Pick<SavingsGoalCancellationInput, 'returnFunds'>) => Promise<void>; contributeToSavingsGoal: (goalId: string, input: SavingsGoalContributionInput) => Promise<void>;
  inviteSavingsGoalParticipant: (goalId: string, input: SavingsGoalParticipantInput) => Promise<void>;
  respondToSavingsGoalInvitation: (participantId: string, input: SavingsGoalInvitationResponse) => Promise<void>;
  addSavingsAccount: (input: SavingsAccountInput) => Promise<void>; editSavingsAccount: (accountId: string, input: SavingsAccountUpdate) => Promise<void>;
  updateAllocations: (allocations: HouseholdAllocation[]) => Promise<void>; transferMaster: (targetUserId: string) => Promise<void>; removeMember: (userId: string) => Promise<void>;
};
const LedgerContext = createContext<LedgerContextValue | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<HouseholdState | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const outboxRef = useRef<OutboxItem[]>([]);
  const [quarantinedOutbox, setQuarantinedOutbox] = useState<QuarantinedOutboxItem[]>([]);
  const [dashboardPersonalAccountId, setDashboardPersonalAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(false);
  const [discoveringServer, setDiscoveringServer] = useState(false);
  const [discoveryMessage, setDiscoveryMessage] = useState('');
  const [discoveredServers, setDiscoveredServers] = useState<LanServer[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const syncRef = useRef<() => Promise<void>>(async () => {});
  const discoveryFlight = useRef<Promise<boolean> | null>(null);
  const discoveryController = useRef<AbortController | null>(null);
  const lastDiscoveryAt = useRef(0);
  const serverRebinding = useRef(false);
  const syncGate = useRef(createSyncGate());
  const householdGeneration = useRef(0);
  const requiringPair = useRef(false);
  const activeSessionRef = useRef<Session | null>(null);
  const quarantineCleanup = useRef<Promise<QuarantinedOutboxItem[]> | null>(null);
  const storageRecoveryRequired = useRef(false);
  const recoverySyncResult = useRef<{ token: string; generation: number; succeeded: boolean } | null>(null);
  const setOutboxCurrent = useCallback((nextOutbox: OutboxItem[]) => {
    outboxRef.current = nextOutbox;
    setOutbox(nextOutbox);
  }, []);

  const persist = useCallback(async (
    nextState: HouseholdState | null,
    nextSession: Session | null,
    _nextOutbox: OutboxItem[],
    cursor?: number,
    expectedGeneration = householdGeneration.current,
    isPairCommit = false,
  ) => enqueueStorage(async () => {
    const isCurrent = () => canPersistGeneration(expectedGeneration, householdGeneration.current, requiringPair.current, isPairCommit)
      && nextSession !== null
      && activeSessionRef.current?.token === nextSession.token;
    if (!isCurrent()) return false;
    if (isPairCommit) {
      const committed = await householdStorage.commit(JSON.stringify(nextSession), [
        JSON.stringify(nextState), JSON.stringify(_nextOutbox), String(cursor ?? nextState?.serverSequence ?? 0),
      ], isCurrent);
      if (!committed || !isCurrent()) return false;
      storageRecoveryRequired.current = false;
      requiringPair.current = false;
      return true;
    }
    // Protect credentials before replacing any household cache or pending work.
    if (!await deviceSessionStorage.save(JSON.stringify(nextSession), isCurrent)) return false;
    if (!isCurrent()) return false;
    if (nextState) {
      await AsyncStorage.setItem(STATE, JSON.stringify(nextState));
      if (!isCurrent()) return false;
    }
    await AsyncStorage.setItem(OUTBOX, JSON.stringify(outboxRef.current));
    if (!isCurrent()) return false;
    if (cursor !== undefined) await AsyncStorage.setItem(CURSOR, String(cursor));
    if (!isCurrent()) return false;
    return true;
  }), []);

  const applyServerAddress = useCallback(async (server: LanServer, expectedGeneration: number, active: Session) => {
    if (expectedGeneration !== householdGeneration.current || requiringPair.current || activeSessionRef.current?.token !== active.token) return false;
    // Invalidate old-origin responses, but do not replace the household/cache,
    // clear pending operations or create a new device session.
    const generation = ++householdGeneration.current;
    serverRebinding.current = true;
    const nextSession = { ...active, serverAddress: server.address, serverId: server.id, serverScope: active.serverScope ?? active.serverAddress };
    activeSessionRef.current = nextSession;
    try {
      const saved = await persist(null, nextSession, outboxRef.current, undefined, generation);
      if (!saved || generation !== householdGeneration.current) {
        if (generation === householdGeneration.current) activeSessionRef.current = active;
        return false;
      }
      setBaseUrl(server.address);
      setSession(nextSession);
      setOnline(false);
      setDiscoveryMessage('');
      setDiscoveredServers([]);
      // Run after this discovery/sync flight releases its gate.
      setTimeout(() => { void syncRef.current(); }, 0);
      return true;
    } catch (error) {
      if (generation === householdGeneration.current) activeSessionRef.current = active;
      throw error;
    } finally { serverRebinding.current = false; }
  }, [persist]);

  const recoverServer = useCallback((active: Session, currentState: HouseholdState, force = false): Promise<boolean> => {
    if (discoveryFlight.current) return discoveryFlight.current;
    if (Platform.OS === 'web') {
      if (force) setDiscoveryMessage('Wi-Fi discovery is available in the phone app. Enter the server address instead.');
      return Promise.resolve(false);
    }
    const port = localServerPort(active.serverAddress);
    if (!port || requiringPair.current || (!force && Date.now() - lastDiscoveryAt.current < 120_000)) return Promise.resolve(false);
    const generation = householdGeneration.current;
    const controller = new AbortController();
    discoveryController.current = controller;
    const isCurrent = () => !controller.signal.aborted && generation === householdGeneration.current && activeSessionRef.current?.token === active.token && !requiringPair.current;
    const work = (async () => {
      try {
        const network = await Network.getNetworkStateAsync();
        if (!network.isConnected || !isCurrent()) return false;
        const localIp = await Network.getIpAddressAsync();
        if (!isCurrent()) return false;
        lastDiscoveryAt.current = Date.now();
        setDiscoveringServer(true); setDiscoveryMessage(''); setDiscoveredServers([]);
        const servers = await discoverLanServers({ localIp, port, variant: isAcceleratedTestBuild ? 'accelerated-test' : 'production', signal: controller.signal });
        const verified: LanServer[] = [];
        for (const server of servers) {
          if (!isCurrent()) return false;
          try { if (await verifyServer(server, active, currentState.groupId, controller.signal)) verified.push(server); } catch { /* Different household or unavailable candidate. */ }
        }
        if (!isCurrent()) return false;
        const selected = preferredServer(verified, active.serverId);
        if (selected) return await applyServerAddress(selected, generation, active);
        setDiscoveredServers(verified);
        if (verified.length > 1) setDiscoveryMessage('More than one household server found. Choose one in Settings.');
        else if (force) setDiscoveryMessage('No household server found. Check Wi-Fi or enter its address.');
        return false;
      } catch (error) {
        if (isCurrent()) setDiscoveryMessage(error instanceof Error ? error.message : 'Could not search this Wi-Fi network.');
        return false;
      } finally {
        if (discoveryController.current === controller) {
          discoveryController.current = null;
          setDiscoveringServer(false);
        }
      }
    })();
    discoveryFlight.current = work;
    void work.finally(() => { if (discoveryFlight.current === work) discoveryFlight.current = null; });
    return work;
  }, [applyServerAddress]);

  const findServer = useCallback(async () => {
    const active = activeSessionRef.current;
    if (active && stateRef.current) await recoverServer(active, stateRef.current, true);
  }, [recoverServer]);

  const changeServerAddress = useCallback(async (address: string) => {
    const active = activeSessionRef.current;
    const current = stateRef.current;
    if (!active || !current || requiringPair.current) throw new Error('Pair this device before changing its server address.');
    discoveryController.current?.abort();
    const generation = householdGeneration.current;
    const server = await identifyServer(normalizeServerAddress(address), isAcceleratedTestBuild ? 'accelerated-test' : 'production');
    if (!server || !await verifyServer(server, active, current.groupId)) throw new Error('This server does not match your household and device access. Your saved address was not changed.');
    if (!await applyServerAddress(server, generation, active)) throw new Error('The server change was interrupted. Please retry.');
  }, [applyServerAddress]);

  const performSync = useCallback((activeSession: Session, currentState: HouseholdState, currentOutbox: OutboxItem[]) => syncGate.current(`${householdGeneration.current}:${activeSession.token}:${activeSession.serverAddress}`, async () => {
    if (requiringPair.current || serverRebinding.current || activeSessionRef.current?.token !== activeSession.token || activeSessionRef.current.serverAddress !== activeSession.serverAddress) return;
    const generation = householdGeneration.current;
    recoverySyncResult.current = { token: activeSession.token, generation, succeeded: false };
    try {
      let verifiedServerId = activeSession.serverId;
      if (localServerPort(activeSession.serverAddress) !== null) {
        // An old DHCP address may now belong to another machine. Prove server
        // possession of this device's secret before sending any bearer token.
        try {
          const server = await identifyServer(activeSession.serverAddress, isAcceleratedTestBuild ? 'accelerated-test' : 'production');
          if (!server || !await verifyServer(server, activeSession, currentState.groupId)) throw new Error('Server identity did not match');
          verifiedServerId = server.id;
        } catch {
          throw new Error('The saved address is not a verified household server.');
        }
      }
      if (generation !== householdGeneration.current || requiringPair.current || serverRebinding.current) return;
      const cursorValue = await enqueueStorage(() => AsyncStorage.getItem(CURSOR));
      if (generation !== householdGeneration.current || requiringPair.current || serverRebinding.current) return;
      if (generation !== householdGeneration.current || requiringPair.current) return;
      const cursor = Number(cursorValue ?? currentState.serverSequence ?? 0);
      const response = await withNetworkDeadline((signal) => syncOperations({ cursor, operations: sharedOnlyOperations(currentOutbox) }, { headers: deviceHeaders(activeSession.token), signal }));
      if (generation !== householdGeneration.current || requiringPair.current) return;
      const completed = new Set(response.acknowledgements.map((acknowledgement) => acknowledgement.operationId));
      const rejected = response.acknowledgements.filter((acknowledgement) => acknowledgement.status === 'rejected');
      if (rejected.length) {
        const rejectedIds = new Set(rejected.map((acknowledgement) => acknowledgement.operationId));
        const rejectedOperations = mergeUniqueOperations(currentOutbox, outboxRef.current)
          .filter((operation) => rejectedIds.has(operation.operationId));
        if (rejectedOperations.length) {
          const nextQuarantine = await enqueueStorage(async () => {
            const saved = JSON.parse(await AsyncStorage.getItem(QUARANTINED_OUTBOX) ?? '[]') as QuarantinedOutboxItem[];
            const combined = appendQuarantinedOperations(saved, rejectedOperations, new Date().toISOString());
            await AsyncStorage.setItem(QUARANTINED_OUTBOX, JSON.stringify(combined));
            return combined;
          });
          setQuarantinedOutbox(nextQuarantine);
        }
      }
      const latestState = await withNetworkDeadline((signal) => getBootstrap({ headers: deviceHeaders(activeSession.token), signal }));
      if (generation !== householdGeneration.current || requiringPair.current) return;
      // Entries may have been saved while bootstrap was in flight. Read the live
      // queue only now, and apply both values without another asynchronous gap.
      const { remaining, nextState } = reconcileSyncSnapshot(latestState, outboxRef.current, completed);
      const nextSession = { ...activeSession, serverId: verifiedServerId, user: latestState.users.find((user) => user.id === activeSession.user.id) ?? activeSession.user };
      if (generation !== householdGeneration.current) return;
      activeSessionRef.current = nextSession;
      setState(nextState); setSession(nextSession); setOutboxCurrent(remaining); setOnline(true);
      const persisted = await persist(nextState, nextSession, remaining, latestState.serverSequence, generation);
      if (!persisted || generation !== householdGeneration.current) return;
      const nextDashboard = await withNetworkDeadline((signal) => getDashboard({ headers: deviceHeaders(activeSession.token), signal }));
      if (generation !== householdGeneration.current) return;
      setDashboard(nextDashboard);
      recoverySyncResult.current = {
        token: activeSession.token,
        generation,
        succeeded: rejected.length === 0 && remaining.length === 0,
      };
      if (rejected.length) {
        const details = rejected.map((acknowledgement) => acknowledgement.error).filter(Boolean).join('\n');
        Alert.alert('Some entries could not sync', details || 'The server rejected a pending change. Your ledger has been restored to the latest saved state.');
      }
    } catch (error) {
      recoverySyncResult.current = { token: activeSession.token, generation, succeeded: false };
      const isUnauthorized = error instanceof Error && error.name === 'ApiError' && 'status' in error && error.status === 401;
      if (isUnauthorized && generation === householdGeneration.current && !requiringPair.current) {
        // Invalidate every sync/persist already in flight before the first await.
        requiringPair.current = true;
        const quarantineGeneration = ++householdGeneration.current;
        let quarantineSaved = false;
        let savedQuarantine: QuarantinedOutboxItem[] = [];
        const cleanup = enqueueStorage(async () => {
          const storedOutbox = JSON.parse(await AsyncStorage.getItem(OUTBOX) ?? '[]') as OutboxItem[];
          const pendingOutbox = mergeUniqueOperations(storedOutbox, currentOutbox, outboxRef.current);
          const saved = JSON.parse(await AsyncStorage.getItem(QUARANTINED_OUTBOX) ?? '[]') as QuarantinedOutboxItem[];
          const existingIds = new Set(saved.map((entry) => entry.operation.operationId));
          savedQuarantine = [
            ...saved,
            ...pendingOutbox.filter((operation) => !existingIds.has(operation.operationId)).map((operation) => ({ operation, quarantinedAt: new Date().toISOString() })),
          ];
          // Quarantine first; the serialized cleanup then removes only active keys.
          await AsyncStorage.setItem(QUARANTINED_OUTBOX, JSON.stringify(savedQuarantine));
          quarantineSaved = true;
          await householdStorage.recover();
          await deviceSessionStorage.clear();
          await deviceSessionStorage.clearRecoverySession();
          await AsyncStorage.multiRemove([STATE, OUTBOX, CURSOR]);
          return savedQuarantine;
        });
        quarantineCleanup.current = cleanup;
        try {
          const nextQuarantine = await cleanup;
          if (quarantineCleanup.current === cleanup) quarantineCleanup.current = null;
          if (quarantineGeneration !== householdGeneration.current) return;
          activeSessionRef.current = null;
          setQuarantinedOutbox(nextQuarantine);
          setSession(null); setState(null); setDashboard(null); setOutboxCurrent([]); setDashboardPersonalAccountId(null); setOnline(false);
          setBaseUrl(null);
          router.replace('/pair' as never);
        } catch (quarantineError) {
          if (quarantineCleanup.current === cleanup) quarantineCleanup.current = null;
          setOnline(false);
          if (quarantineSaved) {
            // The outbox is safe in quarantine. Pairing writes are queued after
            // this failed cleanup, so they cannot be removed by this operation.
            if (quarantineGeneration === householdGeneration.current) {
              activeSessionRef.current = null;
              setQuarantinedOutbox(savedQuarantine);
              setSession(null); setState(null); setDashboard(null); setOutboxCurrent([]); setDashboardPersonalAccountId(null);
              setBaseUrl(null);
              router.replace('/pair' as never);
            }
            Alert.alert('Pending changes saved for review', 'The old session could not be fully cleared. Pair this device again before continuing.');
          } else {
            requiringPair.current = false;
            Alert.alert('Could not protect pending changes', quarantineError instanceof Error ? quarantineError.message : 'The current session is still active. Try syncing again.');
          }
        }
      } else if (generation === householdGeneration.current) {
        setOnline(false);
        if (error instanceof Error && error.name === 'ServerCompatibilityError') setDiscoveryMessage(error.message);
        else if (error instanceof SessionStorageError) Alert.alert('Could not save device access', error.message);
        else if (!(error instanceof Error && error.name === 'ApiError')) await recoverServer(activeSession, currentState);
      }
    }
  }), [persist, recoverServer, setOutboxCurrent]);
  const sync = useCallback(async (searchNow = false) => {
    if (searchNow) lastDiscoveryAt.current = 0;
    const active = activeSessionRef.current;
    const current = stateRef.current;
    if (!active || !current) return;
    await performSync(active, current, outboxRef.current);
  }, [performSync]);
  const syncForDeviceRecovery = useCallback(async () => {
    const active = activeSessionRef.current;
    const current = stateRef.current;
    const generation = householdGeneration.current;
    if (loading || quarantinedOutbox.some((entry) => !entry.reviewedAt) || requiringPair.current) return false;
    if (!active || !current) return outboxRef.current.length === 0;
    recoverySyncResult.current = null;
    await performSync(active, current, outboxRef.current);
    const result = recoverySyncResult.current as { token: string; generation: number; succeeded: boolean } | null;
    return result?.token === active.token
      && result.generation === generation
      && result.succeeded
      && outboxRef.current.length === 0
      && !quarantinedOutbox.some((entry) => !entry.reviewedAt)
      && !requiringPair.current
      && householdGeneration.current === generation
      && activeSessionRef.current?.token === active.token;
  }, [loading, quarantinedOutbox, performSync]);

  useEffect(() => {
    let mounted = true;
    const generation = householdGeneration.current;
    const isCurrent = () => mounted && generation === householdGeneration.current;
    const restore = async () => {
      try {
        const [storedSession, storedState, storedOutbox, storedQuarantine] = await enqueueStorage(async () => {
          await householdStorage.recover();
          const savedSession = await deviceSessionStorage.load(isCurrent);
          const cached = await Promise.all([AsyncStorage.getItem(STATE), AsyncStorage.getItem(OUTBOX), AsyncStorage.getItem(QUARANTINED_OUTBOX)]);
          return [savedSession, ...cached];
        });
        if (isCurrent()) {
          if (storedSession) {
            const restored = JSON.parse(storedSession) as Session;
            activeSessionRef.current = restored;
            setBaseUrl(restored.serverAddress.startsWith('http') ? restored.serverAddress : `http://${restored.serverAddress}`);
            setSession(restored);
          }
          const previousOutbox = storedOutbox ? JSON.parse(storedOutbox) as OutboxItem[] : [];
          const normalizedOutbox = sharedOnlyOperations(previousOutbox);
          if (storedState) {
            const restoredState = JSON.parse(storedState) as HouseholdState;
            const pendingIds = new Set(pendingLedgerTransactions(previousOutbox).map((tx) => tx.id));
            const normalizedPending = pendingLedgerTransactions(normalizedOutbox);
            // Replace only unsynced projections. Saved history is adjusted by the server, never erased here.
            setState({ ...restoredState, transactions: [
              ...normalizedPending,
              ...restoredState.transactions.filter((tx) => !pendingIds.has(tx.id)
                && !(tx.linkedExpenseTransactionId && pendingIds.has(tx.linkedExpenseTransactionId))),
            ] });
          }
          setOutboxCurrent(normalizedOutbox);
          if (storedQuarantine) setQuarantinedOutbox(JSON.parse(storedQuarantine));
          setLoading(false);
          storageRecoveryRequired.current = false;
        }
      } catch (error) {
        if (!isCurrent()) return;
        // Leave all stored data intact; never silently start a plaintext session.
        setLoading(false);
        if (error instanceof HouseholdStorageError) storageRecoveryRequired.current = true;
        Alert.alert('Could not restore saved device access', error instanceof Error ? error.message : 'Device storage could not be read.', [
          { text: 'Retry', onPress: () => { if (isCurrent()) { setLoading(true); void restore(); } } },
          { text: 'Cancel', style: 'cancel' },
        ]);
      }
    };
    void restore();
    return () => { mounted = false; };
  }, [setOutboxCurrent]);
  const acknowledgeQuarantinedOutbox = useCallback(async () => {
    try {
      const reviewed = await enqueueStorage(async () => {
        const saved = JSON.parse(await AsyncStorage.getItem(QUARANTINED_OUTBOX) ?? '[]') as QuarantinedOutboxItem[];
        const next = markReviewedOperations(saved, new Date().toISOString());
        const value = JSON.stringify(next);
        await AsyncStorage.setItem(QUARANTINED_OUTBOX, value);
        if (await AsyncStorage.getItem(QUARANTINED_OUTBOX) !== value) throw new Error('Could not verify saved changes.');
        return next;
      });
      setQuarantinedOutbox(reviewed);
    } catch (error) {
      Alert.alert('Could not save review', error instanceof Error ? error.message : 'Please retry. Saved entries were not removed.');
    }
  }, []);
  useEffect(() => { setAuthTokenGetter(() => session?.token ?? null); }, [session]);
  useEffect(() => { syncRef.current = sync; }, [sync]);
  useEffect(() => {
    if (!session?.token) return;
    void syncRef.current();
    const timer = setInterval(() => void syncRef.current(), 12000);
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') { lastDiscoveryAt.current = 0; void syncRef.current(); } });
    // LAN servers may be reachable even when Android reports no Internet access.
    const network = Network.addNetworkStateListener((next) => {
      if (next.isConnected) { lastDiscoveryAt.current = 0; void syncRef.current(); }
    });
    return () => { clearInterval(timer); sub.remove(); network.remove(); discoveryController.current?.abort(); lastDiscoveryAt.current = 0; };
  }, [session?.token]);

  const commitReplacement = useCallback(async (nextState: HouseholdState, nextSession: Session, generation: number) => {
    const previousSession = activeSessionRef.current;
    activeSessionRef.current = nextSession;
    try {
      const persisted = await persist(nextState, nextSession, [], nextState.serverSequence, generation, true);
      if (!persisted || generation !== householdGeneration.current) throw new Error('Saving device access was interrupted by a session change. Please try again.');
      setSession(nextSession); setState(nextState); setDashboard(null); setDashboardPersonalAccountId(null); setOutboxCurrent([]); setOnline(true);
    } catch (error) {
      if (generation === householdGeneration.current) {
        activeSessionRef.current = previousSession;
        if (error instanceof HouseholdStorageError && error.recoveryRequired) {
          storageRecoveryRequired.current = true;
          requiringPair.current = true;
        }
      }
      throw error;
    }
  }, [persist, setOutboxCurrent]);

  const beginReplacement = useCallback(async () => {
    discoveryController.current?.abort();
    setDiscoveryMessage(''); setDiscoveredServers([]);
    const previouslyRequiringPair = requiringPair.current;
    const generation = ++householdGeneration.current;
    requiringPair.current = true;
    const replacement = {
      generation,
      failed: () => {
        if (generation === householdGeneration.current) {
          requiringPair.current = storageRecoveryRequired.current || previouslyRequiringPair;
          const previous = activeSessionRef.current;
          if (previous) setBaseUrl(previous.serverAddress.startsWith('http') ? previous.serverAddress : `http://${previous.serverAddress}`);
        }
      },
    };
    try {
      // A manually renewed invitation may not pass through the 401 cleanup.
      // Protect pending work before an API call can replace household access.
      const preserved = await enqueueStorage(async () => {
        await householdStorage.recover();
        return preservePendingForReplacement(AsyncStorage, {
          outboxKey: OUTBOX, reviewKey: QUARANTINED_OUTBOX,
          operations: outboxRef.current, quarantinedAt: new Date().toISOString(),
          isCurrent: () => generation === householdGeneration.current,
        });
      });
      if (preserved === null || generation !== householdGeneration.current) throw new Error('Household access change was interrupted. Please retry.');
      setQuarantinedOutbox(preserved);
      return replacement;
    } catch (error) {
      replacement.failed();
      throw error;
    }
  }, []);

  const pair = useCallback(async (serverAddress: string, code: string) => {
    if (quarantineCleanup.current) await quarantineCleanup.current;
    const replacement = await beginReplacement();
    const { generation } = replacement;
    try {
      setBaseUrl(serverAddress.startsWith('http') ? serverAddress : `http://${serverAddress}`);
      // Each authorization creates its own session identity; never replace another
      // phone's session by reusing an installation-supplied device ID.
      const deviceId = id();
      await AsyncStorage.setItem(DEVICE, deviceId);
      const result = await redeemHouseholdInvitation({ invitationCode: code.replace(/[\s-]/g, '').toUpperCase(), deviceId, deviceName: pairedDeviceName() });
      if (generation !== householdGeneration.current) throw new Error('Pairing was interrupted by a session change. Please try again.');
      const nextSession = { token: result.deviceToken, user: result.user, deviceId, serverAddress };
      await commitReplacement(result.state, nextSession, generation);
    } catch (error) {
      replacement.failed();
      throw error;
    }
  }, [beginReplacement, commitReplacement]);
  const setup = useCallback(async (serverAddress: string, input: Omit<HouseholdSetupInput, 'deviceId' | 'deviceName'>) => {
    if (quarantineCleanup.current) await quarantineCleanup.current;
    const replacement = await beginReplacement();
    const { generation } = replacement;
    try {
      setBaseUrl(serverAddress.startsWith('http') ? serverAddress : `http://${serverAddress}`);
      const deviceId = await AsyncStorage.getItem(DEVICE) ?? id();
      await AsyncStorage.setItem(DEVICE, deviceId);
      const result = await setupHouseholdRequest({ ...input, deviceId, deviceName: pairedDeviceName() });
      if (generation !== householdGeneration.current) throw new Error('Household setup was interrupted by a session change. Please try again.');
      const nextSession = { token: result.deviceToken, user: result.user, deviceId, serverAddress };
      await commitReplacement(result.state, nextSession, generation);
    } catch (error) {
      replacement.failed();
      throw error;
    }
  }, [beginReplacement, commitReplacement]);
  const reinitialize = useCallback(async (input: Omit<HouseholdReinitializationInput, 'deviceId' | 'deviceName' | 'confirmation'>) => {
    if (!session || session.user.role !== 'master') throw new Error('Only the household master can reinitialize the household.');
    if (requiringPair.current) throw new Error('Pair this device again before reinitializing the household.');
    const replacement = await beginReplacement();
    const { generation } = replacement;
    try {
      const deviceId = session.deviceId || await AsyncStorage.getItem(DEVICE) || id();
      await AsyncStorage.setItem(DEVICE, deviceId);
      const result = await reinitializeHouseholdRequest({ ...input, deviceId, deviceName: pairedDeviceName(), confirmation: 'REINITIALIZE HOUSEHOLD' }, { headers: deviceHeaders(session.token) });
      if (generation !== householdGeneration.current) throw new Error('Reinitialization was interrupted by a session change.');
      const nextSession = { token: result.deviceToken, user: result.user, deviceId, serverAddress: session.serverAddress };
      await commitReplacement(result.state, nextSession, generation);
    } catch (error) {
      replacement.failed();
      throw error;
    }
  }, [beginReplacement, commitReplacement, session]);
  const demo = useCallback(async (serverAddress: string) => {
    setBaseUrl(serverAddress.startsWith('http') ? serverAddress : `http://${serverAddress}`);
    await resetDemo();
  }, []);
  const logout = useCallback(async () => {
    discoveryController.current?.abort();
    setDiscoveryMessage(''); setDiscoveredServers([]);
    const generation = ++householdGeneration.current;
    requiringPair.current = true;
    try {
      await enqueueStorage(async () => {
        await householdStorage.recover();
        const preserved = await preservePendingForReplacement(AsyncStorage, {
          outboxKey: OUTBOX, reviewKey: QUARANTINED_OUTBOX,
          operations: outboxRef.current, quarantinedAt: new Date().toISOString(),
          isCurrent: () => generation === householdGeneration.current,
        });
        if (preserved === null || generation !== householdGeneration.current) throw new Error('Sign-out was interrupted. Your saved changes were not removed.');
        setQuarantinedOutbox(preserved);
        await deviceSessionStorage.clear();
        await deviceSessionStorage.clearRecoverySession();
        await AsyncStorage.multiRemove([STATE, OUTBOX, CURSOR]);
      });
    } catch (error) {
      // Block sync after incomplete removal; don't report a successful logout.
      Alert.alert('Could not remove saved device access', error instanceof Error ? error.message : 'Please retry logging out.');
      throw error;
    }
    if (generation !== householdGeneration.current) return;
    activeSessionRef.current = null;
    setSession(null); setState(null); setDashboard(null); setOutboxCurrent([]); setDashboardPersonalAccountId(null); setOnline(false);
  }, [setOutboxCurrent]);
  const resetLedger = useCallback(async () => {
    if (!session || !state) throw new Error('Pair this device before resetting the ledger.');
    if (requiringPair.current) throw new Error('Pair this device again before resetting the ledger.');
    const generation = householdGeneration.current;
    const result = await resetLedgerRequest({ headers: { 'x-device-token': session.token } });
    if (generation !== householdGeneration.current || requiringPair.current) throw new Error('Ledger reset was interrupted by a session change.');
    const refreshedState = await getBootstrap({ headers: deviceHeaders(session.token) });
    if (generation !== householdGeneration.current || requiringPair.current) throw new Error('Ledger reset was interrupted by a session change.');
    const nextState = { ...refreshedState, serverSequence: result.serverSequence };
    setState(nextState); setOutboxCurrent([]); setOnline(true);
    await persist(nextState, session, [], result.serverSequence);
    const nextDashboard = await getDashboard({ headers: { 'x-device-token': session.token } });
    setDashboard(nextDashboard);
  }, [persist, session, state, setOutboxCurrent]);
  const advanceBusinessTime = useCallback(async (unit: 'day' | 'week' | 'month') => {
    if (!isAcceleratedTestBuild || !session || !state || !state.acceleratedTest || session.user.role !== 'master') {
      throw new Error('Accelerated test time is unavailable.');
    }
    const result = await advanceTestClock({ unit }, { headers: deviceHeaders(session.token) });
    const nextState = result.state;
    setState(nextState); setOnline(true);
    await persist(nextState, session, outbox, nextState.serverSequence);
    try { setDashboard(await getDashboard({ headers: deviceHeaders(session.token) })); } catch { /* state is authoritative */ }
  }, [outbox, persist, session, state]);
  const addTransaction = useCallback(async (kind: Transaction['kind'], amountMinor: number, note: string, accountId: string, categoryId: string, destinationAccountId?: string, occurredAtInput?: string, personalPayerAccountId?: string | null) => {
    if (requiringPair.current) throw new Error('Pair this device again before creating another activity.');
    if (!session || !state || !amountMinor || amountMinor < 1) throw new Error('Enter an amount greater than zero.');
    if (kind === 'transfer' && (!destinationAccountId || destinationAccountId === accountId)) throw new Error('Transfers need a different destination account.');
    const occurredAtDate = occurredAtInput ? new Date(occurredAtInput) : businessNow(state);
    if (Number.isNaN(occurredAtDate.getTime())) throw new Error('Enter a valid activity date.');
    const occurredAt = occurredAtDate.toISOString();
    const payerAccountId = personalPayerAccountId === undefined
      ? defaultPersonalPayerAccountId({ kind, accountId }, state.accounts, session.user.id)
      : personalPayerAccountId;
    if (kind === 'expense' && state.accounts.some((account) => account.id === accountId && account.kind === 'shared')
      && personalPayerAccountId === undefined && !payerAccountId) {
      throw new Error('An active Main personal account is required to attribute this Shared purchase.');
    }
    const transaction: Transaction = {
      id: id(), kind, accountId, destinationAccountId: kind === 'transfer' ? destinationAccountId ?? null : null,
      amountMinor, currency: state.baseCurrency, categoryId, note: note.trim() || 'Untitled transaction',
      occurredAt, createdByUserId: session.user.id, status: 'posted', reversesTransactionId: null,
      ...(payerAccountId ? { personalPayerAccountId: payerAccountId } : {}),
      allocationShares: state.users.map((user, index) => ({
        userId: user.id, basisPoints: user.defaultShareBps,
        amountMinor: index === state.users.length - 1
          ? amountMinor - state.users.slice(0, -1).reduce((sum, u) => sum + Math.round(amountMinor * u.defaultShareBps / 10000), 0)
          : Math.round(amountMinor * user.defaultShareBps / 10000),
      })),
    };
     const operation: OutboxItem = { operationId: id(), deviceId: session.deviceId, clientCreatedAt: businessNow(state).toISOString(), type: 'transaction.create', payload: { transaction } };
    const nextState = { ...state, transactions: [...projectPurchase(transaction), ...state.transactions] };
    const nextOutbox = [...outboxRef.current, operation];
    setState(nextState); setOutboxCurrent(nextOutbox); await persist(nextState, session, nextOutbox); void performSync(session, nextState, nextOutbox);
  }, [performSync, persist, session, state, setOutboxCurrent]);
  const correctTransaction = useCallback(async (transactionId: string, input: Omit<TransactionCorrectionInput, 'operationId'>) => {
    if (!session) throw new Error('Pair this device before correcting an activity.');
    const authoritativeState = await correctTransactionRequest(transactionId, { ...input, operationId: id() }, { headers: deviceHeaders(session.token) });
    const transactionMap = new Map(authoritativeState.transactions.map((transaction) => [transaction.id, transaction]));
    pendingLedgerTransactions(outbox).forEach((transaction) => transactionMap.set(transaction.id, transaction));
    const nextState = { ...authoritativeState, transactions: [...transactionMap.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)) };
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
  }, [outbox, persist, session]);
  const cancelTransaction = useCallback(async (transactionId: string) => {
    if (!session) throw new Error('Pair this device before cancelling an activity.');
    const authoritativeState = await cancelTransactionRequest(transactionId, { operationId: id() }, { headers: deviceHeaders(session.token) });
    const transactionMap = new Map(authoritativeState.transactions.map((transaction) => [transaction.id, transaction]));
    pendingLedgerTransactions(outbox).forEach((transaction) => transactionMap.set(transaction.id, transaction));
    const nextState = { ...authoritativeState, transactions: [...transactionMap.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)) };
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
  }, [outbox, persist, session]);
  const addRecurringRule = useCallback(async (input: RecurringRuleInput) => {
    if (!session || !state) throw new Error('Pair this device before adding a recurring entry.');
    const rule = await createRecurringRuleRequest(input, { headers: { 'x-device-token': session.token } });
    const nextState = { ...state, recurringRules: [rule, ...(state.recurringRules ?? [])] };
    setState(nextState); setOnline(true); await persist(nextState, session, outbox);
  }, [outbox, persist, session, state]);
  const setRecurringRuleActive = useCallback(async (ruleId: string, active: boolean) => {
    if (!session || !state) throw new Error('Pair this device before updating a recurring entry.');
    const rule = await updateRecurringRuleRequest(ruleId, { active }, { headers: { 'x-device-token': session.token } });
    const nextState = { ...state, recurringRules: (state.recurringRules ?? []).map((item) => item.id === ruleId ? rule : item) };
    setState(nextState); setOnline(true); await persist(nextState, session, outbox);
  }, [outbox, persist, session, state]);
  const editRecurringRule = useCallback(async (ruleId: string, input: RecurringRuleInput) => {
    if (!session || !state) throw new Error('Pair this device before editing a recurring entry.');
    const rule = await updateRecurringRuleRequest(ruleId, input, { headers: { 'x-device-token': session.token } });
    const nextState = { ...state, recurringRules: (state.recurringRules ?? []).map((item) => item.id === ruleId ? rule : item) };
    setState(nextState); setOnline(true); await persist(nextState, session, outbox);
  }, [outbox, persist, session, state]);
  const removeRecurringRule = useCallback(async (ruleId: string) => {
    if (!session || !state) throw new Error('Pair this device before deleting a recurring entry.');
    await deleteRecurringRuleRequest(ruleId, { headers: { 'x-device-token': session.token } });
    const nextState = { ...state, recurringRules: (state.recurringRules ?? []).filter((item) => item.id !== ruleId) };
    setState(nextState); setOnline(true); await persist(nextState, session, outbox);
  }, [outbox, persist, session, state]);
  const addCategory = useCallback(async (input: CategoryInput) => {
    if (!session) throw new Error('Pair this device before adding a category.');
    const nextState = await createCategoryRequest(input, { headers: deviceHeaders(session.token) });
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
  }, [outbox, persist, session]);
  const editCategory = useCallback(async (categoryId: string, input: CategoryUpdate) => {
    if (!session) throw new Error('Pair this device before updating a category.');
    const nextState = await updateCategoryRequest(categoryId, input, { headers: deviceHeaders(session.token) });
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
  }, [outbox, persist, session]);
  const addBudget = useCallback(async (input: BudgetInput) => {
    if (!session) throw new Error('Pair this device before adding a budget.');
    const nextState = await createBudgetRequest(input, { headers: deviceHeaders(session.token) });
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
  }, [outbox, persist, session]);
  const editBudget = useCallback(async (categoryId: string, input: BudgetInput) => {
    if (!session) throw new Error('Pair this device before updating a budget.');
    const nextState = await updateBudgetRequest(categoryId, input, { headers: deviceHeaders(session.token) });
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
  }, [outbox, persist, session]);
  const removeBudget = useCallback(async (categoryId: string) => {
    if (!session) throw new Error('Pair this device before disabling a budget.');
    await deleteBudgetRequest(categoryId, { headers: deviceHeaders(session.token) });
    const nextState = await getBootstrap({ headers: deviceHeaders(session.token) });
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
  }, [outbox, persist, session]);
  const dismissBudgetAlert = useCallback(async (alertId: string) => {
    if (!session) throw new Error('Pair this device before dismissing a budget alert.');
    const nextState = await acknowledgeBudgetAlertRequest(alertId, { headers: deviceHeaders(session.token) });
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
  }, [outbox, persist, session]);
  const addSavingsGoal = useCallback(async (input: SavingsGoalInput) => {
    if (!session) throw new Error('Pair this device before adding a savings goal.');
    const nextState = await createSavingsGoalRequest(input, { headers: deviceHeaders(session.token) });
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
  }, [outbox, persist, session]);
  const editSavingsGoal = useCallback(async (goalId: string, input: SavingsGoalUpdate) => {
    if (!session) throw new Error('Pair this device before updating a savings goal.');
    const nextState = await updateSavingsGoalRequest(goalId, input, { headers: deviceHeaders(session.token) });
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
  }, [outbox, persist, session]);
  const cancelSavingsGoal = useCallback(async (goalId: string, input: Pick<SavingsGoalCancellationInput, 'returnFunds'> = {}) => {
    if (!session) throw new Error('Pair this device before cancelling a savings goal.');
    const nextState = await cancelSavingsGoalRequest(goalId, { operationId: id(), ...input }, { headers: deviceHeaders(session.token) });
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
    try { setDashboard(await getDashboard({ headers: deviceHeaders(session.token) })); } catch { /* state remains authoritative */ }
  }, [outbox, persist, session]);
  const settleSavingsGoal = useCallback(async (goalId: string, input: Pick<SavingsGoalCancellationInput, 'returnFunds'>) => {
    if (!session) throw new Error('Pair this device before settling savings funds.');
    const nextState = await settleSavingsGoalRequest(goalId, { operationId: id(), ...input }, { headers: deviceHeaders(session.token) });
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
    try { setDashboard(await getDashboard({ headers: deviceHeaders(session.token) })); } catch { /* state remains authoritative */ }
  }, [outbox, persist, session]);
  const contributeToSavingsGoal = useCallback(async (goalId: string, input: SavingsGoalContributionInput) => {
    if (!session) throw new Error('Pair this device before contributing to a savings goal.');
    // The contribution endpoint returns the complete authoritative HouseholdState,
    // including account balances, transactions, and goal progress.
    const nextState = await contributeToSavingsGoalRequest(goalId, input, { headers: deviceHeaders(session.token) });
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
    try { setDashboard(await getDashboard({ headers: deviceHeaders(session.token) })); } catch { /* authoritative ledger state is already applied */ }
  }, [outbox, persist, session]);
  const inviteSavingsGoalParticipant = useCallback(async (goalId: string, input: SavingsGoalParticipantInput) => {
    if (!session) throw new Error('Pair this device before inviting a goal participant.');
    const nextState = await inviteSavingsGoalParticipantRequest(goalId, input, { headers: deviceHeaders(session.token) });
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
  }, [outbox, persist, session]);
  const cancelSavingsGoalContribution = useCallback(async (goalId: string, contributionId: string, operationId = id()) => {
    if (!session) throw new Error('Pair this device before cancelling a contribution.');
    if (!online) throw new Error('Connect to the server before cancelling a contribution.');
    const generation = householdGeneration.current;
    const nextState = await cancelSavingsGoalContributionRequest(goalId, contributionId, { operationId }, { headers: deviceHeaders(session.token) });
    if (generation !== householdGeneration.current) throw new Error('Device access changed. Refresh the current household before continuing.');
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence, generation);
    try {
      const nextDashboard = await getDashboard({ headers: deviceHeaders(session.token) });
      if (generation === householdGeneration.current) setDashboard(nextDashboard);
    } catch { /* authoritative state already applied */ }
  }, [online, outbox, persist, session]);
  const respondToSavingsGoalInvitation = useCallback(async (participantId: string, input: SavingsGoalInvitationResponse) => {
    if (!session) throw new Error('Pair this device before responding to a goal invitation.');
    const nextState = await respondToSavingsGoalInvitationRequest(participantId, input, { headers: deviceHeaders(session.token) });
    setState(nextState); setOnline(true); await persist(nextState, session, outbox, nextState.serverSequence);
  }, [outbox, persist, session]);
  const addSavingsAccount = useCallback(async (input: SavingsAccountInput) => {
    if (!session || !state) throw new Error('Pair this device before adding a savings account.');
    const account = await createSavingsAccountRequest(input, { headers: deviceHeaders(session.token) });
    const nextState = { ...state, accounts: [...state.accounts, account] };
    setState(nextState); setOnline(true); await persist(nextState, session, outbox);
    try { setDashboard(await getDashboard({ headers: deviceHeaders(session.token) })); } catch { /* account state remains usable offline */ }
  }, [outbox, persist, session, state]);
  const editSavingsAccount = useCallback(async (accountId: string, input: SavingsAccountUpdate) => {
    if (!session || !state) throw new Error('Pair this device before updating a savings account.');
    const account = await updateSavingsAccountRequest(accountId, input, { headers: deviceHeaders(session.token) });
    const nextState = { ...state, accounts: state.accounts.map((item) => item.id === account.id ? account : item) };
    setState(nextState); setOnline(true); await persist(nextState, session, outbox);
    try { setDashboard(await getDashboard({ headers: deviceHeaders(session.token) })); } catch { /* account state remains usable offline */ }
  }, [outbox, persist, session, state]);
  const updateAllocations = useCallback(async (allocations: HouseholdAllocation[]) => {
    if (!session || !state) throw new Error('Pair this device before updating allocations.');
    const nextState = await updateHouseholdAllocationsRequest({ allocations }, { headers: { 'x-device-token': session.token } });
    const nextSession = { ...session, user: nextState.users.find((user) => user.id === session.user.id) ?? session.user };
    setState(nextState); setSession(nextSession); setOnline(true);
    await persist(nextState, nextSession, outbox, nextState.serverSequence);
  }, [outbox, persist, session, state]);
  const transferMaster = useCallback(async (targetUserId: string) => {
    if (!session || !state) throw new Error('Pair this device before transferring the master role.');
    const nextState = await transferHouseholdMasterRequest({ targetUserId }, { headers: { 'x-device-token': session.token } });
    const nextSession = { ...session, user: nextState.users.find((user) => user.id === session.user.id) ?? session.user };
    setState(nextState); setSession(nextSession); setOnline(true);
    await persist(nextState, nextSession, outbox, nextState.serverSequence);
  }, [outbox, persist, session, state]);
  const removeMember = useCallback(async (userId: string) => {
    if (!session || !state) throw new Error('Pair this device before removing a member.');
    const nextState = await removeHouseholdMemberRequest(userId, { headers: { 'x-device-token': session.token } });
    setState(nextState); setOnline(true);
    await persist(nextState, session, outbox, nextState.serverSequence);
  }, [outbox, persist, session, state]);
  const value = useMemo(() => ({ session, state, dashboard, outbox, quarantinedOutbox, acknowledgeQuarantinedOutbox, dashboardPersonalAccountId, setDashboardPersonalAccountId, loading, online, pairing: pair, setupHousehold: setup, reinitializeHousehold: reinitialize, demo, logout, resetLedger, advanceBusinessTime, sync, syncForDeviceRecovery, addTransaction, correctTransaction, cancelTransaction, addRecurringRule, editRecurringRule, setRecurringRuleActive, removeRecurringRule, addCategory, editCategory, addBudget, editBudget, removeBudget, dismissBudgetAlert, addSavingsGoal, editSavingsGoal, cancelSavingsGoal, settleSavingsGoal, contributeToSavingsGoal, inviteSavingsGoalParticipant, respondToSavingsGoalInvitation, addSavingsAccount, editSavingsAccount, updateAllocations, transferMaster, removeMember }), [session, state, dashboard, outbox, quarantinedOutbox, acknowledgeQuarantinedOutbox, dashboardPersonalAccountId, loading, online, pair, setup, reinitialize, demo, logout, resetLedger, advanceBusinessTime, sync, syncForDeviceRecovery, addTransaction, correctTransaction, cancelTransaction, addRecurringRule, editRecurringRule, setRecurringRuleActive, removeRecurringRule, addCategory, editCategory, removeBudget, dismissBudgetAlert, addSavingsGoal, editSavingsGoal, cancelSavingsGoal, settleSavingsGoal, contributeToSavingsGoal, inviteSavingsGoalParticipant, respondToSavingsGoalInvitation, addSavingsAccount, editSavingsAccount, updateAllocations, transferMaster, removeMember]);
  const contributionValue = useMemo(() => ({ ...value, cancelSavingsGoalContribution, discoveringServer, discoveryMessage, discoveredServers, findServer, changeServerAddress }), [value, cancelSavingsGoalContribution, discoveringServer, discoveryMessage, discoveredServers, findServer, changeServerAddress]);
  return <LedgerContext.Provider value={contributionValue}>{children}</LedgerContext.Provider>;
}
export function useLedger() { const value = useContext(LedgerContext); if (!value) throw new Error('useLedger must be used within LedgerProvider'); return value; }