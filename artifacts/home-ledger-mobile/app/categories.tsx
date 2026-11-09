import { Feather } from '@expo/vector-icons';
import type { Category } from '@workspace/api-client-react';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Button, Card, Field, SectionTitle } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useLedger } from '@/lib/ledger-context';
import { translateLiteral, useI18n } from '@/lib/i18n';

const palette = ['#E67E5F', '#D96D5F', '#C98A3D', '#45A675', '#4A8A70', '#6C8AE4', '#4F76B8', '#8C78B8'];

export default function Categories() {
  const c = useColors();
  const { t, locale } = useI18n();
  const { state, session, online, addCategory, editCategory } = useLedger();
  const isMaster = session?.user.role === 'master';
  const [scope, setScope] = useState<'shared' | 'personal'>(isMaster ? 'shared' : 'personal');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(palette[0]);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const categories = useMemo(
    () => (state?.categories ?? []).filter((item) => item.scope === scope && (showArchived || !item.archived)),
    [scope, showArchived, state?.categories],
  );
  const editing = state?.categories.find((item) => item.id === editingId);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setColor(palette[0]);
  };
  const changeScope = (next: 'shared' | 'personal') => {
    setScope(next);
    resetForm();
  };
  const beginEdit = (category: Category) => {
    if (category.system) return;
    setEditingId(category.id);
    setName(category.name);
    setColor(category.color);
  };
  const save = async () => {
    if (!name.trim()) {
      Alert.alert(t('checkDetails'), translateLiteral('Enter a category name.', locale));
      return;
    }
    setBusy(true);
    try {
      if (editingId) await editCategory(editingId, { name: name.trim(), color });
      else await addCategory({ name: name.trim(), color, scope });
      resetForm();
    } catch (error) {
      Alert.alert(t('error'), error instanceof Error ? error.message : t('tryAgain'));
    } finally {
      setBusy(false);
    }
  };
  const setArchived = (category: Category, archived: boolean) => {
    const apply = () => {
      setBusy(true);
      void editCategory(category.id, { archived })
        .then(() => {
          if (editingId === category.id) resetForm();
        })
        .catch((error) => Alert.alert(t('error'), error instanceof Error ? error.message : t('tryAgain')))
        .finally(() => setBusy(false));
    };
    if (!archived) {
      apply();
      return;
    }
    Alert.alert(`${translateLiteral('Archive', locale)} ${category.name}?`, translateLiteral('It will disappear from new expenses but remain on existing transactions.', locale), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: apply },
    ]);
  };

  return (
    <KeyboardAwareScrollViewCompat style={{ backgroundColor: c.background }} contentContainerStyle={styles.content} bottomOffset={40} keyboardShouldPersistTaps="handled">
      <Text style={[styles.heading, { color: c.foreground }]}>{t('categories')}</Text>
      <Text style={[styles.intro, { color: c.mutedForeground }]}>{translateLiteral('Shared categories are available to the household. Personal categories stay with your personal account.', locale)}</Text>
      <View style={styles.scopeRow}>
        {isMaster ? <ScopeButton label={t('household')} active={scope === 'shared'} onPress={() => changeScope('shared')} /> : null}
        <ScopeButton label={translateLiteral('Personal', locale)} active={scope === 'personal'} onPress={() => changeScope('personal')} />
      </View>
      {(scope === 'personal' || isMaster) ? (
        <Card>
          <Text style={[styles.formTitle, { color: c.foreground }]}>{editing ? `${translateLiteral('Edit', locale)} ${editing.name}` : `${translateLiteral('Add', locale)} ${scope === 'shared' ? translateLiteral('Shared', locale) : translateLiteral('Personal', locale)} ${translateLiteral('category', locale)}`}</Text>
          <Field label={translateLiteral('Category name', locale)} value={name} onChangeText={(value) => setName(value.slice(0, 40))} placeholder={translateLiteral('Utilities, transport, leisure…', locale)} testID="category-name" />
          <Text style={[styles.label, { color: c.mutedForeground }]}>{translateLiteral('Color', locale)}</Text>
          <View style={styles.palette}>
            {palette.map((item) => <Pressable key={item} testID={`category-color-${item}`} accessibilityLabel={`${translateLiteral('Use color', locale)} ${item}`} onPress={() => setColor(item)} style={[styles.swatch, { backgroundColor: item, borderColor: color === item ? c.foreground : 'transparent' }]}>{color === item ? <Feather name="check" size={16} color="#FFFFFF" /> : null}</Pressable>)}
          </View>
          <View style={styles.formActions}>
            {editing ? <Button label={t('cancel')} icon="x" onPress={resetForm} secondary /> : null}
            <Button label={busy ? translateLiteral('Saving…', locale) : editing ? translateLiteral('Save changes', locale) : translateLiteral('Add category', locale)} icon={editing ? 'check' : 'plus'} onPress={() => void save()} disabled={busy || !online} testID="save-category" />
          </View>
        </Card>
      ) : null}
      <SectionTitle action={<Pressable onPress={() => setShowArchived((current) => !current)}><Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>{translateLiteral(showArchived ? 'Hide archived' : 'Show archived', locale)}</Text></Pressable>}>
        {translateLiteral(scope === 'shared' ? 'Shared categories' : 'Personal categories', locale)}
      </SectionTitle>
      <Card>
        {categories.length ? categories.map((category) => {
          const canManage = !category.system && (category.scope === 'personal' || isMaster);
          return (
            <View key={category.id} style={[styles.categoryRow, { borderBottomColor: c.border, opacity: category.archived ? 0.6 : 1 }]}>
              <View style={[styles.colorDot, { backgroundColor: category.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.categoryName, { color: c.foreground }]}>{category.name}</Text>
                <Text style={{ color: c.mutedForeground, fontSize: 11 }}>{translateLiteral(category.system ? 'System category' : category.archived ? 'Archived' : category.scope === 'shared' ? 'Shared household' : 'Personal', locale)}</Text>
              </View>
              {canManage ? <View style={styles.rowActions}>
                {!category.archived ? <Pressable testID={`edit-category-${category.id}`} hitSlop={8} disabled={busy} onPress={() => beginEdit(category)}><Feather name="edit-2" size={17} color={c.primary} /></Pressable> : null}
                <Pressable testID={`archive-category-${category.id}`} hitSlop={8} disabled={busy} onPress={() => setArchived(category, !category.archived)}><Feather name={category.archived ? 'rotate-ccw' : 'archive'} size={17} color={category.archived ? c.primary : c.tint} /></Pressable>
              </View> : null}
            </View>
          );
        }) : <Text style={{ color: c.mutedForeground }}>{translateLiteral(showArchived ? 'No categories in this section.' : 'Add the first category for this account.', locale)}</Text>}
      </Card>
    </KeyboardAwareScrollViewCompat>
  );
}

function ScopeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useColors();
  return <Pressable onPress={onPress} style={[styles.scopeButton, { backgroundColor: active ? c.primary : c.secondary }]}><Text style={{ color: active ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 70, gap: 14 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 28 },
  intro: { lineHeight: 21 },
  scopeRow: { flexDirection: 'row', gap: 8 },
  scopeButton: { borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10 },
  formTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginBottom: 14 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  formActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  colorDot: { width: 13, height: 13, borderRadius: 7 },
  categoryName: { fontFamily: 'Inter_600SemiBold', marginBottom: 3 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 4 },
});