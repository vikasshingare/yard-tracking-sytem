import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { Picker, TextInput } from '../components/FormControls';
import { Pencil } from 'lucide-react-native';
import BarcodeScanner from '../components/BarcodeScanner';
import useLocationCapture from '../components/LocationCapture';
import api, { errorMessage } from '../api';
import { queueAction } from '../offlineQueue';

export default function PutAwayMoveScreen({role}) {
  const isSuperAdmin=role==='admin';
  const [mode, setMode] = useState('put-away');
  const [trackingBarcode, setTrackingBarcode] = useState('');
  const [ocrLocked,setOcrLocked]=useState(false);
  const [tasks,setTasks]=useState([]);
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason,setReason]=useState('Routine yard relocation');
  const [containerYardId,setContainerYardId]=useState(null);
  const [containerType,setContainerType]=useState('');
  const { coords, gpsMessage, capture } = useLocationCapture();

  async function loadLocations() {
    try {
      const { data } = await api.get('/locations');
      setLocations(data);
      const available=data.find((item)=>item.availability==='available');
      if (!locationId && available) setLocationId(String(available.id));
    } catch (error) { Alert.alert('Locations unavailable', errorMessage(error)); }
  }
  async function loadTasks(){try{const {data}=await api.get('/put-away/tasks');setTasks(data);}catch{}}
  useEffect(() => { loadLocations();loadTasks(); }, []);

  function acceptLocationScan(value) {
    const location = locations.find((item) => item.barcodeId.toLowerCase() === value.toLowerCase()&&(!containerYardId||Number(item.yardId)===Number(containerYardId))&&item.availability==='available'&&isCompatible(item));
    if (!location) return Alert.alert('Location not found', 'Scan a registered location label or choose from the list.');
    if(['blocked','reserved','full'].includes(location.availability||location.slotStatus))return Alert.alert('Slot unavailable','Choose a different active location.');
    setLocationId(String(location.id));
    Alert.alert('LOCATION SELECTED', location.zoneName);
  }

  function isCompatible(location,type=containerType){let types=location.compatibleTypes;if(typeof types==='string'){try{types=JSON.parse(types);}catch{types=[];}}if(!Array.isArray(types)||!types.length)return true;const normalized=types.map(x=>String(x).toUpperCase());return normalized.includes('ALL')||!type||normalized.includes(String(type).toUpperCase());}
  async function acceptContainerScan(value,fromOcr=false){const scanned=String(value||'').trim().toUpperCase();setTrackingBarcode(scanned);setOcrLocked(fromOcr);setContainerYardId(null);try{const {data}=await api.get('/track',{params:{q:scanned}});const record=data.results?.find(x=>x.trackingBarcode?.toUpperCase()===scanned||x.containerNumber?.toUpperCase()===scanned||x.originalBarcode?.toUpperCase()===scanned);if(!record)return Alert.alert('Container not found','Check the number or barcode, or tap EDIT to correct it.');setTrackingBarcode(record.trackingBarcode||scanned);setContainerYardId(record.yardId);setContainerType(record.typeCode||'');const eligible=locations.filter(x=>Number(x.yardId)===Number(record.yardId)&&x.availability==='available'&&isCompatible(x,record.typeCode||''));if(!eligible.some(x=>String(x.id)===String(locationId)))setLocationId(eligible[0]?String(eligible[0].id):'');if(mode==='put-away'&&record.status!=='awaiting_putaway')Alert.alert('Not waiting for put-away','This container is already stored or no longer in the yard.');}catch(error){Alert.alert('Container lookup failed',errorMessage(error));}}

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
      if(result.queued){Alert.alert('ACTION WAITING TO SYNC','Saved safely on this device. Open Sync status when the network is available.');setTrackingBarcode('');setOcrLocked(false);return;}
      const {data}=result;
      Alert.alert('SAVED', data.message);
      setTrackingBarcode('');
      setOcrLocked(false);setContainerYardId(null);await loadTasks();await loadLocations();
    } catch (error) { Alert.alert('Could not save', errorMessage(error)); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>📦  PUT-AWAY / MOVE</Text>
      <View style={styles.tabs}>
        <Pressable onPress={() => setMode('put-away')} style={[styles.tab, mode === 'put-away' && styles.putTab]}><Text style={styles.tabText}>⬇ PUT AWAY</Text></Pressable>
        <Pressable onPress={() => setMode('move')} style={[styles.tab, mode === 'move' && styles.moveTab]}><Text style={styles.tabText}>➡ MOVE</Text></Pressable>
      </View>
      {mode==='put-away'&&<View style={styles.taskCard}><Text style={styles.taskTitle}>{isSuperAdmin?'PENDING PUT-AWAY TASKS':'ASSIGNED PUT-AWAY TASKS'}</Text><Text style={styles.taskHint}>{isSuperAdmin?'Select any pending container to complete its put-away.':'Select an assigned container or scan its label.'}</Text>{tasks.map(task=><Pressable key={task.id} style={styles.taskRow} onPress={()=>acceptContainerScan(task.trackingBarcode)}><View style={styles.taskIcon}><Text style={styles.taskIconText}>📦</Text></View><View style={styles.taskCopy}><Text style={styles.taskNumber}>{task.containerNumber||task.originalBarcode}</Text><Text style={styles.taskBarcode}>{task.trackingBarcode}{isSuperAdmin&&task.assignedToName?` · ${task.assignedToName}`:''}</Text></View><Text style={styles.taskArrow}>›</Text></Pressable>)}{!tasks.length&&<Text style={styles.noTasks}>No containers waiting for put-away.</Text>}</View>}
      <Text style={styles.step}>1. Scan, photograph, or enter container code</Text>
      <BarcodeScanner label="SCAN TRACKING CODE" barcodeTypes={['code128']} allowPhotoCapture onScan={(value)=>acceptContainerScan(value,false)} onTextRecognized={(value)=>acceptContainerScan(value,true)} />
      <View style={styles.entryInputRow}><TextInput style={styles.containerInput} placeholder="Tracking barcode or container number" value={trackingBarcode} onChangeText={v=>{setTrackingBarcode(v.toUpperCase());setOcrLocked(false);setContainerYardId(null);}} onEndEditing={(e)=>{if(e.nativeEvent.text.trim())acceptContainerScan(e.nativeEvent.text.trim(),ocrLocked);}} editable={!ocrLocked} autoCapitalize="characters" autoCorrect={false}/>{ocrLocked&&<Pressable style={styles.editButton} onPress={()=>setOcrLocked(false)}><Pencil size={17} color="white"/><Text style={styles.editText}>EDIT</Text></Pressable>}</View>
      {ocrLocked&&<Text style={styles.readOnlyHint}>Photo read · tap EDIT to correct the code.</Text>}
      <Text style={styles.step}>2. Choose an available destination</Text>
      <View style={styles.picker}><Picker selectedValue={locationId} onValueChange={(value) => setLocationId(String(value))}>
        {!locations.some(location=>(!containerYardId||Number(location.yardId)===Number(containerYardId))&&location.availability==='available'&&isCompatible(location)) && <Picker.Item label="No available destinations" value="" />}
        {locations.filter(location=>(!containerYardId||Number(location.yardId)===Number(containerYardId))&&location.availability==='available'&&isCompatible(location)).map((location) => <Picker.Item key={location.id} label={`${location.label || location.zoneName} · AVAILABLE`} value={String(location.id)} />)}
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
  entryInputRow:{flexDirection:'row',alignItems:'center',gap:8},containerInput:{flex:1},editButton:{minHeight:54,paddingHorizontal:13,borderRadius:12,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,backgroundColor:'#1769AA'},editText:{color:'white',fontSize:14,fontWeight:'900'},readOnlyHint:{marginTop:-10,color:'#53616b',fontSize:13},
  taskCard:{padding:14,borderRadius:14,backgroundColor:'#fff',borderWidth:1,borderColor:'#dfe7e9',gap:7},taskTitle:{fontSize:13,fontWeight:'900',letterSpacing:.4,color:'#263840'},taskHint:{fontSize:12,color:'#68777e'},taskRow:{minHeight:58,flexDirection:'row',alignItems:'center',gap:10,borderTopWidth:1,borderTopColor:'#edf1f2'},taskIcon:{width:38,height:38,borderRadius:11,justifyContent:'center',alignItems:'center',backgroundColor:'#e8f3fb'},taskIconText:{fontSize:18},taskCopy:{flex:1},taskNumber:{fontSize:14,fontWeight:'900',color:'#17232b'},taskBarcode:{fontSize:10,fontFamily:'monospace',color:'#60727b',marginTop:3},taskArrow:{fontSize:25,color:'#77868d'},noTasks:{paddingVertical:8,fontSize:13,color:'#66777d'},
  value: { padding: 12, fontSize: 16, backgroundColor: 'white', borderRadius: 10 },
  picker: { backgroundColor: 'white', borderWidth: 1.25, borderColor: '#111111', borderRadius: 14, overflow: 'hidden' },
  gps: { fontSize: 15, color: '#53616b' },
  action: { minHeight: 68, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  green: { backgroundColor: '#16834a' }, blue: { backgroundColor: '#1672b8' },
  actionText: { color: 'white', fontSize: 21, fontWeight: '900' }, disabled: { opacity: 0.5 },
});
