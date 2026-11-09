import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Field } from './Ui';
import { useLedger } from '@/lib/ledger-context';
import { useColors } from '@/hooks/useColors';
import { translateLiteral, useI18n } from '@/lib/i18n';

export function ServerConnectionControls() {
  const c = useColors(); const { locale } = useI18n();
  const tr = (text: string) => translateLiteral(text, locale);
  const { session, online, discoveringServer, discoveryMessage, discoveredServers, findServer, changeServerAddress } = useLedger();
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connect = async (value: string) => {
    setBusy(true); setError('');
    try { await changeServerAddress(value); setEditing(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not change the server address.'); }
    finally { setBusy(false); }
  };
  if (!session) return null;
  return <View style={{ marginTop: 12, gap: 8 }}>
    <Text selectable testID="saved-server-address" style={{ color: c.mutedForeground, fontSize: 12 }}>{session.serverAddress}</Text>
    {discoveringServer || discoveryMessage ? <Text accessibilityLiveRegion="polite" style={{ color: c.mutedForeground, fontSize: 12 }}>{tr(discoveringServer ? 'Finding your server on Wi-Fi…' : discoveryMessage)}</Text> : null}
    {discoveredServers.map((server) => <Pressable key={server.id} testID={`choose-server-${server.id}`} accessibilityRole="button" disabled={busy} onPress={() => void connect(server.address)} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold' }}>{server.address}</Text>
    </Pressable>)}
    <View style={{ flexDirection: 'row', gap: 24, alignItems: 'center' }}>
      {!online ? <Pressable testID="find-household-server" accessibilityRole="button" disabled={discoveringServer || busy} onPress={() => { setError(''); void findServer(); }} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: c.primary, fontSize: 13 }}>{tr('Find on Wi-Fi')}</Text>
      </Pressable> : null}
      <Pressable testID="edit-server-address" accessibilityRole="button" disabled={busy} onPress={() => { setAddress(session.serverAddress); setEditing((value) => !value); setError(''); }} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: c.mutedForeground, fontSize: 13 }}>{tr(editing ? 'Cancel' : 'Edit address')}</Text>
      </Pressable>
    </View>
    {editing ? <>
      <Field label={tr('Server address')} value={address} onChangeText={setAddress} keyboardType="url" testID="change-server-address" />
      <Button label={tr(busy ? 'Checking…' : 'Connect')} secondary disabled={busy || !address.trim()} onPress={() => void connect(address)} testID="connect-changed-server" />
    </> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={{ color: c.destructive, fontSize: 12 }}>{tr(error)}</Text> : null}
  </View>;
}
