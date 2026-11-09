import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/lib/i18n';
import { getHelpUi } from '@/lib/help-content';

export function HelpButton() {
  const router = useRouter();
  const c = useColors();
  const { locale } = useI18n();
  return <Pressable
    testID="open-app-help"
    accessibilityRole="button"
    accessibilityLabel={getHelpUi(locale).helpTitle}
    onPress={() => router.push('/help')}
    style={styles.headerButton}
  >
    <Feather name="help-circle" size={23} color={c.primary} />
  </Pressable>;
}

export function ContextHelp({ topic }: { topic: 'goals' | 'backups' | 'budgets' | 'recurring' }) {
  const router = useRouter();
  const c = useColors();
  const { locale } = useI18n();
  const ui = getHelpUi(locale);
  const hints = { goals: ui.goalsHint, backups: ui.backupHint, budgets: ui.budgetsHint, recurring: ui.recurringHint };
  return <View style={[styles.context, { backgroundColor: c.secondary, borderColor: c.border }]}>
    <Feather name="info" size={17} color={c.primary} style={{ marginTop: 2 }} />
    <View style={{ flex: 1 }}>
      <Text style={[styles.hint, { color: c.secondaryForeground }]}>{hints[topic]}</Text>
      <Pressable
        testID={`context-help-${topic}`}
        accessibilityRole="button"
        accessibilityLabel={`${ui.helpTitle} · ${ui.readMore}`}
        onPress={() => router.push({ pathname: '/help', params: { topic } })}
        style={styles.readMore}
      >
        <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>{ui.readMore}</Text>
        <Feather name="chevron-right" size={14} color={c.primary} />
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  context: { padding: 12, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginBottom: 10 },
  hint: { fontSize: 12, lineHeight: 18 },
  readMore: { alignSelf: 'flex-start', minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 4 },
});