import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { Card, MetaText, PrimaryButton, ScreenTitle } from '../components/ui';
import { colors, spacing } from '../theme/tokens';

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const token = params.token ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!token) return;
    if (password !== confirm) return setError('Passwords do not match');
    if (password.length < 8) return setError('Password must be at least 8 characters');

    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      router.replace('/login');
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Invalid or expired reset link. Request a new one.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <MetaText>Secure reset</MetaText>
        <ScreenTitle>Set a new password</ScreenTitle>
        <MetaText>Choose a strong password and get back into your account.</MetaText>
      </View>

      <Card>
        {!token ? (
          <>
            <Text style={styles.error}>Invalid or missing reset token.</Text>
            <TouchableOpacity onPress={() => router.replace('/forgot-password')}>
              <Text style={styles.link}>Request a new reset link</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="New password" placeholderTextColor={colors.textMuted} style={styles.input} />
            <TextInput value={confirm} onChangeText={setConfirm} secureTextEntry placeholder="Confirm password" placeholderTextColor={colors.textMuted} style={styles.input} />
            {confirm && password !== confirm ? <Text style={styles.error}>Passwords do not match</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton label={busy ? 'Updating...' : 'Update password'} onPress={() => void submit()} disabled={busy || password !== confirm || password.length < 8} />
          </>
        )}
      </Card>

      <TouchableOpacity onPress={() => router.replace('/login')}>
        <Text style={styles.link}>Back to login</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.screen },
  hero: { borderWidth: 1, borderColor: '#ffffff1a', borderRadius: 18, backgroundColor: '#111827', padding: 14, marginBottom: 8 },
  input: { backgroundColor: colors.panelSoft, color: colors.text, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8 },
  error: { color: '#fca5a5', marginTop: 8 },
  link: { marginTop: 10, color: '#7dd3fc', fontWeight: '600' },
});
