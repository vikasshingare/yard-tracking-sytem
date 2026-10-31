import React, { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { Container, MapPin, Clock3, Printer, X } from 'lucide-react-native';
import Barcode from 'react-native-barcode-svg';
import api, { errorMessage } from '../api';
import { printTrackingBarcode } from '../utils/barcodePrint';

export default function ContainerDetailsScreen() {
  const { params } = useRoute();
  const [record, setRecord] = useState(null);
  const [showBarcode, setShowBarcode] = useState(false);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/containers/${params.containerId}`);
      setRecord(data);
    } catch (error) {
      Alert.alert('Record unavailable', errorMessage(error));
    }
  }, [params.containerId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function printLabel() {
    setPrinting(true);
    try {
      await printTrackingBarcode(record.trackingBarcode);
    } catch (error) {
      Alert.alert('Print unavailable', error?.message || 'Could not open the print dialog.');
    } finally {
      setPrinting(false);
    }
  }

  if (!record) return <View style={styles.center}><Text style={styles.loading}>Loading container…</Text></View>;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.summary}>
        <View style={styles.icon}><Container size={23} color="white" /></View>
        <Text style={styles.label}>ORIGINAL BARCODE</Text>
        <Text style={styles.original}>{record.originalBarcode}</Text>
        <Text style={[styles.label, styles.trackingLabel]}>TRACKING BARCODE</Text>
        <Pressable style={styles.trackingButton} onPress={() => setShowBarcode(true)} accessibilityRole="button" accessibilityLabel="Show and print tracking barcode">
          <Text selectable style={styles.tracking}>{record.trackingBarcode}</Text>
          <Text style={styles.tapHint}>TAP TO VIEW BARCODE</Text>
        </Pressable>
        <View style={[styles.status, record.status === 'in-yard' || record.status === 'reserved_for_shipment' ? styles.statusIn : styles.statusOut]}>
          <Text style={styles.statusText}>{record.status.replaceAll('_', ' ').toUpperCase()}</Text>
        </View>
        <View style={styles.currentLocation}><MapPin size={14} color="#d3dce0" /><Text style={styles.currentLocationText}>{record.locationName || 'Location not assigned'}</Text></View>
      </View>

      <View style={styles.masterCard}>
        <Text style={styles.masterTitle}>CONTAINER DETAILS</Text>
        <Text style={styles.masterLine}>SIZE / TYPE  ·  {record.sizeCode || '—'} / {record.typeCode || '—'}</Text>
        <Text style={styles.masterLine}>ISO / LINE  ·  {record.isoCode || '—'} / {record.shippingLine || '—'}</Text>
        <Text style={styles.masterLine}>SEAL / CONDITION  ·  {record.sealNumber || '—'} / {(record.conditionCode || 'unknown').replaceAll('_', ' ')}</Text>
        {record.putawayAssignedToName&&<Text style={styles.masterLine}>PUT-AWAY OPERATOR  ·  {record.putawayAssignedToName}</Text>}
        {record.shipment?.shipmentRef && <Text style={styles.masterLine}>SHIPMENT  ·  {record.shipment.shipmentRef}</Text>}
      </View>

      <View style={styles.sectionHead}>
        <View><Text style={styles.sectionTitle}>Container history</Text><Text style={styles.sectionSub}>{record.transactions.length} audit events</Text></View>
        <Clock3 color="#64747b" size={19} />
      </View>
      {record.transactions.map((event, index) => (
        <View key={event.id} style={styles.eventRow}>
          <View style={styles.timelineColumn}>
            <View style={[styles.dot, index === 0 && styles.dotLatest]} />
            {index < record.transactions.length - 1 && <View style={styles.line} />}
          </View>
          <View style={styles.eventCard}>
            <View style={styles.eventTop}><Text style={styles.action}>{event.actionType}</Text><Text style={styles.time}>{new Date(event.timestamp).toLocaleString()}</Text></View>
            {(event.fromLocation || event.toLocation) && <Text style={styles.route}>{event.fromLocation || 'Gate'}  →  {event.toLocation || 'Gate'}</Text>}
            <Text style={styles.user}>{event.userName || 'User unavailable'}{event.userRole ? ` · ${event.userRole.replace('_', ' ')}` : ''}</Text>
            {event.geoLat != null && event.geoLong != null && <Text style={styles.gps}>GPS {Number(event.geoLat).toFixed(5)}, {Number(event.geoLong).toFixed(5)}</Text>}
          </View>
        </View>
      ))}

      <Modal visible={showBarcode} transparent animationType="fade" onRequestClose={() => setShowBarcode(false)}>
        <View style={styles.barcodeOverlay}>
          <View style={styles.barcodeModal}>
            <View style={styles.barcodeModalHead}>
              <View><Text style={styles.barcodeModalTitle}>TRACKING BARCODE</Text><Text style={styles.barcodeModalSub}>Code 128 · print and attach to container</Text></View>
              <Pressable onPress={() => setShowBarcode(false)} style={styles.closeButton} accessibilityLabel="Close barcode"><X size={21} color="#17232B" /></Pressable>
            </View>
            <View style={styles.barcodeCanvas}><Barcode value={record.trackingBarcode} format="CODE128" height={96} lineColor="#111111" backgroundColor="#FFFFFF" maxWidth={330} /></View>
            <Text selectable style={styles.barcodeText}>{record.trackingBarcode}</Text>
            <Pressable disabled={printing} style={[styles.printButton, printing && styles.printDisabled]} onPress={printLabel}>
              <Printer size={20} color="white" /><Text style={styles.printButtonText}>{printing ? 'OPENING PRINT…' : 'PRINT BARCODE'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f4f6f8' },
  content: { padding: 16, paddingBottom: 30 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loading: { color: '#66757d' },
  summary: { backgroundColor: '#16232d', borderRadius: 18, padding: 20, alignItems: 'center' },
  icon: { width: 48, height: 48, borderRadius: 15, backgroundColor: '#ffffff20', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  label: { fontSize: 10, letterSpacing: 1, color: '#acbbc2', fontWeight: '800' },
  original: { fontSize: 23, color: 'white', fontWeight: '900', marginTop: 5 },
  trackingLabel: { marginTop: 14 },
  trackingButton: { alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, marginTop: 4, borderRadius: 10, backgroundColor: '#ffffff18' },
  tracking: { fontSize: 14, color: '#ffffff', fontFamily: 'monospace', fontWeight: '900' },
  tapHint: { color: '#c5d3d9', fontSize: 9, fontWeight: '900', letterSpacing: 0.8, marginTop: 5 },
  status: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, marginTop: 13 },
  statusIn: { backgroundColor: '#d9f2e3' },
  statusOut: { backgroundColor: '#e7edf0' },
  statusText: { fontSize: 10, fontWeight: '900', color: '#24363f' },
  currentLocation: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 },
  currentLocationText: { fontSize: 12, color: '#d3dce0', flexShrink: 1 },
  masterCard: { backgroundColor: 'white', borderRadius: 14, padding: 15, gap: 8, marginTop: 12 },
  masterTitle: { fontSize: 11, fontWeight: '900', color: '#75848b', letterSpacing: 1 },
  masterLine: { fontSize: 13, fontWeight: '700', color: '#34444c' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, marginBottom: 10 },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: '#1c2a33' },
  sectionSub: { fontSize: 12, color: '#7c8990', marginTop: 3 },
  eventRow: { flexDirection: 'row', gap: 10 },
  timelineColumn: { width: 15, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: '#99a8ad', backgroundColor: '#f4f6f8', marginTop: 17, zIndex: 1 },
  dotLatest: { borderColor: '#228751', backgroundColor: '#dff3e6' },
  line: { position: 'absolute', top: 24, bottom: -2, width: 1, backgroundColor: '#d3ddda' },
  eventCard: { flex: 1, backgroundColor: 'white', borderRadius: 13, padding: 13, marginBottom: 10 },
  eventTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  action: { fontSize: 14, fontWeight: '900', color: '#25343c' },
  time: { fontSize: 9, color: '#86939a' },
  route: { fontSize: 12, color: '#53646c', marginTop: 8 },
  user: { fontSize: 10, color: '#7b898f', marginTop: 8 },
  gps: { fontSize: 9, color: '#89969c', marginTop: 4 },
  barcodeOverlay: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(10,18,25,0.58)' },
  barcodeModal: { width: '100%', maxWidth: 460, alignSelf: 'center', padding: 18, borderRadius: 18, backgroundColor: 'white', elevation: 14 },
  barcodeModalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  barcodeModalTitle: { fontSize: 18, fontWeight: '900', color: '#17232b' },
  barcodeModalSub: { fontSize: 12, color: '#66757d', marginTop: 4 },
  closeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#eef2f5' },
  barcodeCanvas: { marginTop: 18, padding: 10, alignItems: 'center', backgroundColor: 'white' },
  barcodeText: { marginTop: 10, textAlign: 'center', fontFamily: 'monospace', fontSize: 16, fontWeight: '800', color: '#111' },
  printButton: { minHeight: 58, marginTop: 18, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#1769AA' },
  printButtonText: { fontSize: 17, fontWeight: '900', color: 'white' },
  printDisabled: { opacity: 0.55 },
});
