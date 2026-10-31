import React, { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { TextInput, Picker } from '../components/FormControls';
import { Pencil, Printer } from 'lucide-react-native';
import Barcode from 'react-native-barcode-svg';
import BarcodeScanner from '../components/BarcodeScanner';
import useLocationCapture from '../components/LocationCapture';
import api, { errorMessage } from '../api';
import { queueAction } from '../offlineQueue';
import { printTrackingBarcode } from '../utils/barcodePrint';

export default function GateInScreen() {
  const [originalBarcode, setOriginalBarcode] = useState('');
  const [trackingBarcode, setTrackingBarcode] = useState('');
  const [ocrLocked, setOcrLocked] = useState(false);
  const [containerPhoto, setContainerPhoto] = useState(null);
  const [photoUploadTarget,setPhotoUploadTarget]=useState(null);
  const [busy, setBusy] = useState(false);
  const [gates, setGates] = useState([]); const [gateId,setGateId]=useState('');
  const [yardOperators,setYardOperators]=useState([]); const [assignedTo,setAssignedTo]=useState('');
  const [sizeCode,setSizeCode]=useState('40'); const [typeCode,setTypeCode]=useState('general'); const [conditionCode,setConditionCode]=useState('good');
  const [shippingLine,setShippingLine]=useState(''); const [sealNumber,setSealNumber]=useState('');
  const { coords, gpsMessage, capture } = useLocationCapture();
  React.useEffect(()=>{api.get('/gates').then(async({data})=>{const inbound=data.filter(x=>x.direction==='in'||x.direction==='both');setGates(inbound);if(inbound.length){setGateId(String(inbound[0].id));await loadYardOperators(inbound[0].yardId);}}).catch(()=>{});},[]);
  async function loadYardOperators(yardId){try{const {data}=await api.get('/yard-operators',{params:{yardId}});setYardOperators(data);setAssignedTo((current)=>data.some(x=>String(x.id)===String(current))?current:(data[0]?String(data[0].id):''));}catch{setYardOperators([]);setAssignedTo('');}}

  async function uploadContainerPhoto(containerId,uri){
    const photo=new FormData();
    photo.append('photo',{uri,name:`container-${containerId}.jpg`,type:'image/jpeg'});
    await api.post(`/containers/${containerId}/photos`,photo,{headers:{'Content-Type':'multipart/form-data'}});
  }

  async function register() {
    if (!originalBarcode.trim()) return Alert.alert('Container number required', 'Scan or enter the container number first.');
    if (!assignedTo) return Alert.alert('Put-away operator required', 'Choose the Yard Operator who will store this container.');
    setBusy(true);
    try {
      const gps = await capture();
      if(!gps){Alert.alert('GPS required','Turn on location and allow Yard Tracker to record gate entry.');return;}
      const gate=gates.find(x=>String(x.id)===String(gateId));
      const request={ originalBarcode,containerNumber:originalBarcode,sizeCode:`${sizeCode}ft`,typeCode,conditionCode,shippingLine,sealNumber,gateId:Number(gateId)||undefined,yardId:gate?.yardId,assignedTo:Number(assignedTo),...(gps||{}) };
      // A captured container photo must be uploaded with its real container record, so
      // don't queue this entry offline where the local photo cannot yet be transferred.
      const result=containerPhoto?{data:(await api.post('/gate-in',request)).data}:await queueAction('/gate-in',request);
      if(result.queued){Alert.alert('ENTRY WAITING TO SYNC','Saved safely on this device. Open Sync status when the network is available.');setOriginalBarcode('');return;}
      const {data}=result;
      setTrackingBarcode(data.trackingBarcode);
      if(containerPhoto){try{await uploadContainerPhoto(data.containerId,containerPhoto);setPhotoUploadTarget(null);setContainerPhoto(null);Alert.alert('ENTRY + PHOTO SAVED','Print or attach the tracking barcode to the container.');}catch{setPhotoUploadTarget(data.containerId);Alert.alert('ENTRY SAVED · PHOTO PENDING','The Gate Entry was saved. The photo is still selected; tap RETRY PHOTO after reconnecting.');}}
      else Alert.alert('ENTRY SAVED', 'Print or attach the tracking barcode to the container.');
    } catch (error) { Alert.alert('Could not save entry', errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function printLabel() {
    try { await printTrackingBarcode(trackingBarcode); }
    catch (error) { Alert.alert('Print unavailable', error?.message || 'Could not open the print dialog.'); }
  }
  async function retryPhotoUpload(){if(!photoUploadTarget||!containerPhoto)return;try{await uploadContainerPhoto(photoUploadTarget,containerPhoto);setPhotoUploadTarget(null);setContainerPhoto(null);Alert.alert('PHOTO SAVED','Container photo attached to the Gate Entry.');}catch(error){Alert.alert('PHOTO NOT UPLOADED',errorMessage(error));}}

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>🟢  GATE ENTRY</Text>
      <Text style={styles.step}>1. Scan, photograph, or enter container number</Text>
      <BarcodeScanner
        label="SCAN CONTAINER CODE 128"
        barcodeTypes={['code128']}
        allowPhotoCapture
        allowContainerPhoto
        onTextRecognized={(value) => { setOriginalBarcode(value); setOcrLocked(true); setTrackingBarcode(''); }}
        onScan={(value) => { setOriginalBarcode(value); setOcrLocked(false); setTrackingBarcode(''); }}
        onPhotoCaptured={(uri)=>{setContainerPhoto(uri);setPhotoUploadTarget(null);}}
      />
      {containerPhoto&&<View style={styles.photoCard}><Image source={{uri:containerPhoto}} style={styles.photoPreview}/><View style={styles.photoCopy}><Text style={styles.photoTitle}>{photoUploadTarget?'PHOTO UPLOAD PENDING':'CONTAINER PHOTO ATTACHED'}</Text><Text style={styles.photoHint}>Photo saved with Gate Entry.</Text>{photoUploadTarget&&<Pressable onPress={retryPhotoUpload}><Text style={styles.retryPhoto}>RETRY PHOTO UPLOAD</Text></Pressable>}</View><Pressable accessibilityRole="button" style={styles.removePhoto} onPress={()=>{setContainerPhoto(null);setPhotoUploadTarget(null);}}><Text style={styles.removePhotoText}>REMOVE</Text></Pressable></View>}
      <View style={styles.entryInputRow}>
        <TextInput
          style={styles.containerInput}
          placeholder="Container number (or type it)"
          value={originalBarcode}
          onChangeText={(value) => { setOriginalBarcode(value.toUpperCase()); setTrackingBarcode(''); }}
          editable={!ocrLocked}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Container number"
        />
        {ocrLocked && <Pressable style={styles.editButton} onPress={() => setOcrLocked(false)} accessibilityRole="button" accessibilityLabel="Edit read container number">
          <Pencil size={18} color="white"/><Text style={styles.editText}>EDIT</Text>
        </Pressable>}
      </View>
      {ocrLocked && <Text style={styles.readOnlyHint}>Photo read · tap EDIT if the number needs correction.</Text>}
      <Text style={styles.step}>2. Container details</Text>
      <Text style={styles.label}>SIZE</Text><View style={styles.picker}><Picker selectedValue={sizeCode} onValueChange={setSizeCode}><Picker.Item label="20 foot" value="20"/><Picker.Item label="40 foot" value="40"/><Picker.Item label="45 foot" value="45"/></Picker></View>
      <Text style={styles.label}>CONTAINER TYPE</Text><View style={styles.picker}><Picker selectedValue={typeCode} onValueChange={setTypeCode}>{['general','reefer','open_top','flat_rack','tank'].map(x=><Picker.Item key={x} label={x.replace('_',' ').toUpperCase()} value={x}/>)}</Picker></View>
      <Text style={styles.label}>CONDITION</Text><View style={styles.picker}><Picker selectedValue={conditionCode} onValueChange={setConditionCode}><Picker.Item label="Good" value="good"/><Picker.Item label="Damaged" value="damaged"/><Picker.Item label="Needs inspection" value="inspection_required"/></Picker></View>
      <TextInput style={styles.input} placeholder="Shipping line (optional)" value={shippingLine} onChangeText={setShippingLine}/><TextInput style={styles.input} placeholder="Seal number (optional)" value={sealNumber} onChangeText={setSealNumber}/>
      <Text style={styles.label}>ENTRY GATE</Text><View style={styles.picker}><Picker selectedValue={gateId} onValueChange={(value)=>{setGateId(String(value));const gate=gates.find(x=>String(x.id)===String(value));if(gate)loadYardOperators(gate.yardId);}}>{gates.map(x=><Picker.Item key={x.id} label={x.gateName} value={String(x.id)}/>)}</Picker></View>
      <Text style={styles.label}>PUT-AWAY ASSIGNED TO · YARD OPERATOR</Text><View style={styles.picker}><Picker selectedValue={assignedTo} onValueChange={(value)=>setAssignedTo(String(value))} placeholder="Select Yard Operator">{yardOperators.map(x=><Picker.Item key={x.id} label={x.displayName} value={String(x.id)}/>)}</Picker></View>
      <Text style={styles.gps}>📍 {gpsMessage}{coords ? `  ${coords.geoLat.toFixed(4)}, ${coords.geoLong.toFixed(4)}` : ''}</Text>
      <Text onPress={register} accessibilityRole="button" style={[styles.action, busy && styles.disabled]}>{busy ? 'SAVING…' : '✅  SAVE ENTRY'}</Text>
      {!!trackingBarcode && <View style={styles.card}>
        <Text style={styles.success}>ENTRY SAVED</Text>
        <Text style={styles.step}>Attach this tracking code to container</Text>
        <View style={styles.barcode}><Barcode value={trackingBarcode} format="CODE128" height={74} lineColor="#111" backgroundColor="#fff" maxWidth={320} /></View>
        <Text selectable style={styles.code}>{trackingBarcode}</Text>
        <Pressable style={styles.printButton} onPress={printLabel}><Printer size={18} color="white"/><Text style={styles.printText}>PRINT TRACKING LABEL</Text></Pressable>
      </View>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 18, gap: 16, backgroundColor: '#f4f6f8', flexGrow: 1 },
  title: { fontSize: 25, fontWeight: '900', color: '#16232d', marginBottom: 4 },
  step: { fontSize: 18, fontWeight: '700', color: '#283640' },
  value: { fontSize: 17, padding: 12, backgroundColor: 'white', borderRadius: 10 },
  entryInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  containerInput: { flex: 1 },
  editButton: { minHeight: 56, paddingHorizontal: 14, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#1769AA' },
  editText: { color: 'white', fontSize: 15, fontWeight: '900' },
  readOnlyHint: { marginTop: -10, color: '#53616b', fontSize: 13 },
  photoCard:{flexDirection:'row',alignItems:'center',gap:10,padding:10,borderRadius:13,backgroundColor:'#e8f5ed'},photoPreview:{width:62,height:62,borderRadius:9,backgroundColor:'#d5e4dc'},photoCopy:{flex:1},photoTitle:{fontSize:11,fontWeight:'900',color:'#1b6d42'},photoHint:{fontSize:11,color:'#4f685b',marginTop:4},retryPhoto:{color:'#1769aa',fontSize:11,fontWeight:'900',marginTop:6},removePhoto:{paddingHorizontal:10,paddingVertical:9,borderRadius:9,backgroundColor:'#fff'},removePhotoText:{fontSize:10,fontWeight:'900',color:'#9f3b35'},
  label:{fontSize:13,fontWeight:'900',color:'#53616b'},picker:{backgroundColor:'#fff',borderWidth:1.25,borderColor:'#111111',borderRadius:14,overflow:'hidden'},input:{minHeight:54,paddingHorizontal:14,backgroundColor:'#fff',borderRadius:12,fontSize:16},
  gps: { fontSize: 15, color: '#53616b' },
  action: { textAlign: 'center', overflow: 'hidden', padding: 20, borderRadius: 14, color: 'white', backgroundColor: '#16834a', fontSize: 22, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  card: { backgroundColor: 'white', borderRadius: 16, padding: 16, gap: 14, alignItems: 'center' },
  success: { fontSize: 24, color: '#16834a', fontWeight: '900' },
  barcode: { padding: 12, backgroundColor: 'white' },
  code: { fontSize: 19, fontWeight: '800', letterSpacing: 1 },
  printButton: { minHeight: 54, width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 12, backgroundColor: '#1769AA' },
  printText: { color: 'white', fontSize: 16, fontWeight: '900' },
});
