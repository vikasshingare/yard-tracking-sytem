import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import BarcodeScanner from '../components/BarcodeScanner';
import useLocationCapture from '../components/LocationCapture';
import api, { errorMessage } from '../api';
import { Picker, TextInput } from '../components/FormControls';
import { Pencil } from 'lucide-react-native';

export default function GateOutScreen() {
  const [inventoryCount, setInventoryCount] = useState(0);
  const [scannedRecord, setScannedRecord] = useState(null);
  const [trackingBarcode, setTrackingBarcode] = useState('');
  const [ocrLocked,setOcrLocked]=useState(false);
  const [busy, setBusy] = useState(false);
  const [shipments, setShipments] = useState([]); const [gates, setGates] = useState([]);
  const [shipmentId, setShipmentId] = useState(''); const [gateId, setGateId] = useState('');
  const { coords, gpsMessage, capture } = useLocationCapture();

  const loadInventory = useCallback(async () => {
    try {
      const [{data}, {data: shipmentData}, {data: gateData}] = await Promise.all([
        api.get('/inventory', { params: { page: 1, limit: 1 } }),
        api.get('/shipments', { params: { page: 1, limit: 100, status: 'ready' } }),
        api.get('/gates'),
      ]);
      setInventoryCount(data.total);
      setShipments(shipmentData.rows || []); setGates(gateData || []);
      if (!shipmentId && shipmentData.rows?.length) setShipmentId(String(shipmentData.rows[0].id));
      if (!gateId && gateData?.length) setGateId(String(gateData[0].id));
    } catch (error) { Alert.alert('Inventory unavailable', errorMessage(error)); }
  }, [shipmentId, gateId]);
  useFocusEffect(useCallback(() => { loadInventory(); }, [loadInventory]));

  async function gateOut() {
    if (!trackingBarcode) return Alert.alert('Scan required', 'Scan the internal tracking code to verify exit.');
    if (!shipmentId || !gateId) return Alert.alert('Select shipment and gate', 'Choose the ready shipment and exit gate.');
    setBusy(true);
    try {
      const gps = await capture();
      if(!gps){Alert.alert('GPS required','Turn on location and allow Yard Tracker to record gate exit.');return;}
      const { data } = await api.post('/gate-out', { trackingBarcode, shipmentId:Number(shipmentId), gateId:Number(gateId), ...(gps || {}) });
      Alert.alert('EXIT SAVED', data.message);
      setTrackingBarcode(''); setScannedRecord(null);setOcrLocked(false);
      loadInventory();
    } catch (error) { Alert.alert('Exit not recorded', errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function verifyScan(value,fromOcr=false) {
    setTrackingBarcode(value); setScannedRecord(null);setOcrLocked(fromOcr);
    try {
      const { data } = await api.get('/inventory', { params: { page: 1, limit: 1, search: value } });
      const record=data.rows.find((item) => item.trackingBarcode === value||item.containerNumber===value||item.originalBarcode===value)||false;setScannedRecord(record);
      if(record){const yardShipments=shipments.filter(x=>Number(x.yardId)===Number(record.yardId)&&x.status==='ready');const yardGates=gates.filter(x=>Number(x.yardId)===Number(record.yardId)&&(x.direction==='out'||x.direction==='both'));setShipmentId(yardShipments.length?String(yardShipments[0].id):'');setGateId(yardGates.length?String(yardGates[0].id):'');}
    } catch { setScannedRecord(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>🚪  CONTAINER EXIT</Text>
      <View style={styles.count}><Text style={styles.countNumber}>{inventoryCount}</Text><Text style={styles.countLabel}>CONTAINERS IN YARD</Text></View>
      <Text style={styles.step}>1. Scan, photograph, or enter tracking code</Text>
      <BarcodeScanner label="SCAN CODE 128 FOR EXIT" barcodeTypes={['code128']} allowPhotoCapture onScan={value=>verifyScan(value,false)} onTextRecognized={value=>verifyScan(value,true)} />
      <View style={styles.entryInputRow}><TextInput style={styles.containerInput} placeholder="Tracking barcode or container number" value={trackingBarcode} onChangeText={value=>{setTrackingBarcode(value.toUpperCase());setScannedRecord(null);setOcrLocked(false);}} editable={!ocrLocked} autoCapitalize="characters" autoCorrect={false} onEndEditing={event=>{if(event.nativeEvent.text.trim())verifyScan(event.nativeEvent.text.trim(),ocrLocked);}}/>{ocrLocked&&<Pressable style={styles.editButton} onPress={()=>{setOcrLocked(false);setScannedRecord(null);}}><Pencil size={17} color="white"/><Text style={styles.editText}>EDIT</Text></Pressable>}</View>
      {ocrLocked&&<Text style={styles.ocrHint}>Photo read · tap EDIT to correct the code.</Text>}
      {!!trackingBarcode && <View style={styles.verify}>
        <Text style={styles.verifyTitle}>{scannedRecord ? '✅ CONTAINER IN YARD' : scannedRecord === false ? '⚠ NOT IN INVENTORY' : 'CHECKING CODE…'}</Text>
        <Text style={styles.value}>{trackingBarcode}</Text>
        {scannedRecord && <Text style={styles.location}>📍 {scannedRecord.locationName || 'Location not assigned'}</Text>}
      </View>}
      <Text style={styles.step}>2. Choose shipment and exit gate</Text>
      <Text style={styles.fieldLabel}>SHIPMENT</Text>
      <View style={styles.picker}><Picker selectedValue={shipmentId} onValueChange={setShipmentId}>{shipments.filter(x=>!scannedRecord||scannedRecord===false||Number(x.yardId)===Number(scannedRecord.yardId)).map(x=><Picker.Item key={x.id} label={`${x.shipmentRef} · ${x.activeContainers} containers`} value={String(x.id)}/>)}</Picker></View>
      <Text style={styles.fieldLabel}>EXIT GATE</Text>
      <View style={styles.picker}><Picker selectedValue={gateId} onValueChange={setGateId}>{gates.filter(x=>(x.direction==='out'||x.direction==='both')&&(!scannedRecord||scannedRecord===false||Number(x.yardId)===Number(scannedRecord.yardId))).map(x=><Picker.Item key={x.id} label={x.gateName} value={String(x.id)}/>)}</Picker></View>
      <Text style={styles.gps}>📍 {gpsMessage}{coords ? `  ${coords.geoLat.toFixed(4)}, ${coords.geoLong.toFixed(4)}` : ''}</Text>
      <Pressable disabled={busy || !scannedRecord} onPress={gateOut} style={[styles.action, (!scannedRecord || busy) && styles.disabled]}>
        <Text style={styles.actionText}>{busy ? 'SAVING…' : '🚪  CONFIRM EXIT'}</Text>
      </Pressable>
      <Pressable onPress={loadInventory} style={styles.refresh}><Text style={styles.refreshText}>↻  REFRESH INVENTORY</Text></Pressable>
      <Text style={styles.note}>Exit is enabled only when the scanned code is in the yard list.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 18, gap: 16, backgroundColor: '#f4f6f8', flexGrow: 1 },
  title: { fontSize: 25, fontWeight: '900', color: '#16232d' },
  count: { padding: 16, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center' },
  countNumber: { fontSize: 38, fontWeight: '900', color: '#16232d' },
  countLabel: { fontSize: 15, fontWeight: '800', color: '#53616b' },
  step: { fontSize: 18, fontWeight: '700', color: '#283640' },
  entryInputRow:{flexDirection:'row',alignItems:'center',gap:8},containerInput:{flex:1},editButton:{minHeight:54,paddingHorizontal:13,borderRadius:12,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,backgroundColor:'#1769AA'},editText:{color:'white',fontSize:14,fontWeight:'900'},ocrHint:{marginTop:-10,color:'#53616b',fontSize:13},
  verify: { padding: 16, borderRadius: 14, backgroundColor: 'white', gap: 8 },
  picker: { backgroundColor: 'white', borderWidth: 1.25, borderColor: '#111111', borderRadius: 14, overflow: 'hidden' }, fieldLabel: { marginBottom: -10, fontSize: 13, fontWeight: '900', color: '#53616B', letterSpacing: 0.4 },
  verifyTitle: { fontSize: 19, fontWeight: '900', color: '#16232d' },
  value: { fontSize: 17, fontWeight: '700' }, location: { fontSize: 16, color: '#53616b' },
  gps: { fontSize: 15, color: '#53616b' },
  action: { minHeight: 72, borderRadius: 14, justifyContent: 'center', alignItems: 'center', backgroundColor: '#c63535' },
  actionText: { color: 'white', fontSize: 22, fontWeight: '900' },
  disabled: { opacity: 0.4 },
  refresh: { minHeight: 56, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: '#26343e' },
  refreshText: { color: 'white', fontSize: 17, fontWeight: '800' },
  note: { fontSize: 14, color: '#53616b', textAlign: 'center' },
});
