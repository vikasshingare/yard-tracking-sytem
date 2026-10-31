import React, { useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import TextRecognition from '@react-native-ml-kit/text-recognition';

const ALL_BARCODE_TYPES = ['qr', 'code128', 'code39', 'ean13', 'ean8', 'upc_a', 'upc_e', 'pdf417', 'datamatrix'];

export function findContainerNumber(ocrText) {
  const compact = String(ocrText || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const digitFixes = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', Z: '2', S: '5', G: '6', B: '8' };

  for (let index = 0; index <= compact.length - 11; index += 1) {
    const ownerCode = compact.slice(index, index + 4);
    if (!/^[A-Z]{4}$/.test(ownerCode)) continue;
    const serial = compact.slice(index + 4, index + 11);
    const normalizedSerial = serial.replace(/[A-Z|]/g, (character) => digitFixes[character] || character);
    if (/^\d{7}$/.test(normalizedSerial)) return `${ownerCode}${normalizedSerial}`;
  }
  return null;
}

export default function BarcodeScanner({
  onScan,
  label = 'SCAN BARCODE',
  barcodeTypes = ALL_BARCODE_TYPES,
  allowPhotoCapture = false,
  allowContainerPhoto = false,
  onTextRecognized,
  onPhotoCaptured,
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraMode, setCameraMode] = useState(null);
  const [showOptions, setShowOptions] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const cameraRef = useRef(null);

  async function readContainerPhoto() {
    if (capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.9, skipProcessing: false });
      if (!photo?.uri) throw new Error('The camera could not capture the image. Try again.');
      if (cameraMode === 'container-photo') {
        setCameraMode(null);
        onPhotoCaptured?.(photo.uri);
        Alert.alert('PHOTO CAPTURED', 'Container photo will be attached to the Gate Entry.');
        return;
      }
      const recognized = await TextRecognition.recognize(photo.uri);
      const containerNumber = findContainerNumber(recognized?.text);
      setCameraMode(null);
      if (!containerNumber) {
        Alert.alert('Container number not found', 'Move closer to the printed number, keep the camera steady, or enter the number manually.');
        return;
      }
      onTextRecognized?.(containerNumber, recognized?.text || '');
      Alert.alert('NUMBER READ', `${containerNumber}\nCheck it before saving the entry.`);
    } catch (error) {
      setCameraMode(null);
      Alert.alert('Could not read photo', error?.message || 'Try another photo or enter the number manually.');
    } finally {
      setCapturing(false);
    }
  }

  if (!permission) return <Text style={styles.note}>Checking camera…</Text>;
  if (!permission.granted) return (
    <Pressable style={styles.button} onPress={requestPermission} accessibilityRole="button">
      <Text style={styles.buttonText}>📷  ALLOW CAMERA</Text>
    </Pressable>
  );

  if (!cameraMode) return (
    <>
      <Pressable
        style={styles.button}
        onPress={() => (allowPhotoCapture || allowContainerPhoto) ? setShowOptions(true) : setCameraMode('scan')}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>▦  {label}</Text>
      </Pressable>
      {(allowPhotoCapture || allowContainerPhoto) && <Modal visible={showOptions} transparent animationType="fade" onRequestClose={() => setShowOptions(false)}>
        <View style={styles.optionOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowOptions(false)} accessibilityLabel="Close camera options" />
          <View style={styles.optionCard}>
            <Text style={styles.optionTitle}>READ CONTAINER NUMBER</Text>
            <Text style={styles.optionHint}>Choose how to read the container label.</Text>
            <Pressable style={styles.scanOption} onPress={() => { setShowOptions(false); setCameraMode('scan'); }}>
              <Text style={styles.optionButtonText}>▦  SCAN BARCODE</Text>
            </Pressable>
            {allowPhotoCapture && <Pressable style={styles.photoOption} onPress={() => { setShowOptions(false); setCameraMode('photo'); }}>
              <Text style={styles.optionButtonText}>📷  READ NUMBER FROM PHOTO</Text>
            </Pressable>}
            {allowContainerPhoto && <Pressable style={styles.containerPhotoOption} onPress={() => { setShowOptions(false); setCameraMode('container-photo'); }}>
              <Text style={styles.optionButtonText}>📸  TAKE CONTAINER PHOTO</Text>
            </Pressable>}
            <Pressable style={styles.dismiss} onPress={() => setShowOptions(false)}>
              <Text style={styles.dismissText}>CANCEL</Text>
            </Pressable>
          </View>
        </View>
      </Modal>}
    </>
  );

  return (
    <View style={styles.cameraWrap}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        mode="picture"
        barcodeScannerSettings={cameraMode === 'scan' ? { barcodeTypes } : undefined}
        onBarcodeScanned={cameraMode === 'scan' ? ({ data }) => {
          setCameraMode(null);
          onScan(String(data).trim());
        } : undefined}
      />
      {cameraMode === 'scan' ? (
        <Text style={styles.hint}>Point the camera at the barcode.</Text>
      ) : (
        <>
          <Text style={styles.hint}>{cameraMode === 'photo' ? 'Fill the frame with the container number.' : 'Frame the full container for the entry photo.'}</Text>
          <Pressable style={[styles.capture, capturing && styles.captureDisabled]} disabled={capturing} onPress={readContainerPhoto}>
            <Text style={styles.captureText}>{capturing ? (cameraMode === 'photo' ? 'READING PHOTO…' : 'SAVING PHOTO…') : cameraMode === 'photo' ? '●  TAKE PHOTO & READ' : '●  CAPTURE PHOTO'}</Text>
          </Pressable>
        </>
      )}
      <Pressable style={styles.cancel} onPress={() => setCameraMode(null)}><Text style={styles.cancelText}>CANCEL</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 64, backgroundColor: '#17212b', borderRadius: 14, justifyContent: 'center', alignItems: 'center', padding: 12 },
  buttonText: { color: 'white', fontSize: 20, fontWeight: '800' },
  note: { fontSize: 16, padding: 12 },
  cameraWrap: { overflow: 'hidden', borderRadius: 16, backgroundColor: '#111' },
  camera: { height: 290, width: '100%' },
  hint: { color: 'white', backgroundColor: '#17212b', textAlign: 'center', padding: 12, fontSize: 16, fontWeight: '700' },
  cancel: { minHeight: 52, justifyContent: 'center', backgroundColor: '#333', alignItems: 'center', padding: 12 },
  cancelText: { color: 'white', fontWeight: '800', fontSize: 16 },
  capture: { minHeight: 62, justifyContent: 'center', alignItems: 'center', backgroundColor: '#16834a' },
  captureDisabled: { opacity: 0.55 },
  captureText: { color: 'white', fontSize: 18, fontWeight: '900' },
  optionOverlay: { flex: 1, justifyContent: 'center', padding: 22, backgroundColor: 'rgba(10,18,25,0.52)' },
  optionCard: { padding: 18, gap: 12, borderRadius: 18, backgroundColor: 'white', elevation: 12 },
  optionTitle: { color: '#17212b', fontSize: 20, fontWeight: '900' },
  optionHint: { color: '#53616b', fontSize: 15, marginBottom: 3 },
  scanOption: { minHeight: 62, justifyContent: 'center', alignItems: 'center', backgroundColor: '#17212b', borderRadius: 13 },
  photoOption: { minHeight: 62, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1769AA', borderRadius: 13 },
  containerPhotoOption: { minHeight: 62, justifyContent: 'center', alignItems: 'center', backgroundColor: '#16834a', borderRadius: 13 },
  optionButtonText: { color: 'white', fontSize: 18, fontWeight: '900' },
  dismiss: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: '#EEF2F5' },
  dismissText: { color: '#17212b', fontWeight: '900', fontSize: 16 },
});
