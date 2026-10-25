import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import BarcodeScanner from '../components/BarcodeScanner';
import useLocationCapture from '../components/LocationCapture';
import api, { errorMessage } from '../api';
import { queueAction } from '../offlineQueue';

export default function PutAwayMoveScreen() {
  const [mode, setMode] = useState('put-away');
  const [trackingBarcode, setTrackingBarcode] = useState('');
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason,setReason]=useState('Routine yard relocation');
  const [containerYardId,setContainerYardId]=useState(null);
  const { coords, gpsMessage, capture } = useLocationCapture();

  async function loadLocations() {
    try {
      const { data } = await api.get('/locations');
      setLocations(data);
      if (!locationId && data.length) setLocationId(String(data[0].id));
    } catch (error) { Alert.alert('Locations unavailable', errorMessage(error)); }
  }
  useEffect(() => { loadLocations(); }, []);

  function acceptLocationScan(value) {
    const location = locations.find((item) => item.barcodeId.toLowerCase() === value.toLowerCase()&&(!containerYardId||Number(item.yardId)===Number(containerYardId)));
    if (!location) return Alert.alert('Location not found', 'Scan a registered location label or choose from the list.');
    if(['blocked','reserved','full'].includes(location.availability||location.slotStatus))return Alert.alert('Slot unavailable','Choose a different active location.');
    setLocationId(String(location.id));
    Alert.alert('LOCATION SELECTED', location.zoneName);
  }

  async function acceptContainerScan(value){setTrackingBarcode(value);setContainerYardId(null);try{const {data}=await api.get('/track',{params:{q:value}});const record=data.results?.find(x=>x.trackingBarcode===value||x.containerNumber===value);if(!record)return Alert.alert('Container not found','Scan the internal tracking label for an active container.');setContainerYardId(record.yardId);const eligible=locations.filter(x=>Number(x.yardId)===Number(record.yardId)&&!['blocked','reserved','full'].includes(x.availability||x.slotStatus));if(eligible.length&&!eligible.some(x=>String(x.id)===String(locationId)))setLocationId(String(eligible[0].id));}catch(error){Alert.alert('Container lookup failed',errorMessage(error));}}

  async function save() {
    if (!trackingBarcode) return Alert.alert('Scan required', 'Scan the container tracking barcode.');
    if (!locationId) return Alert.alert('Location required', 'Choose or scan a destination location.');
    setBusy(true);
    try {
      const gps = await capture();
      const body = { trackingBarcode, ...(gps || {}) };
      if(mode==='move')body.reason=reason;
      if (mode === 'put-away') body.locationId = Number(locationId);
      else body.destinationLocationId = Number(locationId);
      const result = await queueAction(`/${mode}`, body);
      if(result.queued){Alert.alert('ACTION WAITING TO SYNC','Saved safely on this device. Open Sync status when the network is available.');setTrackingBarcode('');return;}
      const {data}=result;
      Alert.alert('SAVED', data.message);
      setTrackingBarcode('');
    } catch (error) { Alert.alert('Could not save', errorMessage(error)); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>📦  STORE / MOVE</Text>
      <View style={styles.tabs}>
        <Pressable onPress={() => setMode('put-away')} style={[styles.tab, mode === 'put-away' && styles.putTab]}><Text style={styles.tabText}>⬇ PUT AWAY</Text></Pressable>
        <Pressable onPress={() => setMode('move')} style={[styles.tab, mode === 'move' && styles.moveTab]}><Text style={styles.tabText}>➡ MOVE</Text></Pressable>
      </View>
      <Text style={styles.step}>1. Scan container tracking code</Text>
      <BarcodeScanner label="SCAN CONTAINER CODE 128" barcodeTypes={['code128']} onScan={acceptContainerScan} />
      {!!trackingBarcode && <Text style={styles.value}>Container: {trackingBarcode}</Text>}
      <Text style={styles.step}>2. Choose or scan destination</Text>
      <View style={styles.picker}><Picker selectedValue={locationId} onValueChange={(value) => setLocationId(String(value))}>
        {locations.length === 0 && <Picker.Item label="No locations loaded" value="" />}
        {locations.filter(location=>(!containerYardId||Number(location.yardId)===Number(containerYardId))&&!['blocked','reserved','full'].includes(location.availability||location.slotStatus)).map((location) => <Picker.Item key={location.id} label={`${location.label || location.zoneName} · ${location.availability||'available'}`} value={String(location.id)} />)}
      </Picker></View>
      <BarcodeScanner label="SCAN LOCATION LABEL" onScan={acceptLocationScan} />
      {mode==='move'&&<><Text style={styles.step}>3. Reason for move</Text><View style={styles.picker}><Picker selectedValue={reason} onValueChange={setReason}>{['Routine yard relocation','Space optimization','Container inspection','Shipment preparation','Safety requirement'].map(x=><Picker.Item key={x} label={x} value={x}/>)}</Picker></View></>}
      <Text style={styles.gps}>📍 {gpsMessage}</Text>
      <Pressable disabled={busy} onPress={save} style={[styles.action, mode === 'move' ? styles.blue : styles.green, busy && styles.disabled]}>
        <Text style={styles.actionText}>{busy ? 'SAVING…' : mode === 'move' ? '➡  SAVE MOVE' : '✅  SAVE LOCATION'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 18, gap: 16, backgroundColor: '#f4f6f8', flexGrow: 1 },
  title: { fontSize: 25, fontWeight: '900', color: '#16232d' },
  tabs: { flexDirection: 'row', gap: 10 },
  tab: { flex: 1, minHeight: 56, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: '#6c7780' },
  putTab: { backgroundColor: '#16834a' }, moveTab: { backgroundColor: '#1672b8' },
  tabText: { color: 'white', fontWeight: '900', fontSize: 16 },
  step: { fontSize: 18, fontWeight: '700', color: '#283640' },
  value: { padding: 12, fontSize: 16, backgroundColor: 'white', borderRadius: 10 },
  picker: { backgroundColor: 'white', borderRadius: 12, overflow: 'hidden' },
  gps: { fontSize: 15, color: '#53616b' },
  action: { minHeight: 68, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  green: { backgroundColor: '#16834a' }, blue: { backgroundColor: '#1672b8' },
  actionText: { color: 'white', fontSize: 21, fontWeight: '900' }, disabled: { opacity: 0.5 },
});
