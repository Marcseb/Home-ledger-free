import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React from 'react';
import { Alert, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import type { HouseholdInvitation } from '@workspace/api-client-react';
import { createHouseholdInvitation, listHouseholdInvitations, revokeHouseholdInvitation } from '@workspace/api-client-react';
import { Button, Card, Field, SectionTitle } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useLedger } from '@/lib/ledger-context';
import { useI18n } from '@/lib/i18n';
import { invErrText, localizeInvitationError, useInvT } from '@/lib/invitation-i18n';

type Invite = HouseholdInvitation;
type Issued = { code: string; id: string; displayName: string; role: Invite['role']; expiresAt: string };

const group4 = (code: string) => code.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();

function confirmAction(title: string, body: string, confirmLabel: string, cancelLabel: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${body}`)) onConfirm();
    return;
  }
  Alert.alert(title, body, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

const canShare = Platform.OS !== 'web' || (typeof navigator !== 'undefined' && typeof (navigator as { share?: unknown }).share === 'function');
const POLL_MS = 15000;

export function HouseholdInvitations() {
  const c = useColors();
  const it = useInvT();
  const { locale } = useI18n();
  const { session, state, online } = useLedger();
  const token = session?.token;
  const isMaster = session?.user.role === 'master';
  const epoch = React.useRef(0);
  const listSeq = React.useRef(0);
  const tokenRef = React.useRef<string | undefined>(token);
  const [target, setTarget] = React.useState<string>('new');
  const [name, setName] = React.useState('');
  const [issued, setIssued] = React.useState<Issued | null>(null);
  const [invites, setInvites] = React.useState<Invite[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [listError, setListError] = React.useState('');
  const [formError, setFormError] = React.useState('');
  const [shareError, setShareError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [revoking, setRevoking] = React.useState<string | null>(null);
  tokenRef.current = token;
  const fail = (e: unknown, fallback: string) => (e instanceof Error && e.message ? localizeInvitationError(e.message, locale) : fallback);
  const live = (mine: number, tk: string) => epoch.current === mine && tokenRef.current === tk;

  const load = React.useCallback(async () => {
    if (!token || !isMaster) return;
    const mine = epoch.current; const tk = token; const seq = ++listSeq.current;
    setLoading(true); setListError('');
    try {
      const res = await listHouseholdInvitations({ headers: { 'x-device-token': tk } });
      if (live(mine, tk) && seq === listSeq.current) {
        setInvites(res.invitations); setLoaded(true);
        setIssued((cur) => (cur && res.invitations.some((i) => i.id === cur.id && i.status !== 'pending') ? null : cur));
      }
    } catch (e) {
      if (live(mine, tk) && seq === listSeq.current) setListError(fail(e, it('loadErr')));
    } finally {
      if (live(mine, tk) && seq === listSeq.current) setLoading(false);
    }
  }, [token, isMaster, locale]);
  const loadRef = React.useRef(load);
  loadRef.current = load;

  const reset = () => {
    epoch.current += 1; listSeq.current += 1;
    setIssued(null); setInvites([]); setLoaded(false); setListError(''); setFormError(''); setShareError('');
    setBusy(false); setRevoking(null); setLoading(false); setTarget('new'); setName('');
  };
  React.useEffect(() => { reset(); return () => { epoch.current += 1; listSeq.current += 1; }; }, [token, isMaster]);

  // Load on focus, poll briefly while focused (Master only); hide the code on blur.
  useFocusEffect(React.useCallback(() => {
    if (!token || !isMaster) return undefined;
    void loadRef.current();
    const timer = setInterval(() => void loadRef.current(), POLL_MS);
    return () => { clearInterval(timer); epoch.current += 1; listSeq.current += 1; setIssued(null); setShareError(''); setBusy(false); setRevoking(null); setLoading(false); };
  }, [token, isMaster]));

  const doCreate = async (mine: number, tk: string) => {
    if (!live(mine, tk)) return;
    setBusy(true); setFormError(''); setShareError(''); setIssued(null);
    try {
      const input = target === 'new' ? { displayName: name.trim() } : { userId: target };
      const res = await createHouseholdInvitation(input, { headers: { 'x-device-token': tk } });
      if (!live(mine, tk)) return;
      setIssued({ code: res.invitationCode, id: res.invitation.id, displayName: res.invitation.displayName, role: res.invitation.role, expiresAt: res.invitation.expiresAt });
      setName(''); setTarget('new');
      void load();
    } catch (e) {
      if (live(mine, tk)) setFormError(fail(e, it('createErr')));
    } finally {
      if (live(mine, tk)) setBusy(false);
    }
  };

  const submit = () => {
    if (!token || !isMaster || busy) return;
    if (target === 'new' && !name.trim()) { setFormError(it('needName')); return; }
    const mine = epoch.current; const tk = token;
    if (target !== 'new' && target === session?.user.id) {
      confirmAction(it('ownWarnTitle'), it('ownWarn'), it('cont'), it('cancel'), () => void doCreate(mine, tk));
      return;
    }
    void doCreate(mine, tk);
  };

  const revoke = (inv: Invite) => {
    if (!token || !isMaster) return;
    const mine = epoch.current; const tk = token;
    confirmAction(it('revokeQ'), it('revokeBody'), it('revoke'), it('cancel'), () => {
      if (!live(mine, tk)) return;
      setRevoking(inv.id); setListError('');
      revokeHouseholdInvitation(inv.id, { headers: { 'x-device-token': tk } })
        .then(() => { if (live(mine, tk)) { setIssued((cur) => (cur?.id === inv.id ? null : cur)); void load(); } })
        .catch((e) => { if (live(mine, tk)) setListError(fail(e, it('revokeErr'))); })
        .finally(() => { if (live(mine, tk)) setRevoking(null); });
    });
  };

  const shareCode = async () => {
    const cur = issued;
    if (!cur || invites.some((i) => i.id === cur.id && i.status !== 'pending')) return;
    setShareError('');
    try { await Share.share({ message: `${it('shareMsg')}${group4(cur.code)}` }); }
    catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setShareError(invErrText(locale, 'shareErr'));
    }
  };

  if (!isMaster) {
    return (
      <Card>
        <Text style={[styles.h, { color: c.foreground }]}>{it('title')}</Text>
        <Text testID="invitation-member-guidance" style={[styles.p, { color: c.mutedForeground }]}>{it('memberGuide')}</Text>
      </Card>
    );
  }

  const fmt = (v: string) => new Date(v).toLocaleString(locale);
  const statusColor = (s: Invite['status']) => (s === 'pending' ? c.primary : s === 'redeemed' ? c.mutedForeground : c.destructive);
  const accounts = state?.users ?? [];

  return (
    <>
      <SectionTitle>{it('title')}</SectionTitle>
      <Card>
        <Text style={[styles.p, { color: c.mutedForeground }]}>{it('intro')}</Text>
        <Text style={[styles.lbl, { color: c.mutedForeground }]}>{it('target')}</Text>
        <View testID="invitation-target-selector" style={styles.chips}>
          {[{ id: 'new', label: it('newMember') }, ...accounts.map((u) => ({ id: u.id, label: `${u.displayName}${u.id === session?.user.id ? ` (${it('you')})` : ''}` }))].map((o) => {
            const on = target === o.id;
            return (
              <Pressable
                key={o.id} testID={`invitation-target-${o.id}`} accessibilityRole="radio" accessibilityState={{ selected: on }}
                accessibilityLabel={o.id === 'new' ? o.label : `${it('existing')}: ${o.label}`}
                disabled={busy} onPress={() => { if (busy) return; setTarget(o.id); setFormError(''); }}
                style={[styles.chip, { backgroundColor: on ? c.primary : c.secondary }]}
              >
                <Text style={{ color: on ? c.primaryForeground : c.secondaryForeground, fontFamily: 'Inter_600SemiBold' }}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {target === 'new' ? (
          <Field label={it('newName')} value={name} onChangeText={(v) => { if (busy) return; setName(v); setFormError(''); }} placeholder={it('newNamePh')} testID="new-member-name" />
        ) : null}
        {formError ? <Text accessibilityLiveRegion="polite" testID="invitation-error" style={[styles.p, { color: c.destructive }]}>{formError}</Text> : null}
        {!online ? <Text style={[styles.p, { color: c.mutedForeground }]}>{it('offline')}</Text> : null}
        <Button label={busy ? it('creating') : it('create')} icon="user-plus" onPress={submit} disabled={busy || !online} testID="create-invitation" />
        {issued ? (
          <View style={[styles.codeBox, { backgroundColor: c.secondary, borderColor: c.border }]}>
            <Text style={[styles.lbl, { color: c.mutedForeground }]}>{it('codeTitle')}</Text>
            <Text testID="invitation-code-target" style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 6 }}>{issued.displayName} · {issued.role === 'master' ? it('master') : it('member')}</Text>
            <Text selectable testID="invitation-code" accessibilityLabel={`${it('codeTitle')}: ${group4(issued.code).split(' ').join(', ')}`} style={[styles.code, { color: c.foreground }]}>{group4(issued.code)}</Text>
            <Text style={[styles.p, { color: c.mutedForeground }]}>{`${it('expires')}: ${fmt(issued.expiresAt)}`}</Text>
            <Text style={[styles.p, { color: c.destructive }]}>{it('codeNote')}</Text>
            <View style={{ gap: 8 }}>
              {canShare ? <Button label={it('share')} icon="share" onPress={() => void shareCode()} testID="share-invitation-code" /> : null}
              {shareError ? <Text accessibilityLiveRegion="polite" testID="share-error" style={{ color: c.destructive }}>{shareError}</Text> : null}
              <Button label={it('hide')} icon="eye-off" secondary onPress={() => setIssued(null)} testID="hide-invitation-code" />
            </View>
          </View>
        ) : null}
      </Card>

      <SectionTitle>{it('listTitle')}</SectionTitle>
      <Card>
        <View testID="invitation-list" style={{ gap: 4 }}>
          {loading && !loaded ? <Text style={[styles.p, { color: c.mutedForeground }]}>{it('loading')}</Text> : null}
          {listError ? <Text accessibilityLiveRegion="polite" testID="invitation-list-error" style={[styles.p, { color: c.destructive }]}>{listError}</Text> : null}
          {loaded && !invites.length && !listError ? <Text style={[styles.p, { color: c.mutedForeground }]}>{it('none')}</Text> : null}
          {invites.map((inv) => (
            <View key={inv.id} testID={`invitation-${inv.id}`} style={[styles.row, { borderBottomColor: c.border }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>{inv.displayName}{inv.userId ? '' : ` · ${it('forNew')}`}</Text>
                <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{inv.role === 'master' ? it('master') : it('member')} · {it('created')} {fmt(inv.createdAt)}</Text>
                <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{it('expires')} {fmt(inv.expiresAt)}</Text>
                <Text testID={`invitation-status-${inv.id}`} style={{ color: statusColor(inv.status), fontFamily: 'Inter_700Bold', fontSize: 12 }}>{it(inv.status)}</Text>
              </View>
              {inv.status === 'pending' ? (
                <Pressable
                  testID={`revoke-invitation-${inv.id}`} accessibilityRole="button" accessibilityLabel={`${it('revoke')}: ${inv.displayName}`}
                  disabled={revoking === inv.id || !online} onPress={() => revoke(inv)} style={[styles.revoke, { opacity: revoking === inv.id || !online ? 0.45 : 1 }]}
                >
                  <Feather name="x-circle" size={15} color={c.destructive} />
                  <Text style={{ color: c.destructive, fontFamily: 'Inter_600SemiBold' }}>{it('revoke')}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
        <Button label={loading ? it('loading') : it('refresh')} icon="refresh-cw" secondary onPress={() => void load()} disabled={loading} testID="refresh-invitations" />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  h: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  p: { lineHeight: 20, marginTop: 4, marginBottom: 10 },
  lbl: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, minHeight: 44, justifyContent: 'center' },
  codeBox: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 16 },
  code: { fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: 1, lineHeight: 32, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  revoke: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 4, minHeight: 44 },
});
