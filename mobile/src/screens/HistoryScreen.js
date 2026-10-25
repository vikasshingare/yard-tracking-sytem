import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { History, ChevronRight, Clock3, MapPin } from 'lucide-react-native';
import api, { errorMessage } from '../api';

const PAGE_SIZE=15;
export default function HistoryScreen({navigation}) {
  const [rows,setRows]=useState([]);const [page,setPage]=useState(1);const [total,setTotal]=useState(0);const [refreshing,setRefreshing]=useState(false);
  const load=useCallback(async()=>{setRefreshing(true);try{const {data}=await api.get('/history',{params:{page,limit:PAGE_SIZE}});setRows(data.rows);setTotal(data.total);}catch(error){Alert.alert('History unavailable',errorMessage(error));}finally{setRefreshing(false);}},[page]);
  useFocusEffect(useCallback(()=>{load();},[load]));
  const pageCount=Math.max(1,Math.ceil(total/PAGE_SIZE));
  return <View style={styles.page}>
    <View style={styles.hero}><View style={styles.heroIcon}><History color="white" size={23}/></View><View><Text style={styles.heroTitle}>YARD HISTORY</Text><Text style={styles.heroSubtitle}>{total} recorded actions</Text></View></View>
    <FlatList data={rows} keyExtractor={item=>String(item.id)} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load}/>} contentContainerStyle={styles.list}
      ListEmptyComponent={!refreshing&&<View style={styles.empty}><History color="#8b999f" size={32}/><Text style={styles.emptyText}>No activity recorded yet</Text></View>}
      renderItem={({item})=><Pressable style={styles.card} onPress={()=>navigation.navigate('ContainerDetails',{containerId:item.containerId})}>
        <View style={[styles.eventIcon, item.actionType==='Gate Out'?styles.red:item.actionType==='Move'?styles.blue:styles.green]}><Text style={styles.eventGlyph}>{item.actionType==='Gate Out'?'↗':item.actionType==='Move'?'⇄':item.actionType==='Gate In'?'↘':'✓'}</Text></View>
          <View style={styles.cardMain}><View style={styles.topline}><Text style={styles.action}>{item.actionType}</Text><View style={styles.dateRow}><Clock3 size={12}/><Text style={styles.date}>{new Date(item.timestamp).toLocaleString()}</Text></View></View>
          <Text style={styles.barcode}>{item.originalBarcode}</Text><Text style={styles.tracking}>{item.trackingBarcode}</Text>
          <View style={styles.location}><MapPin size={13} color="#7a8990"/><Text style={styles.locationText}>{item.toLocation||item.fromLocation||'Gate'}{item.userName?`  ·  ${item.userName}`:''}</Text></View>
        </View><ChevronRight size={18} color="#8b989e"/>
      </Pressable>}/>
    <View style={styles.pager}><Text style={styles.pageText}>{total?`${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,total)} of ${total}`:'0 records'}</Text><View style={styles.pageButtons}>
      <Pressable disabled={page<=1} onPress={()=>setPage(p=>p-1)} style={[styles.pageButton,page<=1&&styles.disabled]}><Text style={styles.buttonText}>‹</Text></Pressable><Text style={styles.pageText}>Page {page}/{pageCount}</Text><Pressable disabled={page>=pageCount} onPress={()=>setPage(p=>p+1)} style={[styles.pageButton,page>=pageCount&&styles.disabled]}><Text style={styles.buttonText}>›</Text></Pressable>
    </View></View>
  </View>;
}

const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#f4f6f8'},hero:{flexDirection:'row',alignItems:'center',gap:13,backgroundColor:'#16232d',padding:18},heroIcon:{width:44,height:44,borderRadius:13,backgroundColor:'#ffffff20',alignItems:'center',justifyContent:'center'},heroTitle:{color:'white',fontSize:18,fontWeight:'900'},heroSubtitle:{color:'#c2ccd1',fontSize:13,marginTop:3},list:{padding:14,gap:10,flexGrow:1},card:{backgroundColor:'white',borderRadius:14,padding:13,flexDirection:'row',alignItems:'center',gap:11,elevation:1},eventIcon:{width:36,height:36,borderRadius:11,alignItems:'center',justifyContent:'center'},green:{backgroundColor:'#e5f5eb'},blue:{backgroundColor:'#e7f1fb'},red:{backgroundColor:'#fcebea'},eventGlyph:{fontSize:20,color:'#18804a',fontWeight:'900'},cardMain:{flex:1,gap:3},topline:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:5},action:{fontSize:14,fontWeight:'900',color:'#1c2a33'},dateRow:{flexDirection:'row',alignItems:'center',gap:3},date:{fontSize:9,color:'#849199'},barcode:{fontSize:14,fontWeight:'800',color:'#3c4b54'},tracking:{fontSize:10,fontFamily:'monospace',color:'#77858c'},location:{flexDirection:'row',alignItems:'center',gap:4,marginTop:4},locationText:{fontSize:10,color:'#78868d',flexShrink:1},empty:{alignItems:'center',justifyContent:'center',padding:45,gap:12},emptyText:{fontSize:16,color:'#728087'},pager:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:12,backgroundColor:'white',borderTopWidth:1,borderColor:'#e8edef'},pageButtons:{flexDirection:'row',alignItems:'center',gap:9},pageText:{fontSize:11,color:'#66757d',fontWeight:'700'},pageButton:{width:34,height:34,borderRadius:9,backgroundColor:'#16232d',alignItems:'center',justifyContent:'center'},buttonText:{fontSize:24,color:'white',fontWeight:'800',lineHeight:27},disabled:{opacity:.35}});
