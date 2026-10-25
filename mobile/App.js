import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Network from 'expo-network';
import { NavigationContainer } from '@react-navigation/native';
import { createDrawerNavigator, DrawerContentScrollView, DrawerItemList } from '@react-navigation/drawer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import GateInScreen from './src/screens/GateInScreen';
import PutAwayMoveScreen from './src/screens/PutAwayMoveScreen';
import GateOutScreen from './src/screens/GateOutScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ContainerDetailsScreen from './src/screens/ContainerDetailsScreen';
import LoginScreen from './src/screens/LoginScreen';
import SyncStatusScreen from './src/screens/SyncStatusScreen';
import TrackScreen from './src/screens/TrackScreen';
import {listQueued,syncQueued} from './src/offlineQueue';

const Drawer = createDrawerNavigator();
const ROLE_LABELS = { yard_operator: 'Yard operator', gate_operator: 'Gate operator', shipment_operator: 'Shipment operator', supervisor: 'Supervisor', viewer: 'Viewer', admin: 'Administrator' };

function YardDrawerContent({ user, onLogout, ...props }) {
  return <View style={styles.drawer}>
    <DrawerContentScrollView {...props} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={styles.brand}><View style={styles.brandIcon}><Text style={styles.brandEmoji}>🚚</Text></View><Text style={styles.brandTitle}>YARD TRACKER</Text><Text style={styles.brandSub}>OPERATIONS MENU</Text></View>
      <View style={styles.userCard}><Text style={styles.userName}>{user.displayName || user.name}</Text><Text style={styles.userRole}>{ROLE_LABELS[user.role] || user.role}</Text></View>
      <Text style={styles.menuLabel}>YARD</Text>
      <DrawerItemList {...props}/>
    </DrawerContentScrollView>
    <Pressable style={styles.logout} onPress={onLogout}><Text style={styles.logoutText}>↪   SIGN OUT</Text></Pressable>
  </View>;
}

export default function App() {
  const [session, setSession] = useState(null); const [loading, setLoading] = useState(true);const [pendingCount,setPendingCount]=useState(0);
  useEffect(() => {
    Promise.all([AsyncStorage.getItem('yard_user'),SecureStore.getItemAsync('yard_token')]).then(async([raw,token])=>{if(raw&&token)setSession({user:JSON.parse(raw),token});else{const legacy=await AsyncStorage.getItem('yard_session');if(legacy){const data=JSON.parse(legacy);await SecureStore.setItemAsync('yard_token',data.token);await AsyncStorage.setItem('yard_user',JSON.stringify(data.user));await AsyncStorage.removeItem('yard_session');setSession(data);}else setSession(null);}})
      .catch(() => setSession(null)).finally(() => setLoading(false));
  }, []);
  useEffect(()=>{let active=true;const refresh=async()=>{try{const items=await listQueued();if(active)setPendingCount(items.filter(x=>['pending','failed','syncing'].includes(x.status)).length);}catch{}};refresh();const sub=Network.addNetworkStateListener(async state=>{if(state.isConnected){try{await syncQueued();}finally{refresh();}}});return()=>{active=false;sub.remove();};},[]);
  const logout = async () => { await SecureStore.deleteItemAsync('yard_token');await AsyncStorage.removeItem('yard_user');await AsyncStorage.removeItem('yard_session'); setSession(null); };
  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color="#16834a"/></View>;
  if (!session) return <SafeAreaProvider><LoginScreen onSignedIn={setSession}/></SafeAreaProvider>;
  const user = session.user;
  const isGate = ['gate_operator', 'supervisor', 'admin'].includes(user.role);
  const isYard = ['yard_operator', 'supervisor', 'admin'].includes(user.role);
  const firstRoute = isGate ? 'Entry' : isYard ? 'StoreMove' : 'Inventory';

  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><NavigationContainer key={user.id}>
    <Drawer.Navigator initialRouteName={firstRoute} drawerContent={(props)=><YardDrawerContent {...props} user={user} onLogout={logout}/>} screenOptions={{
      headerStyle:{backgroundColor:'#16232d'},headerTintColor:'#fff',headerTitleStyle:{fontWeight:'900',fontSize:18},
      drawerActiveBackgroundColor:'#e6f5ec',drawerActiveTintColor:'#187747',drawerInactiveTintColor:'#3d4d56',
      drawerLabelStyle:{fontSize:14,fontWeight:'800'},drawerItemStyle:{borderRadius:10,marginHorizontal:10},
    }}>
      {isGate&&<Drawer.Screen name="Entry" component={GateInScreen} options={{title:'🟢  GATE IN',drawerLabel:'🟢  Gate In'}}/>}
      {isYard&&<Drawer.Screen name="StoreMove" component={PutAwayMoveScreen} options={{title:'🔵  STORE / MOVE',drawerLabel:'🔵  Store / Move'}}/>}
      {isGate&&<Drawer.Screen name="Exit" component={GateOutScreen} options={{title:'🔴  GATE OUT',drawerLabel:'🔴  Gate Out'}}/>}
      {['shipment_operator','supervisor','admin'].includes(user.role)&&<Drawer.Screen name="Shipments" component={require('./src/screens/ShipmentsScreen').default} options={{title:'🚛  SHIPMENTS',drawerLabel:'🚛  Shipments'}}/>}
      <Drawer.Screen name="SyncStatus" component={SyncStatusScreen} options={{title:`🔄  SYNC STATUS${pendingCount?` (${pendingCount})`:''}`,drawerLabel:`🔄  Sync status${pendingCount?` · ${pendingCount}`:''}`}}/>
      <Drawer.Screen name="Inventory" component={InventoryScreen} options={{title:'📦  INVENTORY',drawerLabel:'📦  Inventory'}}/>
      <Drawer.Screen name="Track" component={TrackScreen} options={{title:'🔎  FIND CONTAINER',drawerLabel:'🔎  Find container'}}/>
      <Drawer.Screen name="History" component={HistoryScreen} options={{title:'🕘  HISTORY',drawerLabel:'🕘  History'}}/>
      <Drawer.Screen name="ContainerDetails" component={ContainerDetailsScreen} options={{title:'CONTAINER DETAILS',drawerItemStyle:{display:'none'}}}/>
    </Drawer.Navigator>
  </NavigationContainer></SafeAreaProvider></GestureHandlerRootView>;
}

const styles=StyleSheet.create({loading:{flex:1,justifyContent:'center',alignItems:'center'},drawer:{flex:1},brand:{padding:20,paddingTop:22,backgroundColor:'#16232d',marginBottom:14},brandIcon:{width:45,height:45,borderRadius:14,backgroundColor:'#ffffff20',alignItems:'center',justifyContent:'center'},brandEmoji:{fontSize:23},brandTitle:{fontSize:18,fontWeight:'900',color:'white',marginTop:12},brandSub:{fontSize:10,letterSpacing:1.4,fontWeight:'800',color:'#a8b7bf',marginTop:3},userCard:{marginHorizontal:15,marginBottom:13,padding:13,borderRadius:12,backgroundColor:'#f2f6f4'},userName:{fontSize:14,fontWeight:'900',color:'#20313a'},userRole:{fontSize:11,color:'#6a7b81',marginTop:3},menuLabel:{fontSize:10,fontWeight:'900',letterSpacing:1.2,color:'#8b989d',marginHorizontal:24,marginBottom:5},logout:{height:58,borderTopWidth:1,borderColor:'#e6ebed',justifyContent:'center',paddingHorizontal:24},logoutText:{fontSize:14,fontWeight:'900',color:'#b43b37'}});
