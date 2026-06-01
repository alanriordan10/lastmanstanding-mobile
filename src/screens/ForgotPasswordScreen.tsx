import { useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { Card, MetaText, PrimaryButton, ScreenTitle } from '../components/ui';
import { colors, spacing } from '../theme/tokens';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <MetaText>Recovery</MetaText>
        <ScreenTitle>Forgot your password?</ScreenTitle>
        <MetaText>Enter your email and we will send a reset link.</MetaText>
      </View>

      <Card>
        {submitted ? (
          <>
            <Text style={styles.ok}>Check your email</Text>
            <MetaText>If an account exists for {email}, we sent a reset link. It expires in 1 hour.</MetaText>
            <TouchableOpacity onPress={() => setSubmitted(false)}>
              <Text style={styles.link}>Try again</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" placeholder="you@example.com" placeholderTextColor={colors.textMuted} style={styles.input} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton label={busy ? 'Sending...' : 'Send reset link'} onPress={() => void submit()} disabled={busy} />
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
  ok: { color: '#86efac', fontWeight: '700', marginBottom: 4 },
  link: { marginTop: 10, color: '#7dd3fc', fontWeight: '600' },
});
