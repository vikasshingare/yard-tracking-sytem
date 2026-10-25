import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

const ALL_BARCODE_TYPES = ['qr', 'code128', 'code39', 'ean13', 'ean8', 'upc_a', 'upc_e', 'pdf417', 'datamatrix'];

export default function BarcodeScanner({ onScan, label = 'SCAN BARCODE', barcodeTypes = ALL_BARCODE_TYPES }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(false);
  const [locked, setLocked] = useState(false);

  if (!permission) return <Text style={styles.note}>Checking camera…</Text>;
  if (!permission.granted) return (
    <Pressable style={styles.button} onPress={requestPermission} accessibilityRole="button">
      <Text style={styles.buttonText}>📷  ALLOW CAMERA</Text>
    </Pressable>
  );

  if (!active) return (
    <Pressable style={styles.button} onPress={() => { setLocked(false); setActive(true); }} accessibilityRole="button">
      <Text style={styles.buttonText}>▦  {label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.cameraWrap}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes }}
        onBarcodeScanned={locked ? undefined : ({ data }) => {
          setLocked(true);
          setActive(false);
          onScan(String(data).trim());
        }}
      />
      <Text style={styles.hint}>Point camera at barcode</Text>
      <Pressable style={styles.cancel} onPress={() => setActive(false)}><Text style={styles.cancelText}>CANCEL</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 64, backgroundColor: '#17212b', borderRadius: 14, justifyContent: 'center', alignItems: 'center', padding: 12 },
  buttonText: { color: 'white', fontSize: 20, fontWeight: '800' },
  note: { fontSize: 16, padding: 12 },
  cameraWrap: { overflow: 'hidden', borderRadius: 16, backgroundColor: '#111' },
  camera: { height: 260, width: '100%' },
  hint: { color: 'white', backgroundColor: '#111', textAlign: 'center', padding: 10, fontSize: 16 },
  cancel: { backgroundColor: '#333', alignItems: 'center', padding: 12 },
  cancelText: { color: 'white', fontWeight: '800', fontSize: 16 },
});
