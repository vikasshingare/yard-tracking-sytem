import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Container, MapPin, ChevronRight, PackageOpen } from 'lucide-react-native';
import api, { errorMessage } from '../api';

const PAGE_SIZE = 15;
export default function InventoryScreen({ navigation }) {
  const [rows, setRows] = useState([]); const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0); const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try { const { data } = await api.get('/inventory', { params: { page, limit: PAGE_SIZE } }); setRows(data.rows); setTotal(data.total); }
    catch (error) { Alert.alert('Inventory unavailable', errorMessage(error)); }
    finally { setRefreshing(false); }
  }, [page]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return <View style={styles.page}>
    <View style={styles.hero}><View style={styles.heroIcon}><PackageOpen color="white" size={23}/></View><View><Text style={styles.heroTitle}>YARD INVENTORY</Text><Text style={styles.heroSubtitle}>{total} containers currently inside</Text></View></View>
    <FlatList data={rows} keyExtractor={(item)=>String(item.id)} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load}/>} contentContainerStyle={styles.list}
      ListEmptyComponent={!refreshing&&<View style={styles.empty}><Container color="#89979f" size={32}/><Text style={styles.emptyText}>No containers in the yard</Text></View>}
      renderItem={({item,index})=><Pressable style={styles.card} onPress={()=>navigation.navigate('ContainerDetails',{containerId:item.id})}>
        <View style={styles.index}><Text style={styles.indexText}>{(page-1)*PAGE_SIZE+index+1}</Text></View><View style={styles.cardMain}>
          <Text style={styles.barcode}>{item.originalBarcode}</Text><Text style={styles.tracking}>{item.trackingBarcode}</Text>
          <View style={styles.location}><MapPin size={14} color="#26794a"/><Text style={styles.locationText}>{item.locationName||'Location not assigned'}</Text></View>
        </View><ChevronRight size={19} color="#8b989e"/>
      </Pressable>}/>
    <View style={styles.pager}><Text style={styles.pageText}>{total?`${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,total)} of ${total}`:'0 records'}</Text><View style={styles.pageButtons}>
      <Pressable disabled={page<=1} onPress={()=>setPage(p=>p-1)} style={[styles.pageButton,page<=1&&styles.disabled]}><Text style={styles.buttonText}>‹</Text></Pressable>
      <Text style={styles.pageText}>Page {page}/{pageCount}</Text><Pressable disabled={page>=pageCount} onPress={()=>setPage(p=>p+1)} style={[styles.pageButton,page>=pageCount&&styles.disabled]}><Text style={styles.buttonText}>›</Text></Pressable>
    </View></View>
  </View>;
}

const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#f4f6f8'},hero:{flexDirection:'row',alignItems:'center',gap:13,backgroundColor:'#16232d',padding:18},heroIcon:{width:44,height:44,borderRadius:13,backgroundColor:'#ffffff20',alignItems:'center',justifyContent:'center'},heroTitle:{color:'white',fontSize:18,fontWeight:'900'},heroSubtitle:{color:'#c2ccd1',fontSize:13,marginTop:3},list:{padding:14,gap:10,flexGrow:1},card:{backgroundColor:'white',borderRadius:14,padding:14,flexDirection:'row',alignItems:'center',gap:12,elevation:1},index:{width:34,height:34,borderRadius:10,backgroundColor:'#eaf4ee',alignItems:'center',justifyContent:'center'},indexText:{fontSize:12,fontWeight:'900',color:'#288451'},cardMain:{flex:1,gap:3},barcode:{fontSize:16,fontWeight:'800',color:'#1c2a33'},tracking:{fontSize:11,fontFamily:'monospace',color:'#63727a'},location:{marginTop:5,flexDirection:'row',alignItems:'center',gap:5},locationText:{fontSize:12,color:'#56666e',flexShrink:1},empty:{alignItems:'center',justifyContent:'center',padding:45,gap:12},emptyText:{fontSize:16,color:'#728087'},pager:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:12,backgroundColor:'white',borderTopWidth:1,borderColor:'#e8edef'},pageButtons:{flexDirection:'row',alignItems:'center',gap:10},pageText:{fontSize:12,color:'#66757d',fontWeight:'700'},pageButton:{width:36,height:36,borderRadius:9,backgroundColor:'#16232d',alignItems:'center',justifyContent:'center'},buttonText:{fontSize:24,color:'white',fontWeight:'800',lineHeight:27},disabled:{opacity:.35}});
