import React, { useState } from 'react';
import { Alert, ScrollView, Text, View, StyleSheet, TextInput } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import Barcode from 'react-native-barcode-svg';
import BarcodeScanner from '../components/BarcodeScanner';
import useLocationCapture from '../components/LocationCapture';
import api, { errorMessage } from '../api';
import { queueAction } from '../offlineQueue';

export default function GateInScreen() {
  const [originalBarcode, setOriginalBarcode] = useState('');
  const [trackingBarcode, setTrackingBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [gates, setGates] = useState([]); const [gateId,setGateId]=useState('');
  const [sizeCode,setSizeCode]=useState('40'); const [typeCode,setTypeCode]=useState('general'); const [conditionCode,setConditionCode]=useState('good');
  const [shippingLine,setShippingLine]=useState(''); const [sealNumber,setSealNumber]=useState('');
  const { coords, gpsMessage, capture } = useLocationCapture();
  React.useEffect(()=>{api.get('/gates').then(({data})=>{const inbound=data.filter(x=>x.direction==='in'||x.direction==='both');setGates(inbound);if(inbound.length)setGateId(String(inbound[0].id));}).catch(()=>{});},[]);

  async function register() {
    if (!originalBarcode) return Alert.alert('Scan required', 'Scan the container barcode first.');
    setBusy(true);
    try {
      const gps = await capture();
      if(!gps){Alert.alert('GPS required','Turn on location and allow Yard Tracker to record gate entry.');return;}
      const gate=gates.find(x=>String(x.id)===String(gateId));
      const result = await queueAction('/gate-in', { originalBarcode,containerNumber:originalBarcode,sizeCode:`${sizeCode}ft`,typeCode,conditionCode,shippingLine,sealNumber,gateId:Number(gateId)||undefined,yardId:gate?.yardId,...(gps || {}) });
      if(result.queued){Alert.alert('ENTRY WAITING TO SYNC','Saved safely on this device. Open Sync status when the network is available.');setOriginalBarcode('');return;}
      const {data}=result;
      setTrackingBarcode(data.trackingBarcode);
      Alert.alert('ENTRY SAVED', 'Print or attach the tracking barcode to the container.');
    } catch (error) { Alert.alert('Could not save entry', errorMessage(error)); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>🚚  CONTAINER ENTRY</Text>
      <Text style={styles.step}>1. Scan container barcode</Text>
      <BarcodeScanner label="SCAN CONTAINER CODE 128" barcodeTypes={['code128']} onScan={(value) => { setOriginalBarcode(value); setTrackingBarcode(''); }} />
      {!!originalBarcode && <Text style={styles.value}>Scanned: {originalBarcode}</Text>}
      <Text style={styles.step}>2. Container details</Text>
      <Text style={styles.label}>SIZE</Text><View style={styles.picker}><Picker selectedValue={sizeCode} onValueChange={setSizeCode}><Picker.Item label="20 foot" value="20"/><Picker.Item label="40 foot" value="40"/><Picker.Item label="45 foot" value="45"/></Picker></View>
      <Text style={styles.label}>CONTAINER TYPE</Text><View style={styles.picker}><Picker selectedValue={typeCode} onValueChange={setTypeCode}>{['general','reefer','open_top','flat_rack','tank'].map(x=><Picker.Item key={x} label={x.replace('_',' ').toUpperCase()} value={x}/>)}</Picker></View>
      <Text style={styles.label}>CONDITION</Text><View style={styles.picker}><Picker selectedValue={conditionCode} onValueChange={setConditionCode}><Picker.Item label="Good" value="good"/><Picker.Item label="Damaged" value="damaged"/><Picker.Item label="Needs inspection" value="inspection_required"/></Picker></View>
      <TextInput style={styles.input} placeholder="Shipping line (optional)" value={shippingLine} onChangeText={setShippingLine}/><TextInput style={styles.input} placeholder="Seal number (optional)" value={sealNumber} onChangeText={setSealNumber}/>
      <Text style={styles.label}>ENTRY GATE</Text><View style={styles.picker}><Picker selectedValue={gateId} onValueChange={setGateId}>{gates.map(x=><Picker.Item key={x.id} label={x.gateName} value={String(x.id)}/>)}</Picker></View>
      <Text style={styles.gps}>📍 {gpsMessage}{coords ? `  ${coords.geoLat.toFixed(4)}, ${coords.geoLong.toFixed(4)}` : ''}</Text>
      <Text onPress={register} accessibilityRole="button" style={[styles.action, busy && styles.disabled]}>{busy ? 'SAVING…' : '✅  SAVE ENTRY'}</Text>
      {!!trackingBarcode && <View style={styles.card}>
        <Text style={styles.success}>ENTRY SAVED</Text>
        <Text style={styles.step}>Attach this tracking code to container</Text>
        <View style={styles.barcode}><Barcode value={trackingBarcode} format="CODE128" height={74} lineColor="#111" backgroundColor="#fff" maxWidth={320} /></View>
        <Text selectable style={styles.code}>{trackingBarcode}</Text>
      </View>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 18, gap: 16, backgroundColor: '#f4f6f8', flexGrow: 1 },
  title: { fontSize: 25, fontWeight: '900', color: '#16232d', marginBottom: 4 },
  step: { fontSize: 18, fontWeight: '700', color: '#283640' },
  value: { fontSize: 17, padding: 12, backgroundColor: 'white', borderRadius: 10 },
  label:{fontSize:13,fontWeight:'900',color:'#53616b'},picker:{backgroundColor:'#fff',borderRadius:12,overflow:'hidden'},input:{minHeight:54,paddingHorizontal:14,backgroundColor:'#fff',borderRadius:12,fontSize:16},
  gps: { fontSize: 15, color: '#53616b' },
  action: { textAlign: 'center', overflow: 'hidden', padding: 20, borderRadius: 14, color: 'white', backgroundColor: '#16834a', fontSize: 22, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  card: { backgroundColor: 'white', borderRadius: 16, padding: 16, gap: 14, alignItems: 'center' },
  success: { fontSize: 24, color: '#16834a', fontWeight: '900' },
  barcode: { padding: 12, backgroundColor: 'white' },
  code: { fontSize: 19, fontWeight: '800', letterSpacing: 1 },
});
