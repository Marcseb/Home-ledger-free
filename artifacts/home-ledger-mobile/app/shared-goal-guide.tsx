import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Button, Card } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { formatCurrency, translateLiteral, useI18n } from '@/lib/i18n';

type Actor = 'master' | 'member';

type GuideStep = {
  number: string;
  title: string;
  actor: Actor;
  summary: string;
  actions: string[];
  result: string;
  note?: string;
};

const steps: GuideStep[] = [
  {
    number: '01',
    title: 'Create the shared goal',
    actor: 'master',
    summary: 'Alex, the Master, starts a shared goal for the household.',
    actions: [
      'Open Savings goals and select Shared household.',
      'Tap + Add goal. Keep Scope set to Shared.',
      'Enter a name such as Summer trip, a target of {{target}}, a due date, and a priority.',
      'Choose the Household funding account and tap Create goal.',
    ],
    result: 'The goal is visible to the household. No member quota exists until Alex sends an invitation.',
    note: 'Shared goals use the household account. A shared goal cannot be linked to a personal Savings account.',
  },
  {
    number: '02',
    title: 'Set a member commitment',
    actor: 'master',
    summary: 'Alex defines how much Sam is invited to commit, without selecting Sam’s private goal.',
    actions: [
      'Open the new shared goal and scroll to Participants.',
      'Choose Sam under Invite participant.',
      'Enter the commitment, for example {{quota}}, then tap Invite member.',
    ],
    result: 'Sam appears as pending with {{quota}} committed and {{quota}} remaining.',
    note: 'The Master can set a quota, but cannot see or choose Sam’s personal-goal identity.',
  },
  {
    number: '03',
    title: 'Review the invitation',
    actor: 'member',
    summary: 'Sam opens the shared goal on Sam’s paired device and decides how to participate.',
    actions: [
      'Open Savings goals and select Shared household.',
      'Open Summer trip and find You’re invited to this goal.',
      'Tap Accept. Create my personal goal is selected by default.',
      'Tap Accept invitation. Home Ledger creates Sam’s private Summer trip goal with a {{quota}} target, matching due date, and matching priority.',
    ],
    result: 'The invitation becomes accepted and the new goal appears under Sam’s Personal goals. The mapping stays private from Alex.',
    note: 'Sam may instead map an existing personal goal or explicitly participate without one.',
  },
  {
    number: '04',
    title: 'Make a member contribution',
    actor: 'member',
    summary: 'Sam contributes through the personal goal that was created during acceptance.',
    actions: [
      'Open the mapped personal goal from the Personal goals view.',
      'Tap Transfer and contribute if it has a linked Savings account.',
      'Enter an amount such as {{contribution}} and an optional note, then save.',
      'For an unlinked personal goal, tap Update saved amount instead.',
    ],
    result: 'The personal goal increases by {{contribution}}. While participation is accepted, the shared goal also increases by {{contribution}} and Sam’s remaining quota falls to {{remaining}}.',
    note: 'A linked contribution creates one audited Main → Savings transfer attributed to that goal. An unlinked contribution changes progress only, but still mirrors to the shared goal.',
  },
  {
    number: '05',
    title: 'Monitor progress and contribute directly',
    actor: 'master',
    summary: 'Alex can see quota progress without seeing Sam’s private personal-goal name.',
    actions: [
      'Open the shared goal and review each participant’s contributed and remaining amounts.',
      'Use the shared goal’s contribution button for a direct household contribution when appropriate.',
      'Review Contributions history for transfer-backed, progress-only, or reversed entries.',
    ],
    result: 'Direct shared contributions and mirrored member contributions are combined in the shared total. Each participant’s quota counts only contributions made by that participant.',
    note: 'The same Savings account may be reused by several personal goals. The Accounts screen separates allocated and unallocated money.',
  },
  {
    number: '06',
    title: 'Correct, reverse, or stop participation',
    actor: 'member',
    summary: 'The ledger keeps history intact when something changes.',
    actions: [
      'Use Activity to correct a wrong amount or cancel a transfer-backed contribution.',
      'To remove progress without undoing a transfer, cancel your own contribution in Contributions history.',
      'A reversal or cancellation updates the affected personal and mirrored shared totals once.',
      'To stop future mirroring, open the shared goal and choose Remove my participation.',
      'The Master can remove another pending or accepted participant from the Participants section.',
    ],
    result: 'Past shared progress remains visible after removal, but later personal contributions no longer mirror into that shared goal.',
    note: 'Corrections and reversals preserve the audit trail; they do not rewrite or silently delete the original entry.',
  },
];

function ActorPill({ actor, active, onPress }: { actor: Actor; active: boolean; onPress: () => void }) {
  const c = useColors();
  const { locale } = useI18n();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.actorPill, { backgroundColor: active ? c.primary : c.secondary }]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Feather name={actor === 'master' ? 'shield' : 'user'} size={15} color={active ? c.primaryForeground : c.secondaryForeground} />
      <Text style={{ color: active ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>
        {translateLiteral(actor === 'master' ? 'Master view' : 'Member view', locale)}
      </Text>
    </Pressable>
  );
}

