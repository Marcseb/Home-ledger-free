import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/lib/i18n';
import { filterHelpTopics, getHelpTopics, getHelpUi } from '@/lib/help-content';

export default function HelpScreen() {
  const c = useColors();
  const { locale } = useI18n();
  const params = useLocalSearchParams<{ topic?: string | string[] }>();
  const paramTopic = Array.isArray(params.topic) ? params.topic[0] : params.topic;
  const topics = useMemo(() => getHelpTopics(locale), [locale]);
  const ui = getHelpUi(locale);
  const [query, setQuery] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const results = useMemo(() => filterHelpTopics(topics, query), [topics, query]);
  const open = topics.find((t) => t.id === paramTopic) ?? null;

  const showTopic = (topic?: string) => {
    Keyboard.dismiss();
    router.setParams({ topic: topic ?? '' });
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
  };

  return (
    <ScrollView ref={scrollRef} style={{ backgroundColor: c.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.notice, { backgroundColor: c.secondary }]}>
        <Feather name="wifi-off" size={16} color={c.primary} />
        <Text style={[styles.noticeText, { color: c.secondaryForeground }]}>{ui.offlineNotice}</Text>
      </View>

      {open ? (
        <View testID="help-topic-detail" style={{ gap: 14 }}>
          <Pressable testID="help-all-topics" accessibilityRole="button" onPress={() => showTopic()} style={styles.back} hitSlop={8}>
            <Feather name="arrow-left" size={18} color={c.primary} />
            <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold' }}>{ui.allTopics}</Text>
          </Pressable>
          <Text style={[styles.heading, { color: c.foreground }]}>{open.title}</Text>
          <Text style={[styles.summary, { color: c.mutedForeground }]}>{open.summary}</Text>
          {open.sections.map((s) => (
            <Card key={s.title}>
              <Text style={[styles.sectionTitle, { color: c.foreground }]}>{s.title}</Text>
              <Text style={[styles.body, { color: c.mutedForeground }]}>{s.body}</Text>
            </Card>
          ))}
          {open.guideRoute ? (
            <Pressable
              testID={`help-guide-link-${open.id}`}
              accessibilityRole="link"
              onPress={() => router.push(open.guideRoute!)}
              style={[styles.guide, { backgroundColor: c.secondary, borderColor: c.border }]}
            >
              <Feather name="book-open" size={16} color={c.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>{open.guideLabel}</Text>
                <Text style={{ color: c.mutedForeground, fontSize: 12, marginTop: 2 }}>{ui.guideNote}</Text>
              </View>
              <Feather name="chevron-right" size={17} color={c.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={[styles.heading, { color: c.foreground }]}>{ui.helpTitle}</Text>
          <View style={[styles.searchBox, { backgroundColor: c.card, borderColor: c.input }]}>
            <Feather name="search" size={17} color={c.mutedForeground} />
            <TextInput
              testID="help-search"
              value={query}
              onChangeText={setQuery}
              placeholder={ui.searchPlaceholder}
              accessibilityLabel={ui.searchPlaceholder}
              placeholderTextColor={c.mutedForeground}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              style={[styles.searchInput, { color: c.foreground }]}
            />
            {query ? (
              <Pressable testID="help-clear-search" accessibilityRole="button" accessibilityLabel={ui.clearSearch} onPress={() => setQuery('')} hitSlop={10}>
                <Feather name="x" size={18} color={c.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          {results.length === 0 ? (
            <Card style={{ alignItems: 'center', gap: 8 }}>
              <Feather name="search" size={24} color={c.mutedForeground} />
              <Text testID="help-no-results" style={{ color: c.foreground, fontFamily: 'Inter_700Bold', textAlign: 'center' }}>{ui.noResults}</Text>
              <Text style={{ color: c.mutedForeground, textAlign: 'center', lineHeight: 20 }}>{ui.noResultsHint}</Text>
              <Pressable testID="help-reset-search" accessibilityRole="button" onPress={() => setQuery('')} style={[styles.reset, { backgroundColor: c.primary }]}>
                <Text style={{ color: c.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>{ui.clearSearch}</Text>
              </Pressable>
            </Card>
          ) : (
            results.map((t) => (
              <Pressable key={t.id} testID={`help-topic-${t.id}`} accessibilityRole="button" onPress={() => showTopic(t.id)}>
                <Card>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sectionTitle, { color: c.foreground }]}>{t.title}</Text>
                      <Text style={[styles.body, { color: c.mutedForeground, marginTop: 4 }]}>{t.summary}</Text>
                    </View>
                    <Feather name="chevron-right" size={18} color={c.mutedForeground} />
                  </View>
                </Card>
              </Pressable>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 60, gap: 14 },
  notice: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, borderRadius: 13 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 27, lineHeight: 34 },
  summary: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  searchBox: { minHeight: 50, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 16, minHeight: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, lineHeight: 22 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 6 },
  back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  guide: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  reset: { marginTop: 6, minHeight: 44, borderRadius: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
});
