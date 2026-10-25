import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { Container, MapPin, Clock3 } from 'lucide-react-native';
import api, { errorMessage } from '../api';

export default function ContainerDetailsScreen() {
  const { params }=useRoute();const [record,setRecord]=useState(null);
  const load=useCallback(async()=>{try{const {data}=await api.get(`/containers/${params.containerId}`);setRecord(data);}catch(error){Alert.alert('Record unavailable',errorMessage(error));}},[params.containerId]);
  useFocusEffect(useCallback(()=>{load();},[load]));
  if(!record)return <View style={styles.center}><Text style={styles.loading}>Loading container…</Text></View>;
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <View style={styles.summary}><View style={styles.icon}><Container size={23} color="white"/></View><Text style={styles.label}>ORIGINAL BARCODE</Text><Text style={styles.original}>{record.originalBarcode}</Text><Text style={styles.tracking}>{record.trackingBarcode}</Text>
      <View style={[styles.status,record.status==='in-yard'||record.status==='reserved_for_shipment'?styles.statusIn:styles.statusOut]}><Text style={styles.statusText}>{record.status.replaceAll('_',' ').toUpperCase()}</Text></View>
      <View style={styles.currentLocation}><MapPin size={14} color="#d3dce0"/><Text style={styles.currentLocationText}>{record.locationName||'Location not assigned'}</Text></View>
    </View>
    <View style={styles.masterCard}><Text style={styles.masterTitle}>CONTAINER DETAILS</Text><Text style={styles.masterLine}>SIZE / TYPE  ·  {record.sizeCode||'—'} / {record.typeCode||'—'}</Text><Text style={styles.masterLine}>ISO / LINE  ·  {record.isoCode||'—'} / {record.shippingLine||'—'}</Text><Text style={styles.masterLine}>SEAL / CONDITION  ·  {record.sealNumber||'—'} / {(record.conditionCode||'unknown').replaceAll('_',' ')}</Text>{record.shipment?.shipmentRef&&<Text style={styles.masterLine}>SHIPMENT  ·  {record.shipment.shipmentRef}</Text>}</View>
    <View style={styles.sectionHead}><View><Text style={styles.sectionTitle}>Container history</Text><Text style={styles.sectionSub}>{record.transactions.length} audit events</Text></View><Clock3 color="#64747b" size={19}/></View>
    {record.transactions.map((event,index)=><View key={event.id} style={styles.eventRow}><View style={styles.timelineColumn}><View style={[styles.dot,index===0&&styles.dotLatest]}/>{index<record.transactions.length-1&&<View style={styles.line}/>}</View>
      <View style={styles.eventCard}><View style={styles.eventTop}><Text style={styles.action}>{event.actionType}</Text><Text style={styles.time}>{new Date(event.timestamp).toLocaleString()}</Text></View>
        {(event.fromLocation||event.toLocation)&&<Text style={styles.route}>{event.fromLocation||'Gate'}  →  {event.toLocation||'Gate'}</Text>}
        <Text style={styles.user}>{event.userName||'User unavailable'}{event.userRole?` · ${event.userRole.replace('_',' ')}`:''}</Text>
        {event.geoLat!=null&&event.geoLong!=null&&<Text style={styles.gps}>GPS {Number(event.geoLat).toFixed(5)}, {Number(event.geoLong).toFixed(5)}</Text>}
      </View>
    </View>)}
  </ScrollView>;
}

const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#f4f6f8'},content:{padding:16,paddingBottom:30},center:{flex:1,justifyContent:'center',alignItems:'center'},loading:{color:'#66757d'},summary:{backgroundColor:'#16232d',borderRadius:18,padding:20,alignItems:'center'},icon:{width:48,height:48,borderRadius:15,backgroundColor:'#ffffff20',alignItems:'center',justifyContent:'center',marginBottom:12},label:{fontSize:10,letterSpacing:1,color:'#acbbc2',fontWeight:'800'},original:{fontSize:23,color:'white',fontWeight:'900',marginTop:5},tracking:{fontSize:12,color:'#d7e0e4',fontFamily:'monospace',marginTop:5},status:{paddingHorizontal:12,paddingVertical:7,borderRadius:20,marginTop:13},statusIn:{backgroundColor:'#d9f2e3'},statusOut:{backgroundColor:'#e7edf0'},statusText:{fontSize:10,fontWeight:'900',color:'#24363f'},currentLocation:{flexDirection:'row',alignItems:'center',gap:5,marginTop:12},currentLocationText:{fontSize:12,color:'#d3dce0',flexShrink:1},masterCard:{backgroundColor:'white',borderRadius:14,padding:15,gap:8,marginTop:12},masterTitle:{fontSize:11,fontWeight:'900',color:'#75848b',letterSpacing:1},masterLine:{fontSize:13,fontWeight:'700',color:'#34444c'},sectionHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:22,marginBottom:10},sectionTitle:{fontSize:18,fontWeight:'900',color:'#1c2a33'},sectionSub:{fontSize:12,color:'#7c8990',marginTop:3},eventRow:{flexDirection:'row',gap:10},timelineColumn:{width:15,alignItems:'center'},dot:{width:10,height:10,borderRadius:5,borderWidth:2,borderColor:'#99a8ad',backgroundColor:'#f4f6f8',marginTop:17,zIndex:1},dotLatest:{borderColor:'#228751',backgroundColor:'#dff3e6'},line:{position:'absolute',top:24,bottom:-2,width:1,backgroundColor:'#d3ddda'},eventCard:{flex:1,backgroundColor:'white',borderRadius:13,padding:13,marginBottom:10},eventTop:{flexDirection:'row',justifyContent:'space-between',gap:8},action:{fontSize:14,fontWeight:'900',color:'#25343c'},time:{fontSize:9,color:'#86939a'},route:{fontSize:12,color:'#53646c',marginTop:8},user:{fontSize:10,color:'#7b898f',marginTop:8},gps:{fontSize:9,color:'#89969c',marginTop:4}});