export default function SharedGoalGuide() {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];
  const progress = useMemo(() => `${stepIndex + 1} ${tr('of')} ${steps.length}`, [locale, stepIndex]);
  const actor = step.actor;
  const guideText = (value: string) => translateLiteral(value, locale)
    .replace('{{target}}', formatCurrency(120000, 'EUR', locale))
    .replace('{{quota}}', formatCurrency(30000, 'EUR', locale))
    .replace('{{contribution}}', formatCurrency(10000, 'EUR', locale))
    .replace('{{remaining}}', formatCurrency(20000, 'EUR', locale));

  const goToStep = (next: number) => {
    const bounded = Math.max(0, Math.min(steps.length - 1, next));
    setStepIndex(bounded);
  };

  const jumpToActor = (nextActor: Actor) => {
    const nextIndex = steps.findIndex((item, index) => item.actor === nextActor && index >= stepIndex);
    const firstIndex = steps.findIndex((item) => item.actor === nextActor);
    setStepIndex(nextIndex >= 0 ? nextIndex : firstIndex);
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      bottomOffset={70}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: c.secondary }]}>
          <Feather name="users" size={22} color={c.primary} />
        </View>
        <Text style={[styles.heading, { color: c.foreground }]}>{tr('A shared goal, step by step')}</Text>
        <Text style={[styles.intro, { color: c.mutedForeground }]}>
          {tr('Follow Alex (Master) and Sam (Member) as they create a Summer trip goal, accept a quota, contribute, and manage changes. This is a guide using example values; it does not change your ledger.')}
        </Text>
      </View>

      <View style={styles.actorRow}>
        <ActorPill actor="master" active={actor === 'master'} onPress={() => jumpToActor('master')} />
        <ActorPill actor="member" active={actor === 'member'} onPress={() => jumpToActor('member')} />
      </View>

      <View style={[styles.progressTrack, { backgroundColor: c.muted }]}>
        <View style={[styles.progressFill, { backgroundColor: c.primary, width: `${((stepIndex + 1) / steps.length) * 100}%` }]} />
      </View>
      <Text style={[styles.progressLabel, { color: c.mutedForeground }]}>{tr('Step ')}{progress}</Text>

      <Card style={{ borderColor: c.primary, borderWidth: 1.5 }}>
        <View style={styles.stepHeader}>
          <Text style={[styles.stepNumber, { color: c.primary }]}>{step.number}</Text>
          <View style={{ flex: 1 }}>
             <Text style={[styles.stepTitle, { color: c.foreground }]}>{guideText(step.title)}</Text>
            <Text style={{ color: c.mutedForeground, fontSize: 12, marginTop: 3 }}>
               {tr(step.actor === 'master' ? 'Alex · Master' : 'Sam · Member')}
            </Text>
          </View>
        </View>
        <Text style={[styles.summary, { color: c.foreground }]}>{guideText(step.summary)}</Text>

        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>{locale === 'fr' ? 'À faire' : locale === 'it' ? 'Cosa fare' : 'What to do'}</Text>
        {step.actions.map((action, index) => (
          <View key={action} style={styles.actionRow}>
            <View style={[styles.actionIndex, { backgroundColor: c.secondary }]}>
              <Text style={{ color: c.primary, fontFamily: 'Inter_700Bold', fontSize: 12 }}>{index + 1}</Text>
            </View>
            <Text style={[styles.actionText, { color: c.foreground }]}>{guideText(action)}</Text>
          </View>
        ))}

        <View style={[styles.resultBox, { backgroundColor: c.secondary }]}>
           <Text style={[styles.sectionLabel, { color: c.primary, marginBottom: 5 }]}>{locale === 'fr' ? 'Ce qui se passe' : locale === 'it' ? 'Cosa succede' : 'What happens'}</Text>
          <Text style={{ color: c.foreground, lineHeight: 20 }}>{guideText(step.result)}</Text>
        </View>
        {step.note ? <Text style={[styles.note, { color: c.mutedForeground }]}>{guideText(step.note)}</Text> : null}
      </Card>

      <View style={styles.navigation}>
        <Button label={tr('Previous')} icon="arrow-left" secondary onPress={() => goToStep(stepIndex - 1)} disabled={stepIndex === 0} />
        <Button label={tr(stepIndex === steps.length - 1 ? 'Start again' : 'Next step')} icon={stepIndex === steps.length - 1 ? 'rotate-ccw' : 'arrow-right'} onPress={() => goToStep(stepIndex === steps.length - 1 ? 0 : stepIndex + 1)} />
      </View>

      <Card style={{ backgroundColor: c.secondary, borderColor: c.secondary }}>
        <Text style={[styles.stepTitle, { color: c.foreground, fontSize: 16 }]}>{tr('Ready to use your real goal?')}</Text>
        <Text style={{ color: c.mutedForeground, lineHeight: 19, marginTop: 5, marginBottom: 12 }}>
          {tr('Close this guide, open Shared household, and follow the same sequence with your household’s goal and amounts.')}
        </Text>
        <Button label={tr('Open Savings goals')} icon="target" onPress={() => router.replace('/goals')} />
      </Card>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 70, gap: 14 },
  hero: { gap: 10 },
  heroIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 28, lineHeight: 34 },
  intro: { lineHeight: 21, fontSize: 14 },
  actorRow: { flexDirection: 'row', gap: 8 },
  actorPill: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 7 },
  progressTrack: { height: 7, borderRadius: 4, overflow: 'hidden', marginTop: 2 },
  progressFill: { height: '100%', borderRadius: 4 },
  progressLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: -5 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  stepNumber: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  stepTitle: { fontFamily: 'Inter_700Bold', fontSize: 19 },
  summary: { lineHeight: 21, marginBottom: 17 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  actionRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 11 },
  actionIndex: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionText: { flex: 1, lineHeight: 19, paddingTop: 2 },
  resultBox: { borderRadius: 13, padding: 12, marginTop: 7 },
  note: { lineHeight: 18, fontSize: 12, marginTop: 12 },
  navigation: { flexDirection: 'row', gap: 8 },
});