import assert from 'node:assert/strict';
import test from 'node:test';
import { filterHelpTopics, getHelpTopics, getHelpUi } from './help-content.ts';

const ids = ['getting-started', 'home', 'activity', 'budgets', 'goals', 'recurring', 'backups', 'household', 'offline', 'app-lock', 'accounts'];

test('all languages provide the same complete offline topic set and UI copy', () => {
  for (const locale of ['en', 'fr', 'it']) {
    const topics = getHelpTopics(locale);
    assert.deepEqual(topics.map((topic) => topic.id), ids);
    assert.equal(new Set(topics.map((topic) => topic.id)).size, topics.length);
    for (const topic of topics) {
      assert.ok(topic.title && topic.summary && topic.sections.length >= 2);
      assert.ok(topic.sections.every((section) => section.title && section.body));
    }
    assert.ok(Object.values(getHelpUi(locale)).every((value) => typeof value === 'string' && value.length > 0));
  }
});

test('blank search returns all topics and unmatched search returns an empty result', () => {
  const topics = getHelpTopics('en');
  assert.equal(filterHelpTopics(topics, '  '), topics);
  assert.deepEqual(filterHelpTopics(topics, 'not-a-help-topic-xyz'), []);
});

test('search ignores case and accents and searches inside article sections', () => {
  assert.ok(filterHelpTopics(getHelpTopics('fr'), 'EPARGNE').some((topic) => topic.id === 'goals'));
  assert.ok(filterHelpTopics(getHelpTopics('it'), 'crittografate').some((topic) => topic.id === 'backups'));
  assert.ok(filterHelpTopics(getHelpTopics('en'), 'fresh database').some((topic) => topic.id === 'backups'));
  assert.ok(filterHelpTopics(getHelpTopics('en'), 'threshold alerts').some((topic) => topic.id === 'budgets'));
});

test('multi-word search requires every word in each result', () => {
  const topics = getHelpTopics('en');
  assert.equal(filterHelpTopics(topics, 'recovery phrase').some((topic) => topic.id === 'backups'), true);
  assert.deepEqual(filterHelpTopics(topics, 'recovery no-such-word-xyz'), []);
});

test('app-lock help covers local limits and recovery in every language', () => {
  for (const locale of ['en', 'fr', 'it']) {
    const topic = getHelpTopics(locale).find(({ id }) => id === 'app-lock');
    assert.ok(topic);
    assert.ok(topic.sections.some(({ body }) => /30|trenta|trente/i.test(body)));
    assert.ok(topic.sections.some(({ body }) => /backup|sauvegarde|backup/i.test(body)));
  }
});

test('detailed guide links are restricted to existing read-only guides', () => {
  for (const locale of ['en', 'fr', 'it']) {
    const linked = getHelpTopics(locale).filter((topic) => topic.guideRoute);
    assert.deepEqual(linked.map((topic) => [topic.id, topic.guideRoute]), [
      ['goals', '/shared-goal-guide'],
      ['backups', '/backup-recovery-guide'],
    ]);
    assert.ok(linked.every((topic) => topic.guideLabel));
  }
});