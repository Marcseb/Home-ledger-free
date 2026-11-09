import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import * as Network from 'expo-network';
import { discoverLanServers, localServerPort, type LanServer } from '@/lib/server-discovery';
import { isAcceleratedTestBuild } from '@/lib/app-time';
import { useColors } from '@/hooks/useColors';
import { translateLiteral, useI18n } from '@/lib/i18n';

export function FindLocalServer({ address, onSelect }: { address: string; onSelect: (address: string) => void }) {
  const c = useColors(); const { locale } = useI18n();
  const tr = (text: string) => translateLiteral(text, locale);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [servers, setServers] = useState<LanServer[]>([]);
  const controller = useRef<AbortController | null>(null);
  const initialAddress = useRef(address);
  const currentAddress = useRef(address); currentAddress.current = address;
  const selectRef = useRef(onSelect); selectRef.current = onSelect;
  const scan = async (automatic = false) => {
    if (controller.current || Platform.OS === 'web') return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setMessage(''); setServers([]);
    try {
      const localIp = await Network.getIpAddressAsync();
      const found = await discoverLanServers({
        localIp, port: localServerPort(currentAddress.current) ?? (isAcceleratedTestBuild ? 5001 : 5000),
        variant: isAcceleratedTestBuild ? 'accelerated-test' : 'production', signal: request.signal,
      });
      if (request.signal.aborted) return;
      if (found.length === 1 && (!automatic || currentAddress.current === initialAddress.current)) selectRef.current(found[0].address);
      else setServers(found);
      if (!found.length && !automatic) setMessage('No Home Ledger server found. Enter its address.');
    } catch {
      if (!request.signal.aborted && !automatic) setMessage('Connect to your home Wi-Fi to find the server.');
    } finally {
      if (controller.current === request) { controller.current = null; setBusy(false); }
    }
  };
  useEffect(() => {
    if (!initialAddress.current) void scan(true);
    return () => { controller.current?.abort(); };
  }, []);
  if (Platform.OS === 'web') return null;
  return <View style={{ marginTop: -8, marginBottom: 10 }}>
    <Pressable testID="find-local-server" accessibilityRole="button" disabled={busy} onPress={() => void scan()} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: c.primary, fontSize: 13 }}>{tr(busy ? 'Finding your server on Wi-Fi…' : 'Find on Wi-Fi')}</Text>
    </Pressable>
    {servers.map((server) => <Pressable key={server.id} accessibilityRole="button" onPress={() => { onSelect(server.address); setServers([]); }} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: c.primary }}>{server.address}</Text>
    </Pressable>)}
    {message ? <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{tr(message)}</Text> : null}
  </View>;
}
