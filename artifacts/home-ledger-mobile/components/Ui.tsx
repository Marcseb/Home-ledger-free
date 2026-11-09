import { Feather } from '@expo/vector-icons';
import React, { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { translateLiteral, useI18n } from '@/lib/i18n';

export function Button({ label, onPress, icon, disabled = false, secondary = false, testID, accessibilityLabel }: { label: string; onPress: () => void; icon?: keyof typeof Feather.glyphMap; disabled?: boolean; secondary?: boolean; testID?: string; accessibilityLabel?: string }) {
  const c = useColors();
  const { locale } = useI18n();
  const translated = translateLiteral(label, locale);
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? translated} testID={testID} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, { backgroundColor: secondary ? c.secondary : c.primary, opacity: disabled ? 0.45 : pressed ? 0.78 : 1 }]}><>{icon && <Feather name={icon} size={17} color={secondary ? c.secondaryForeground : c.primaryForeground} />}</><Text style={[styles.buttonText, { color: secondary ? c.secondaryForeground : c.primaryForeground }]}>{translated}</Text></Pressable>;
}
export function Field({ label, value, onChangeText, placeholder, keyboardType = 'default', secureTextEntry = false, testID }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; keyboardType?: 'default' | 'numeric' | 'url'; secureTextEntry?: boolean; testID?: string }) {
  const c = useColors();
  const { locale } = useI18n();
  return <View style={styles.field}><Text style={[styles.label, { color: c.mutedForeground }]}>{translateLiteral(label, locale)}</Text><TextInput testID={testID} value={value} onChangeText={onChangeText} placeholder={placeholder ? translateLiteral(placeholder, locale) : undefined} placeholderTextColor={c.mutedForeground} keyboardType={keyboardType} secureTextEntry={secureTextEntry} style={[styles.input, { color: c.foreground, borderColor: c.input, backgroundColor: c.card }]} /></View>;
}
export function Card({ children, style }: { children: ReactNode; style?: object }) { const c = useColors(); return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}>{children}</View>; }
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) { const c = useColors(); return <View style={styles.sectionTitle}><Text style={[styles.sectionText, { color: c.foreground }]}>{children}</Text>{action}</View>; }
export function Spinner() { const c = useColors(); return <ActivityIndicator color={c.primary} style={{ margin: 24 }} />; }
export const styles = StyleSheet.create({ button: { minHeight: 50, borderRadius: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 }, buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 }, field: { gap: 7, marginBottom: 15 }, label: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' }, input: { minHeight: 50, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontFamily: 'Inter_400Regular', fontSize: 16 }, card: { borderWidth: 1, borderRadius: 18, padding: 16 }, sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }, sectionText: { fontFamily: 'Inter_700Bold', fontSize: 18 } });