import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { type QuarantinedOutboxItem } from '@/lib/ledger-context';
import { translateLiteral, useI18n } from '@/lib/i18n';

export function PendingChangesReview({ items, onDismiss, hideReviewed = false }: { items: QuarantinedOutboxItem[]; onDismiss: () => void; hideReviewed?: boolean }) {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const [expanded, setExpanded] = useState(false);
  const needsReview = items.some((entry) => !entry.reviewedAt);
  if (!items.length || (hideReviewed && !needsReview)) return null;
  return <Card>
    <Text style={[styles.title, { color: needsReview ? c.destructive : c.foreground }]}>{tr(needsReview ? 'Pending changes need review' : 'Saved changes')}</Text>
    <Text style={[styles.description, { color: c.mutedForeground }]}>{tr('Check Activity before re-entering these changes to avoid duplicates. Acknowledging keeps this list in Settings; it does not post or delete entries.')}</Text>
    {needsReview || expanded ? <View style={styles.list}>
      {items.map(({ operation, quarantinedAt }) => <View key={operation.operationId} testID={`quarantined-change-${operation.operationId}`} style={[styles.item, { borderTopColor: c.border }]}>
        <Text style={[styles.operation, { color: c.foreground }]}>{operation.type}</Text>
        <Text style={[styles.detail, { color: c.foreground }]}>{'transaction' in operation.payload
          ? `${operation.payload.transaction.note} · ${new Intl.NumberFormat(locale, { style: 'currency', currency: operation.payload.transaction.currency }).format(operation.payload.transaction.amountMinor / 100)}`
          : `${tr('Reversal of transaction ')}${operation.payload.transactionId}`}</Text>
        <Text style={[styles.date, { color: c.mutedForeground }]}>{new Date(quarantinedAt).toLocaleString(locale)}</Text>
        {'transaction' in operation.payload ? <Text style={[styles.date, { color: c.mutedForeground }]}>{tr('Transaction date')}: {new Date(operation.payload.transaction.occurredAt).toLocaleDateString(locale)}</Text> : null}
      </View>)}
    </View> : null}
    {needsReview
      ? <Button label={tr('I reviewed these saved changes')} icon="check" secondary onPress={onDismiss} testID="dismiss-quarantined-changes" />
      : <Button label={tr(expanded ? 'Hide saved changes' : 'Show saved changes')} icon={expanded ? 'chevron-up' : 'chevron-down'} secondary onPress={() => setExpanded(!expanded)} testID="toggle-saved-changes" />}
  </Card>;
}

const styles = StyleSheet.create({
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  description: { lineHeight: 20, marginTop: 6, marginBottom: 8 },
  list: { marginBottom: 14 },
  item: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 9 },
  operation: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  detail: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  date: { fontSize: 12, marginTop: 3 },
});