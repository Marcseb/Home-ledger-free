import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Button, Card, Field, SectionTitle } from '@/components/Ui';
import { ContextHelp } from '@/components/HelpButton';
import { GoalContributionHistory } from '@/components/GoalContributionHistory';
import { useColors } from '@/hooks/useColors';
import { useLedger } from '@/lib/ledger-context';
import { calculateGoalMetrics } from '@/lib/goal-calculations';
import type { SavingsGoal, SavingsGoalInputPriority } from '@workspace/api-client-react';
import { businessDateValue, businessNow } from '@/lib/app-time';
import { formatCurrency, formatDate, translateLiteral, useI18n } from '@/lib/i18n';

function SwitchButton({ active, label, icon, onPress }: { active: boolean; label: string; icon: keyof typeof Feather.glyphMap; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable testID={`switch-${label}`} onPress={onPress} style={[styles.switch, { backgroundColor: active ? c.primary : c.secondary }]}>
      <Feather name={icon} size={15} color={active ? c.primaryForeground : c.secondaryForeground} />
      <Text style={{ color: active ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

export default function GoalsScreen() {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const { state, session, online, cancelSavingsGoal, settleSavingsGoal, inviteSavingsGoalParticipant, respondToSavingsGoalInvitation } = useLedger();
  const { goalId } = useLocalSearchParams<{ goalId?: string }>();
  const initialGoal = state?.savingsGoals.find((goal) => goal.id === goalId
    && (goal.isShared || goal.ownerUserId === session?.user.id));
  
  const [shared, setShared] = useState(initialGoal?.isShared ?? true);
  const [mode, setMode] = useState<'list' | 'create' | 'edit' | 'details' | 'contribute'>(initialGoal ? 'details' : 'list');
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(initialGoal?.id ?? null);
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteAmount, setInviteAmount] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [participantBusyId, setParticipantBusyId] = useState<string | null>(null);
  const [acceptingParticipantId, setAcceptingParticipantId] = useState<string | null>(null);
  const [acceptMode, setAcceptMode] = useState<'create' | 'existing' | 'none'>('create');
  const [acceptPersonalGoalId, setAcceptPersonalGoalId] = useState<string | null>(null);
  const participantOperationIds = useRef<Record<string, string>>({});
  const operationFor = (key: string) => participantOperationIds.current[key] ??= `goal-participant-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const isMaster = session?.user.role === 'master';
  
  const visibleGoals = useMemo(() => {
    return (state?.savingsGoals ?? []).filter((g) => {
      if (g.status === 'cancelled') return false;
      if (shared) return g.isShared;
      return !g.isShared && g.ownerUserId === session?.user.id;
    });
  }, [state?.savingsGoals, shared, session?.user.id]);
  const cancelledGoals = useMemo(() => (state?.savingsGoals ?? []).filter((g) => g.status === 'cancelled' && (shared ? g.isShared : !g.isShared && g.ownerUserId === session?.user.id)), [state?.savingsGoals, shared, session?.user.id]);

  const canCreate = shared ? isMaster : true;
  const selectedGoal = state?.savingsGoals.find(g => g.id === selectedGoalId) ?? null;

  const confirmCancel = (goalId: string, name: string, personal: boolean) => Alert.alert(
    tr('Cancel goal?'),
    `${tr('Are you sure you want to cancel this goal? Its history will be preserved.')} "${name}". ${tr(personal ? 'You can return transfer-backed funds to Main or leave them in Savings.' : 'Transfer-backed funds remain pending for each contributing owner.')}`,
    [
      { text: tr('Cancel'), style: 'cancel' },
      {
          text: personal ? tr('Leave in Savings') : tr('Cancel goal'),
        style: 'destructive',
        onPress: () => {
          void cancelSavingsGoal(goalId, { returnFunds: false }).catch((error) => Alert.alert(tr('Could not cancel'), error instanceof Error ? error.message : tr('Try again.')));
          setMode('list');
        },
      },
      ...(personal ? [{
         text: tr('Return to Main'),
        style: 'destructive' as const,
        onPress: () => {
          void cancelSavingsGoal(goalId, { returnFunds: true }).catch((error) => Alert.alert(tr('Could not cancel'), error instanceof Error ? error.message : tr('Try again.')));
          setMode('list');
        },
      }] : []),
    ],
  );

  const renderList = () => (
    <>
      <View style={styles.switcher}>
        <SwitchButton active={shared} label={tr('Shared household')} icon="users" onPress={() => setShared(true)} />
        <SwitchButton active={!shared} label={tr('Personal')} icon="user" onPress={() => setShared(false)} />
      </View>
      
      <View style={{ marginBottom: 20 }}>
        <ContextHelp topic="goals" />
          <Pressable
            onPress={() => router.push('/shared-goal-guide')}
            style={[styles.guideLink, { backgroundColor: c.secondary, borderColor: c.border }]}
            testID="open-shared-goal-guide"
          >
            <Feather name="book-open" size={16} color={c.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>{tr('How shared goals work')}</Text>
              <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 17, marginTop: 2 }}>{tr('Follow a Master-to-member example from invitation to contribution.')}</Text>
            </View>
            <Feather name="chevron-right" size={17} color={c.mutedForeground} />
          </Pressable>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
         <SectionTitle>{tr(shared ? 'Shared goals' : 'Personal goals')}</SectionTitle>
        {canCreate && (
           <Pressable onPress={() => setMode('create')} hitSlop={10}>
             <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>{tr('+ Add goal')}</Text>
           </Pressable>
        )}
      </View>

      {visibleGoals.length === 0 ? (
        <Card>
           <Text style={{ fontFamily: 'Inter_700Bold', color: c.foreground, marginBottom: 6 }}>{tr('No goals set up')}</Text>
          <Text style={{ color: c.mutedForeground, lineHeight: 20 }}>
            {tr(shared ? 'Create shared goals for vacations, down payments, or emergency funds.' : 'Create personal goals to save up for your own purchases.')}
          </Text>
        </Card>
      ) : (
        visibleGoals.map(goal => {
          const metrics = calculateGoalMetrics(goal, businessNow(state));
          return (
            <Pressable key={goal.id} onPress={() => { setSelectedGoalId(goal.id); setMode('details'); }}>
              <Card style={{ marginBottom: 12 }}>
                 <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 16, color: c.foreground }}>{goal.name}</Text>
                      <Text style={{ color: c.mutedForeground, fontSize: 12, marginTop: 3 }}>{goal.linkedAccountId ? `${tr('Linked savings')} · ${state?.accounts.find(a => a.id === goal.linkedAccountId)?.name ?? tr('Savings account')}` : tr('Progress only · no account changes')}</Text>
                    </View>
                    <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: metrics.status === 'Ahead' ? c.primary : metrics.status === 'Behind' ? c.destructive : c.mutedForeground }}>{tr(metrics.status)}</Text>
                 </View>
                 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                      <Text style={{ color: c.primary, fontFamily: 'Inter_700Bold', fontSize: 18 }}>{formatCurrency(goal.currentMinor, state?.baseCurrency ?? 'USD', locale)}</Text>
                      <Text style={{ color: c.mutedForeground, fontSize: 13 }}>{tr('of')} {formatCurrency(goal.targetMinor, state?.baseCurrency ?? 'USD', locale)}</Text>
                    </View>
                 </View>
                 <View style={[styles.track, { backgroundColor: c.muted, marginBottom: 12 }]}>
                    <View style={[styles.fill, { backgroundColor: c.primary, width: `${metrics.progress}%` }]} />
                 </View>
                 <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{tr('Due')} {formatDate(goal.dueDate + 'T12:00:00', locale, { month: 'short', year: 'numeric' })}</Text>
                    <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{formatCurrency(metrics.requiredMonthlyMinor, state?.baseCurrency ?? 'USD', locale)}{tr('/mo required')}</Text>
                 </View>
              </Card>
            </Pressable>
          );
        })
      )}
      {cancelledGoals.length > 0 ? (
        <View style={{ marginTop: 22 }}>
          <SectionTitle>{tr('History')}</SectionTitle>
          {cancelledGoals.map((goal) => (
            <Pressable key={goal.id} onPress={() => { setSelectedGoalId(goal.id); setMode('details'); }}>
              <Card style={{ marginBottom: 10, opacity: 0.75 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>{goal.name}</Text>
                  <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{tr('Cancelled')}</Text>
                </View>
                <Text style={{ color: c.mutedForeground, fontSize: 12, marginTop: 5 }}>
                   {formatCurrency(goal.currentMinor, state?.baseCurrency ?? 'USD', locale)} {tr('saved · history only')}
                </Text>
              </Card>
            </Pressable>
          ))}
        </View>
      ) : null}
    </>
  );

  const renderDetails = () => {
    if (!selectedGoal) return null;
    const canManage = selectedGoal.isShared ? isMaster : selectedGoal.ownerUserId === session?.user.id;
    const canContribute = selectedGoal.isShared ? true : selectedGoal.ownerUserId === session?.user.id;
    const metrics = calculateGoalMetrics(selectedGoal, businessNow(state));
    const participants = selectedGoal.participants ?? [];
    const pendingInvitation = participants.find((participant) => participant.userId === session?.user.id && participant.status === 'pending');
    const currentParticipation = participants.find((participant) => participant.userId === session?.user.id && participant.status === 'accepted');
    const personalGoals = (state?.savingsGoals ?? []).filter((goal) => !goal.isShared && goal.ownerUserId === session?.user.id);
    const submitInvite = async () => {
      const amountMinor = Math.round(Number(inviteAmount.replace(',', '.')) * 100);
       if (!inviteUserId) return Alert.alert(tr('Choose a member'), tr('Select a household member first.'));
       if (!amountMinor || amountMinor < 1) return Alert.alert(tr('Check commitment'), tr('Enter a positive committed amount.'));
      setInviteBusy(true);
      const operationKey = `invite-${selectedGoal.id}-${inviteUserId}`;
      try {
        await inviteSavingsGoalParticipant(selectedGoal.id, { userId: inviteUserId, committedMinor: amountMinor, operationId: operationFor(operationKey) });
        delete participantOperationIds.current[operationKey];
        setInviteUserId(''); setInviteAmount('');
      } catch (error) {
        Alert.alert(tr('Could not invite member'), error instanceof Error ? error.message : tr('Try again.'));
      } finally { setInviteBusy(false); }
    };
    const respond = async (
      participant: typeof participants[number],
      status: 'accepted' | 'declined' | 'removed',
      options?: { personalGoalId?: string | null; createPersonalGoal?: boolean },
    ) => {
      const operationKey = `respond-${participant.id}-${status}`;
      setParticipantBusyId(participant.id);
      try {
        await respondToSavingsGoalInvitation(participant.id, {
          status,
          personalGoalId: status === 'accepted' ? (options?.personalGoalId ?? null) : undefined,
          createPersonalGoal: status === 'accepted' ? options?.createPersonalGoal : undefined,
          operationId: operationFor(operationKey),
        });
        delete participantOperationIds.current[operationKey];
        setAcceptingParticipantId(null); setAcceptMode('create'); setAcceptPersonalGoalId(null);
      } catch (error) {
        Alert.alert(tr('Could not update participation'), error instanceof Error ? error.message : tr('Try again.'));
      } finally {
        setParticipantBusyId(null);
      }
    };
    
    return (
      <View>
        <Pressable onPress={() => setMode('list')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 }}>
          <Feather name="arrow-left" size={18} color={c.primary} />
          <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold' }}>{tr('Back to goals')}</Text>
        </Pressable>
        
        <Card style={{ marginBottom: 20 }}>
           <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 22, color: c.foreground }}>{selectedGoal.name}</Text>
              <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: metrics.status === 'Ahead' ? c.primary : metrics.status === 'Behind' ? c.destructive : c.mutedForeground }}>{tr(metrics.status)}</Text>
           </View>
             <Text style={{ color: c.mutedForeground, fontSize: 14, marginBottom: 6 }}>{tr('Due')} {formatDate(selectedGoal.dueDate + 'T12:00:00', locale, { month: 'long', year: 'numeric' })}</Text>
            <Text style={{ color: c.mutedForeground, fontSize: 13, marginBottom: 16 }}>{selectedGoal.linkedAccountId ? `${tr('Linked savings')} · ${state?.accounts.find(a => a.id === selectedGoal.linkedAccountId)?.name ?? tr('Savings account')}` : tr('Progress only · no account balance changes')}</Text>
           
           <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginBottom: 10 }}>
               <Text style={{ color: c.primary, fontFamily: 'Inter_700Bold', fontSize: 28 }}>{formatCurrency(selectedGoal.currentMinor, state?.baseCurrency ?? 'USD', locale)}</Text>
               <Text style={{ color: c.mutedForeground, fontSize: 15 }}>{tr('of')} {formatCurrency(selectedGoal.targetMinor, state?.baseCurrency ?? 'USD', locale)}</Text>
           </View>
           
           <View style={[styles.track, { backgroundColor: c.muted, marginBottom: 16, height: 10 }]}>
              <View style={[styles.fill, { backgroundColor: c.primary, width: `${metrics.progress}%` }]} />
           </View>
           
           <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              {canContribute && (
                <View style={{ flex: 1 }}>
                   <Button label={tr(selectedGoal.linkedAccountId ? 'Transfer and contribute' : 'Update saved amount')} icon={selectedGoal.linkedAccountId ? 'repeat' : 'plus'} onPress={() => setMode('contribute')} disabled={metrics.isComplete} />
                </View>
              )}
           </View>
        </Card>

         {selectedGoal.isShared ? (
           <>
              <SectionTitle>{tr('Participants')}</SectionTitle>
             <Card style={{ marginBottom: 18 }}>
                {(selectedGoal.participants ?? []).length === 0 ? <Text style={{ color: c.mutedForeground }}>{tr('No participant commitments yet.')}</Text> : (selectedGoal.participants ?? []).map((participant) => {
                 const contributedMinor = selectedGoal.contributions
                   .filter((contribution) => contribution.contributedByUserId === participant.userId && !contribution.reversedAt)
                   .reduce((sum, contribution) => sum + contribution.amountMinor, 0);
                 const remainingMinor = Math.max(0, participant.committedMinor - contributedMinor);
                 return (
                    <View key={participant.id} style={{ paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }}>
                     <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                       <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>{participant.displayName}</Text>
                        <Text style={{ color: participant.status === 'accepted' ? c.primary : c.mutedForeground, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>{tr(participant.status)}</Text>
                     </View>
                     <Text style={{ color: c.mutedForeground, fontSize: 12, marginTop: 4 }}>
                         {formatCurrency(contributedMinor, state?.baseCurrency ?? 'USD', locale)} {tr('contributed of')} {formatCurrency(participant.committedMinor, state?.baseCurrency ?? 'USD', locale)} · {formatCurrency(remainingMinor, state?.baseCurrency ?? 'USD', locale)} {tr('remaining')}
                     </Text>
                      {isMaster && participant.userId !== session?.user.id && (participant.status === 'pending' || participant.status === 'accepted') ? (
                        <Button
                          label={tr(participantBusyId === participant.id ? 'Removing…' : 'Remove')}
                          secondary
                           onPress={() => Alert.alert(tr('Remove participant?'), tr('Future contributions will no longer mirror this shared goal. Existing shared progress remains unchanged.'), [{ text: tr('Cancel'), style: 'cancel' }, { text: tr('Remove'), style: 'destructive', onPress: () => void respond(participant, 'removed') }])}
                          disabled={participantBusyId === participant.id}
                          testID={`remove-shared-goal-participant-${participant.id}`}
                        />
                      ) : null}
                   </View>
                 );
               })}
             </Card>
             {isMaster ? (
               <Card style={{ marginBottom: 18 }}>
                  <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('Invite participant')}</Text>
                  <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>{tr('Set a shared quota. The invited member privately chooses whether to map it to one of their personal goals.')}</Text>
                 <View style={styles.wrap}>
                    {(state?.users ?? []).filter((user) => !participants.some((participant) => participant.userId === user.id && (participant.status === 'pending' || participant.status === 'accepted'))).map((user) => (
                     <Pressable key={user.id} testID={`invite-goal-member-${user.id}`} onPress={() => setInviteUserId(user.id)} style={[styles.choice, { backgroundColor: inviteUserId === user.id ? c.primary : c.secondary }]}>
                       <Feather name="user" size={15} color={inviteUserId === user.id ? c.primaryForeground : c.secondaryForeground} />
                         <Text style={{ color: inviteUserId === user.id ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{user.id === session?.user.id ? `${user.displayName} (${tr('You')})` : user.displayName}</Text>
                     </Pressable>
                   ))}
                 </View>
                  <Field label={tr('Committed amount')} value={inviteAmount} onChangeText={setInviteAmount} placeholder="0.00" keyboardType="numeric" testID="shared-goal-commitment" />
                  <Button label={tr(inviteBusy ? 'Inviting…' : 'Invite member')} icon="user-plus" onPress={() => void submitInvite()} disabled={inviteBusy || !online} testID="invite-shared-goal-participant" />
               </Card>
             ) : null}
             {pendingInvitation ? (
               <Card style={{ marginBottom: 18 }}>
                  <Text style={{ color: c.foreground, fontFamily: 'Inter_700Bold', marginBottom: 5 }}>{tr('You’re invited to this goal')}</Text>
                  <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>{tr('Your quota is')} {formatCurrency(pendingInvitation.committedMinor, state?.baseCurrency ?? 'USD', locale)}. {tr('By default, accepting creates a private personal goal with this quota and the shared goal’s due date and priority.')}</Text>
                 {acceptingParticipantId === pendingInvitation.id ? (
                   <>
                      <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('Personal goal')}</Text>
                     <View style={styles.wrap}>
                        <Pressable testID="accept-goal-create-personal" onPress={() => { setAcceptMode('create'); setAcceptPersonalGoalId(null); }} style={[styles.choice, { backgroundColor: acceptMode === 'create' ? c.primary : c.secondary }]}>
                          <Feather name="plus-circle" size={15} color={acceptMode === 'create' ? c.primaryForeground : c.secondaryForeground} />
                          <Text style={{ color: acceptMode === 'create' ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{tr('Create my personal goal')}</Text>
                       </Pressable>
                        {personalGoals.length > 0 ? (
                          <Pressable testID="accept-goal-use-existing" onPress={() => setAcceptMode('existing')} style={[styles.choice, { backgroundColor: acceptMode === 'existing' ? c.primary : c.secondary }]}>
                            <Feather name="target" size={15} color={acceptMode === 'existing' ? c.primaryForeground : c.secondaryForeground} />
                            <Text style={{ color: acceptMode === 'existing' ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{tr('Use an existing goal')}</Text>
                          </Pressable>
                        ) : null}
                        <Pressable testID="accept-goal-without-personal" onPress={() => { setAcceptMode('none'); setAcceptPersonalGoalId(null); }} style={[styles.choice, { backgroundColor: acceptMode === 'none' ? c.primary : c.secondary }]}>
                          <Feather name="minus-circle" size={15} color={acceptMode === 'none' ? c.primaryForeground : c.secondaryForeground} />
                          <Text style={{ color: acceptMode === 'none' ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{tr('Participate without personal goal')}</Text>
                        </Pressable>
                     </View>
                      {acceptMode === 'existing' ? (
                        <>
                          <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('Choose existing goal')}</Text>
                          <View style={styles.wrap}>
                            {personalGoals.map((personalGoal) => (
                              <Pressable key={personalGoal.id} testID={`accept-goal-${personalGoal.id}`} onPress={() => setAcceptPersonalGoalId(personalGoal.id)} style={[styles.choice, { backgroundColor: acceptPersonalGoalId === personalGoal.id ? c.primary : c.secondary }]}>
                                <Feather name="target" size={15} color={acceptPersonalGoalId === personalGoal.id ? c.primaryForeground : c.secondaryForeground} />
                                <Text style={{ color: acceptPersonalGoalId === personalGoal.id ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{personalGoal.name}</Text>
                              </Pressable>
                            ))}
                          </View>
                        </>
                      ) : null}
                      {acceptMode === 'create' ? <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>{tr('A progress-only personal goal will be created immediately. Its target is your quota. You can edit it later to link one of your Savings accounts.')}</Text> : null}
                      {acceptMode === 'existing' && acceptPersonalGoalId ? <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>{tr('Future contributions to this personal goal will also update the shared goal.')}</Text> : null}
                      {acceptMode === 'none' ? <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>{tr('No personal goal will be created. You can still contribute directly to the shared goal.')}</Text> : null}
                     <View style={styles.actions}>
                        <Button
                          label={tr(participantBusyId === pendingInvitation.id ? 'Accepting…' : 'Accept invitation')}
                          onPress={() => void respond(pendingInvitation, 'accepted', {
                            personalGoalId: acceptMode === 'existing' ? acceptPersonalGoalId : null,
                            createPersonalGoal: acceptMode === 'create',
                          })}
                          disabled={participantBusyId === pendingInvitation.id || (acceptMode === 'existing' && !acceptPersonalGoalId)}
                          testID="accept-shared-goal-invitation"
                        />
                        <Button label={tr('Cancel')} secondary onPress={() => { setAcceptingParticipantId(null); setAcceptMode('create'); setAcceptPersonalGoalId(null); }} />
                     </View>
                   </>
                 ) : (
                   <View style={styles.actions}>
                      <Button label={tr('Accept')} onPress={() => setAcceptingParticipantId(pendingInvitation.id)} testID="open-accept-shared-goal" />
                      <Button label={tr(participantBusyId === pendingInvitation.id ? 'Updating…' : 'Decline')} secondary onPress={() => Alert.alert(tr('Decline invitation?'), tr('You can still participate later if invited again.'), [{ text: tr('Cancel'), style: 'cancel' }, { text: tr('Decline'), style: 'destructive', onPress: () => void respond(pendingInvitation, 'declined') }])} disabled={participantBusyId === pendingInvitation.id} testID="decline-shared-goal-invitation" />
                   </View>
                 )}
               </Card>
             ) : null}
             {currentParticipation ? (
               <Card style={{ marginBottom: 18 }}>
                  <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>{tr(currentParticipation.personalGoalId ? 'You are participating in this shared goal. Contributions to your mapped personal goal continue to update shared progress.' : 'You are participating without a mapped personal goal. You can create one now using your quota and the shared goal terms.')}</Text>
                  {!currentParticipation.personalGoalId ? (
                    <View style={{ marginBottom: 8 }}>
                      <Button
                        label={tr(participantBusyId === currentParticipation.id ? 'Creating…' : 'Create my personal goal')}
                        icon="plus-circle"
                        onPress={() => void respond(currentParticipation, 'accepted', { createPersonalGoal: true })}
                        disabled={participantBusyId === currentParticipation.id}
                        testID="create-personal-goal-from-accepted-participation"
                      />
                    </View>
                  ) : null}
                 <Button label={tr(participantBusyId === currentParticipation.id ? 'Removing…' : 'Remove my participation')} secondary onPress={() => Alert.alert(tr('Remove participant?'), tr('Future contributions will no longer mirror this shared goal. Existing shared progress remains unchanged.'), [{ text: tr('Cancel'), style: 'cancel' }, { text: tr('Remove'), style: 'destructive', onPress: () => void respond(currentParticipation, 'removed') }])} disabled={participantBusyId === currentParticipation.id} testID="remove-shared-goal-participation" />
               </Card>
             ) : null}
           </>
         ) : selectedGoal.sharedParticipation ? (
           <Card style={{ marginBottom: 18 }}>
             <Text style={{ color: c.foreground, fontFamily: 'Inter_700Bold', marginBottom: 5 }}>{tr('Shared goal participation')}</Text>
             <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 3 }}>{state?.savingsGoals.find((goal) => goal.id === selectedGoal.sharedParticipation?.sharedGoalId)?.name ?? tr('Shared household goal')}</Text>
              <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 18 }}>{tr('Committed quota:')} {formatCurrency(selectedGoal.sharedParticipation.committedMinor, state?.baseCurrency ?? 'USD', locale)} · {tr('Status:')} {tr(selectedGoal.sharedParticipation.status)}.</Text>
             {selectedGoal.sharedParticipation.status === 'accepted' ? <Text style={{ color: c.primary, fontSize: 12, lineHeight: 18, marginTop: 6 }}>{tr('Future contributions to this personal goal will also update the shared goal.')}</Text> : null}
           </Card>
         ) : null}

         {canManage && selectedGoal.status === 'active' && (
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
            <View style={{ flex: 1 }}>
              <Button label={tr('Edit goal')} secondary onPress={() => setMode('edit')} />
            </View>
            <View style={{ flex: 1 }}>
               <Button label={tr('Cancel goal')} secondary onPress={() => confirmCancel(selectedGoal.id, selectedGoal.name, !selectedGoal.isShared)} />
            </View>
          </View>
        )}

         {selectedGoal.status === 'cancelled' ? (
           <Card style={{ marginBottom: 18 }}>
              <Text style={{ color: c.destructive, fontFamily: 'Inter_700Bold' }}>{tr('Cancelled goal')}</Text>
              <Text style={{ color: c.mutedForeground, marginTop: 5 }}>{tr('This goal is preserved as history and no longer counts toward active reservations.')}</Text>
           </Card>
         ) : null}

          {(selectedGoal.status === 'cancelled' ? selectedGoal.pendingSettlements : [])?.filter((item) => item.contributedByUserId === session?.user.id).map((settlement) => (
           <Card key={settlement.contributionId} style={{ marginBottom: 12 }}>
              <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>{tr('Pending settlement')}</Text>
              <Text style={{ color: c.mutedForeground, marginVertical: 6 }}>{formatCurrency(settlement.amountMinor, state?.baseCurrency ?? 'USD', locale)} {tr('can be returned to Main or left in Savings.')}</Text>
             <View style={styles.actions}>
                <Button label={tr('Return to Main')} onPress={() => void settleSavingsGoal(selectedGoal.id, { returnFunds: true }).catch((error) => Alert.alert(tr('Could not settle'), error instanceof Error ? error.message : tr('Try again.')))} />
                <Button label={tr('Leave in Savings')} secondary onPress={() => void settleSavingsGoal(selectedGoal.id, { returnFunds: false }).catch((error) => Alert.alert(tr('Could not settle'), error instanceof Error ? error.message : tr('Try again.')))} />
             </View>
           </Card>
         ))}

         <GoalContributionHistory goal={selectedGoal} />
      </View>
    );
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      bottomOffset={70}
      keyboardShouldPersistTaps="handled"
    >
      {mode === 'list' && renderList()}
      {mode === 'details' && renderDetails()}
      {(mode === 'create' || mode === 'edit') && (
        <GoalForm goal={mode === 'edit' ? selectedGoal : null} shared={shared} onCancel={() => setMode(mode === 'edit' ? 'details' : 'list')} onSaved={() => setMode('list')} />
      )}
      {mode === 'contribute' && selectedGoal && (
        <ContributeForm goal={selectedGoal} onCancel={() => setMode('details')} onSaved={() => setMode('details')} />
      )}
    </KeyboardAwareScrollViewCompat>
  );
}

function GoalForm({ goal, shared, onCancel, onSaved }: { goal: SavingsGoal | null, shared: boolean, onCancel: () => void, onSaved: () => void }) {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const { state, session, addSavingsGoal, editSavingsGoal, online } = useLedger();
  const isMaster = session?.user.role === 'master';
  const operationIdRef = useRef<string | null>(null);
  if (!goal && !operationIdRef.current) operationIdRef.current = `savings-goal-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? (goal.targetMinor / 100).toFixed(2) : '');
  const [initial, setInitial] = useState('');
  const [dueDate, setDueDate] = useState(goal ? goal.dueDate : businessDateValue(state));
  const [priority, setPriority] = useState<SavingsGoalInputPriority>(goal?.priority ?? 'medium');
  const [scope, setScope] = useState<'shared'|'personal'>(goal ? (goal.isShared ? 'shared' : 'personal') : (shared ? 'shared' : 'personal'));
  
  const accounts = useMemo(() => {
    return (state?.accounts ?? []).filter(a => {
      if (scope === 'shared') return a.kind === 'shared';
      return a.kind === 'personal' && a.ownerUserId === session?.user.id && !a.archived;
    });
  }, [state?.accounts, scope, session?.user.id]);
  const linkedSavingsAccounts = useMemo(() => {
    return (state?.accounts ?? []).filter(account =>
      account.kind === 'personal'
      && account.role === 'savings'
      && account.ownerUserId === session?.user.id
      && !account.archived
    );
  }, [session?.user.id, state?.accounts]);

  const [accountId, setAccountId] = useState(goal?.accountId ?? '');
  const [linkedAccountId, setLinkedAccountId] = useState<string | null>(goal?.linkedAccountId ?? null);

  React.useEffect(() => {
    if (accounts.length > 0 && !accounts.some(a => a.id === accountId)) {
      setAccountId(accounts[0].id);
    }
  }, [accounts, accountId]);
  React.useEffect(() => {
    if (scope === 'shared') setLinkedAccountId(null);
    else if (linkedAccountId && !linkedSavingsAccounts.some(account => account.id === linkedAccountId)) setLinkedAccountId(null);
  }, [linkedAccountId, linkedSavingsAccounts, scope]);

  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return Alert.alert(tr('Check name'), tr('Name is required.'));
    const t = Math.round(Number(target.replace(',', '.')) * 100);
    if (!t || t <= 0) return Alert.alert(tr('Check target'), tr('Target amount must be positive.'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return Alert.alert(tr('Check date'), tr('Use YYYY-MM-DD format.'));
    const d = new Date(dueDate + 'T12:00:00');
    const today = new Date(businessDateValue(state) + 'T12:00:00');
    if (isNaN(d.getTime())) return Alert.alert(tr('Check date'), tr('Invalid date.'));
    if (d.getTime() < today.getTime()) return Alert.alert(tr('Check date'), tr('Due date cannot be before the current business date.'));
    if (!accountId) return Alert.alert(tr('Check account'), tr('Funding account is required.'));

    setBusy(true);
    try {
      if (goal) {
        await editSavingsGoal(goal.id, {
          name: name.trim(),
          targetMinor: t,
          dueDate,
          priority,
          accountId,
          linkedAccountId: scope === 'personal' ? linkedAccountId : null,
          isShared: scope === 'shared'
        });
      } else {
        const i = Math.round(Number(initial.replace(',', '.')) * 100) || 0;
        await addSavingsGoal({
          name: name.trim(),
          targetMinor: t,
          initialSavedMinor: i,
          dueDate,
          priority,
          accountId,
          linkedAccountId: scope === 'personal' ? linkedAccountId : null,
          isShared: scope === 'shared',
          operationId: operationIdRef.current ?? '',
        });
      }
      onSaved();
    } catch (err) {
      Alert.alert(tr('Error'), err instanceof Error ? err.message : tr('Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 20, color: c.foreground }}>{tr(goal ? 'Edit goal' : 'New goal')}</Text>
        <Pressable onPress={onCancel} hitSlop={8}>
          <Text style={{ color: c.tint, fontFamily: 'Inter_600SemiBold' }}>{tr('Cancel')}</Text>
        </Pressable>
      </View>
      
      <Card>
        {isMaster && (
           <View style={{ marginBottom: 20 }}>
              <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('Scope')}</Text>
             <View style={styles.pills}>
                <Pressable onPress={() => setScope('shared')} style={[styles.pill, { backgroundColor: scope === 'shared' ? c.primary : c.secondary }]}>
                   <Text style={{ color: scope === 'shared' ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{tr('Shared')}</Text>
                </Pressable>
                <Pressable onPress={() => setScope('personal')} style={[styles.pill, { backgroundColor: scope === 'personal' ? c.primary : c.secondary }]}>
                   <Text style={{ color: scope === 'personal' ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{tr('Personal')}</Text>
                </Pressable>
             </View>
           </View>
        )}

        <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('Funding Account')}</Text>
        <View style={styles.wrap}>
          {accounts.map(a => (
            <Pressable key={a.id} onPress={() => setAccountId(a.id)} style={[styles.choice, { backgroundColor: accountId === a.id ? c.primary : c.secondary }]}>
               <Feather name={a.kind === 'shared' ? 'users' : 'user'} size={15} color={accountId === a.id ? c.primaryForeground : c.secondaryForeground} />
               <Text style={{ color: accountId === a.id ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{a.name}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ marginBottom: 20 }}>
           <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('Linked savings account (optional)')}</Text>
          {scope === 'personal' ? (
            <>
               <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 18, marginBottom: 9 }}>{tr('Transfers come from your Main account into this Savings account. The same Savings account can fund several goals; each transfer remains attributed to this goal. Choose No linked account for a progress-only goal.')}</Text>
              <View style={styles.wrap}>
                <Pressable testID="goal-linked-account-none" onPress={() => setLinkedAccountId(null)} style={[styles.choice, { backgroundColor: linkedAccountId === null ? c.primary : c.secondary }]}>
                  <Feather name="minus-circle" size={15} color={linkedAccountId === null ? c.primaryForeground : c.secondaryForeground} />
                  <Text style={{ color: linkedAccountId === null ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{tr('No linked account')}</Text>
                </Pressable>
                {linkedSavingsAccounts.map(account => (
                  <Pressable testID={`goal-linked-account-${account.id}`} key={account.id} onPress={() => setLinkedAccountId(account.id)} style={[styles.choice, { backgroundColor: linkedAccountId === account.id ? c.primary : c.secondary }]}>
                    <Feather name="archive" size={15} color={linkedAccountId === account.id ? c.primaryForeground : c.secondaryForeground} />
                    <Text style={{ color: linkedAccountId === account.id ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{account.name}</Text>
                  </Pressable>
                ))}
              </View>
              {linkedSavingsAccounts.length === 0 && (
                <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 18, marginTop: 9 }}>
                   {tr('No available Savings accounts. Create one from the Accounts tab, then return here to link it.')}
                </Text>
              )}
            </>
          ) : (
            <View style={{ backgroundColor: c.secondary, borderRadius: 12, padding: 12 }}>
              <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 18 }}>
                 {tr('Savings account linking is available for Personal goals only. Switch Scope to Personal to choose an account.')}
              </Text>
            </View>
          )}
        </View>

        <Field label={tr('Name')} value={name} onChangeText={setName} placeholder={tr('Vacation fund...')} />
        <Field label={tr('Target amount')} value={target} onChangeText={setTarget} placeholder="0.00" keyboardType="numeric" />
        
        {!goal && (
          <>
            <Field label={tr('Already saved (optional)')} value={initial} onChangeText={setInitial} placeholder="0.00" keyboardType="numeric" />
            {scope === 'personal' && linkedAccountId ? <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 18, marginTop: -12, marginBottom: 12 }}>{tr('With a linked Savings account, this amount transfers from Main during creation.')}</Text> : null}
          </>
        )}
        
        <Field label={tr('Due date (YYYY-MM-DD)')} value={dueDate} onChangeText={setDueDate} placeholder="2027-07-31" />
        
        <Text style={[styles.label, { color: c.mutedForeground }]}>{tr('Priority')}</Text>
        <View style={styles.pills}>
          {(['high', 'medium', 'low'] as const).map(p => (
            <Pressable key={p} onPress={() => setPriority(p)} style={[styles.pill, { backgroundColor: priority === p ? c.primary : c.secondary }]}>
              <Text style={{ color: priority === p ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{tr(p)}</Text>
            </Pressable>
          ))}
        </View>

        <Button label={tr(busy ? 'Saving...' : goal ? 'Save changes' : 'Create goal')} onPress={() => void save()} disabled={busy || !online} />
      </Card>
    </View>
  );
}

function ContributeForm({ goal, onCancel, onSaved }: { goal: SavingsGoal, onCancel: () => void, onSaved: () => void }) {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const { contributeToSavingsGoal, online, state } = useLedger();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const operationIdRef = useRef(`savings-contribution-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);

  const save = async () => {
    const a = Math.round(Number(amount.replace(',', '.')) * 100);
    if (!a || a <= 0) return Alert.alert(tr('Check amount'), tr('Enter a valid amount to contribute.'));
    setBusy(true);
    try {
      await contributeToSavingsGoal(goal.id, { amountMinor: a, note: note.trim() || undefined, operationId: operationIdRef.current });
      onSaved();
    } catch (err) {
      Alert.alert(tr('Error'), err instanceof Error ? err.message : tr('Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 20, color: c.foreground }}>{tr(goal.linkedAccountId ? 'Transfer and contribute' : 'Update saved amount')}</Text>
        <Pressable onPress={onCancel} hitSlop={8}>
          <Text style={{ color: c.tint, fontFamily: 'Inter_600SemiBold' }}>{tr('Cancel')}</Text>
        </Pressable>
      </View>
      <Card>
        {goal.linkedAccountId ? (
          <View style={{ backgroundColor: c.secondary, borderRadius: 12, padding: 12, marginBottom: 14 }}>
            <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>{tr('From Main → To')} {state?.accounts.find(account => account.id === goal.linkedAccountId)?.name ?? tr('linked Savings')}</Text>
            <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 18, marginTop: 4 }}>{tr(goal.sharedParticipation?.status === 'accepted' ? 'This transfers money from Main into Savings, updates this personal goal, and mirrors the same contribution to the shared goal.' : 'This transfers money from your Main account into the linked Savings account, then updates goal progress.')}</Text>
          </View>
        ) : (
           <Text style={{ color: c.mutedForeground, fontSize: 13, lineHeight: 18, marginBottom: 12 }}>{tr(goal.sharedParticipation?.status === 'accepted' ? 'Progress only for account balances — this contribution still updates both your personal goal and the shared goal.' : 'Progress only — no account balances change.')}</Text>
        )}
        <Field label={tr('Amount to add')} value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="numeric" />
        <Field label={tr('Note (optional)')} value={note} onChangeText={setNote} placeholder={tr('Bonus, spare change...')} />
        <Button label={tr(busy ? 'Saving...' : goal.linkedAccountId ? 'Transfer and contribute' : 'Update saved amount')} icon={goal.linkedAccountId ? 'repeat' : 'plus'} onPress={() => void save()} disabled={busy || !online} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 50, gap: 14 },
  switcher: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  switch: { borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 9 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  pills: { flexDirection: 'row', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  guideLink: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 8 },
});
