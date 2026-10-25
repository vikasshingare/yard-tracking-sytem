import React,{useCallback,useState} from 'react';
import {Alert,FlatList,Pressable,RefreshControl,StyleSheet,Text,View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {clearConfirmed,listQueued,removeFailed,syncQueued} from '../offlineQueue';

const colors={pending:'#c27a11',syncing:'#1672b8',confirmed:'#16834a',failed:'#c63535'};
export default function SyncStatusScreen(){const [items,setItems]=useState([]),[busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{try{setItems(await listQueued());}catch(e){Alert.alert('Sync status unavailable',e.message);}},[]);
 useFocusEffect(useCallback(()=>{refresh();},[refresh]));
 async function sync(){setBusy(true);try{setItems(await syncQueued());}catch(e){Alert.alert('Sync failed',e.message);}finally{setBusy(false);}}
 async function clear(){await clearConfirmed();refresh();}
 async function remove(id){await removeFailed(id);refresh();}
 const count=items.filter(x=>x.status==='pending'||x.status==='failed').length;
 return <View style={s.page}><Text style={s.title}>🔄  SYNC STATUS</Text><Text style={s.sub}>{count} action{count===1?'':'s'} waiting for server confirmation.</Text>
  <Pressable onPress={sync} disabled={busy||!count} style={[s.sync,(busy||!count)&&s.disabled]}><Text style={s.syncText}>{busy?'SYNCING…':'↻  SYNC NOW'}</Text></Pressable>
  <FlatList data={items} keyExtractor={x=>x.id} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh}/>} contentContainerStyle={s.list} ListEmptyComponent={<Text style={s.empty}>No saved actions.</Text>} renderItem={({item})=>{let response={};try{response=JSON.parse(item.response||'{}');}catch{}return <View style={s.card}><View style={s.line}><Text style={s.action}>{item.path.replace('/','').replace('-',' ').toUpperCase()}</Text><Text style={[s.status,{color:colors[item.status]||'#66757d'}]}>{item.status.toUpperCase()}</Text></View><Text style={s.detail}>{response.trackingBarcode||JSON.parse(item.body).trackingBarcode||'Saved yard action'}</Text>{item.error&&<Text style={s.error}>{item.error}</Text>}<Text style={s.time}>{new Date(item.created_at.replace(' ','T')+'Z').toLocaleString()}</Text>{item.status==='failed'&&<Pressable onPress={()=>remove(item.id)} style={s.remove}><Text style={s.removeText}>REMOVE FAILED ACTION</Text></Pressable>}</View>}}/>
  <Pressable onPress={clear} style={s.clear}><Text style={s.clearText}>CLEAR CONFIRMED</Text></Pressable>
 </View>;
}
const s=StyleSheet.create({page:{flex:1,padding:18,backgroundColor:'#f4f6f8',gap:12},title:{fontSize:25,fontWeight:'900',color:'#16232d'},sub:{fontSize:16,color:'#53616b'},sync:{height:60,borderRadius:13,backgroundColor:'#1672b8',alignItems:'center',justifyContent:'center'},syncText:{fontSize:20,fontWeight:'900',color:'white'},disabled:{opacity:.45},list:{gap:10,paddingVertical:8,flexGrow:1},card:{padding:15,borderRadius:13,backgroundColor:'white',gap:7},line:{flexDirection:'row',justifyContent:'space-between'},action:{fontSize:13,fontWeight:'900',color:'#24333c'},status:{fontSize:12,fontWeight:'900'},detail:{fontSize:15,color:'#52616a'},error:{fontSize:13,color:'#b63833'},time:{fontSize:11,color:'#849199'},remove:{alignSelf:'flex-start',paddingVertical:7,paddingHorizontal:10,borderRadius:7,backgroundColor:'#fae9e8'},removeText:{fontWeight:'900',fontSize:11,color:'#a73731'},empty:{padding:30,textAlign:'center',color:'#66757d'},clear:{height:52,borderWidth:1,borderColor:'#87949a',borderRadius:12,alignItems:'center',justifyContent:'center'},clearText:{fontSize:15,fontWeight:'900',color:'#53616b'}});
