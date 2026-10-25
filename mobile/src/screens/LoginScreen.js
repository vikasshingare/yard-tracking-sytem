import React, { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, Text, View, StyleSheet } from 'react-native';
import { TextInput } from '../components/FormControls';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import api, { errorMessage } from '../api';

export default function LoginScreen({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  async function signIn() {
    if (!email.trim() || !password) return Alert.alert('Sign in', 'Enter your email and password.');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/login', { email: email.trim(), password });
      await SecureStore.setItemAsync('yard_token',data.token);
      await AsyncStorage.setItem('yard_user', JSON.stringify(data.user));
      onSignedIn(data);
    } catch (error) { Alert.alert('Could not sign in', errorMessage(error)); }
    finally { setBusy(false); }
  }
  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Image source={require('../../assets/stw-launch-logo.jpg')} style={styles.logo} resizeMode="contain" accessibilityLabel="STW Logistics logo" />
      <Text style={styles.title}>YARD TRACKER</Text>
      <Text style={styles.subtitle}>Sign in with your yard account</Text>
      <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" textContentType="emailAddress" />
      <TextInput style={styles.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" />
      <Pressable style={styles.button} onPress={signIn} disabled={busy}><Text style={styles.buttonText}>{busy ? 'SIGNING IN…' : 'SIGN IN'}</Text></Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: '#f4f6f8' },
  logo: { width: '100%', height: 132, alignSelf: 'center', marginBottom: 4 },
  title: { fontSize: 28, textAlign: 'center', fontWeight: '900', color: '#16232d' },
  subtitle: { fontSize: 18, textAlign: 'center', color: '#53616b', marginBottom: 12 },
  input: { backgroundColor: 'white', borderRadius: 12, paddingHorizontal: 16, minHeight: 60, fontSize: 18 },
  button: { minHeight: 66, justifyContent: 'center', alignItems: 'center', backgroundColor: '#16232d', borderRadius: 14, marginTop: 8 },
  buttonText: { color: 'white', fontSize: 20, fontWeight: '900' },
});
