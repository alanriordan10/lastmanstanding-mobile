import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';

type CheckState = 'idle' | 'checking' | 'available' | 'taken' | 'error';

export default function SignupScreen() {
  const { signup } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [emailStatus, setEmailStatus] = useState<CheckState>('idle');
  const [emailMessage, setEmailMessage] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<CheckState>('idle');
  const [usernameMessage, setUsernameMessage] = useState('');

  const checkEmailAvailability = async () => {
    const normalized = email.trim();
    if (!normalized) {
      setEmailStatus('idle');
      setEmailMessage('');
      return true;
    }
    setEmailStatus('checking');
    try {
      const { data } = await api.get<{ available: boolean; message: string }>('/auth/email-availability', { params: { email: normalized } });
      setEmailStatus(data.available ? 'available' : 'taken');
      setEmailMessage(data.message);
      return data.available;
    } catch (e: any) {
      setEmailStatus('error');
      setEmailMessage(e?.response?.data?.message ?? 'Could not verify email');
      return false;
    }
  };

  const checkUsernameAvailability = async () => {
    const normalized = username.trim();
    if (/\s/.test(normalized)) {
      setUsernameStatus('error');
      setUsernameMessage('Username cannot contain spaces');
      return false;
    }
    if (normalized.length < 3) {
      setUsernameStatus('idle');
      setUsernameMessage('');
      return true;
    }
    setUsernameStatus('checking');
    try {
      const { data } = await api.get<{ available: boolean; message: string }>('/auth/username-availability', { params: { username: normalized } });
      setUsernameStatus(data.available ? 'available' : 'taken');
      setUsernameMessage(data.message);
      return data.available;
    } catch (e: any) {
      setUsernameStatus('error');
      setUsernameMessage(e?.response?.data?.message ?? 'Could not verify username');
      return false;
    }
  };

  useEffect(() => {
    const normalized = username.trim();
    if (!normalized || normalized.length < 3) {
      setUsernameStatus('idle');
      setUsernameMessage('');
      return;
    }
    if (/\s/.test(normalized)) {
      setUsernameStatus('error');
      setUsernameMessage('Username cannot contain spaces');
      return;
    }

    let cancelled = false;
    setUsernameStatus('checking');
    setUsernameMessage('');

    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get<{ available: boolean; message: string }>('/auth/username-availability', { params: { username: normalized } });
        if (cancelled) return;
        setUsernameStatus(data.available ? 'available' : 'taken');
        setUsernameMessage(data.message);
      } catch (e: any) {
        if (cancelled) return;
        setUsernameStatus('error');
        setUsernameMessage(e?.response?.data?.message ?? 'Could not verify username');
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username]);

  const onSignup = async () => {
    setError(null);
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirmPassword) return setError('Passwords do not match');

    setSubmitting(true);
    try {
      const emailOk = await checkEmailAvailability();
      const usernameOk = await checkUsernameAvailability();
      if (!emailOk || !usernameOk) {
        setSubmitting(false);
        return;
      }
      await signup(email.trim(), username.trim(), password);
      router.replace('/competitions');
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Signup failed');
    } finally {
      setSubmitting(false);
    }
  };

  const statusStyle = (status: CheckState) => {
    if (status === 'available') return styles.ok;
    if (status === 'checking') return styles.neutralInfo;
    return styles.warn;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.kicker}><Text style={styles.kickerText}>Player Signup</Text></View>
          <Text style={styles.heroTitle}>Create Account</Text>
          <Text style={styles.heroSub}>Join competitions, make weekly picks, and track your survival run.</Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}><Text style={styles.heroStatValue}>Fast</Text><Text style={styles.heroStatLabel}>Join</Text></View>
            <View style={styles.heroStat}><Text style={styles.heroStatValue}>Live</Text><Text style={styles.heroStatLabel}>Play</Text></View>
            <View style={styles.heroStat}><Text style={styles.heroStatValue}>Weekly</Text><Text style={styles.heroStatLabel}>Compete</Text></View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.formTitle}>Create Your Account</Text>
          <TextInput
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setEmailStatus('idle');
              setEmailMessage('');
            }}
            onBlur={() => {
              void checkEmailAvailability();
            }}
            autoCapitalize="none"
            placeholder="Email"
            style={styles.input}
            placeholderTextColor="#94a3b8"
          />
          {emailStatus !== 'idle' ? <Text style={statusStyle(emailStatus)}>{emailStatus === 'checking' ? 'Checking email...' : emailMessage}</Text> : null}

          <TextInput
            value={username}
            onChangeText={(v) => {
              setUsername(v.replace(/\s+/g, ''));
              setUsernameStatus('idle');
              setUsernameMessage('');
            }}
            onBlur={() => {
              void checkUsernameAvailability();
            }}
            autoCapitalize="none"
            placeholder="Username"
            style={styles.input}
            placeholderTextColor="#94a3b8"
          />
          {usernameStatus !== 'idle' ? <Text style={statusStyle(usernameStatus)}>{usernameStatus === 'checking' ? 'Checking username...' : usernameMessage}</Text> : null}

          <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Password (min 8 chars)" style={styles.input} placeholderTextColor="#94a3b8" />
          <TextInput value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry placeholder="Confirm password" style={styles.input} placeholderTextColor="#94a3b8" />

          {error ? <Text style={styles.warn}>{error}</Text> : null}

          <TouchableOpacity onPress={onSignup} disabled={submitting} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>{submitting ? 'Creating account...' : 'Create account'}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/login')}>
            <Text style={styles.link}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b1220' },
  content: { padding: 16, paddingBottom: 28, gap: 14 },
  hero: {
    borderWidth: 1,
    borderColor: '#ffffff18',
    borderRadius: 24,
    backgroundColor: '#111827',
    padding: 16,
  },
  kicker: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#0ea5e955',
    backgroundColor: '#0ea5e922',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  kickerText: { color: '#7dd3fc', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.9 },
  heroTitle: { color: '#fff', fontSize: 30, fontWeight: '900', marginTop: 10 },
  heroSub: { color: '#cbd5e1', fontSize: 13, lineHeight: 19, marginTop: 6 },
  heroStats: { flexDirection: 'row', gap: 8, marginTop: 12 },
  heroStat: { flex: 1, borderWidth: 1, borderColor: '#ffffff18', backgroundColor: '#ffffff08', borderRadius: 12, paddingVertical: 8, alignItems: 'center' },
  heroStatValue: { color: '#e0f2fe', fontSize: 13, fontWeight: '800' },
  heroStatLabel: { color: '#94a3b8', fontSize: 10, textTransform: 'uppercase', marginTop: 2 },
  card: {
    borderWidth: 1,
    borderColor: '#253247',
    borderRadius: 18,
    backgroundColor: '#111827',
    padding: 14,
    gap: 10,
  },
  formTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 2 },
  input: {
    backgroundColor: '#1f2937',
    color: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  primaryBtn: { backgroundColor: '#0284c7', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 2 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  link: { color: '#7dd3fc', fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  ok: { color: '#86efac', fontSize: 12, fontWeight: '600' },
  warn: { color: '#fca5a5', fontSize: 12, fontWeight: '600' },
  neutralInfo: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
});
