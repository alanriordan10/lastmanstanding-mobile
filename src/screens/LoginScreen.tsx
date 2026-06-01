import { useEffect, useState } from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { API_BASE_URL } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { authenticateWithBiometrics, getBiometricAvailability, hasStoredTokensForBiometricLogin, isBiometricLoginEnabled } from '../auth/biometricAuth';

export default function LoginScreen() {
  const { login, refreshMe } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Biometrics');
  const [showBiometricLogin, setShowBiometricLogin] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);

  useEffect(() => {
    const loadBiometricState = async () => {
      const [availability, enabled, hasTokens] = await Promise.all([
        getBiometricAvailability(),
        isBiometricLoginEnabled(),
        hasStoredTokensForBiometricLogin(),
      ]);
      setBiometricAvailable(availability.available);
      setBiometricLabel(availability.label);
      setShowBiometricLogin(availability.available && enabled && hasTokens);
    };
    void loadBiometricState();
  }, []);

  const onBiometricLogin = async () => {
    setBiometricBusy(true);
    setError(null);
    try {
      const ok = await authenticateWithBiometrics('Sign in');
      if (!ok) return;
      await refreshMe();
      router.replace('/competitions');
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Biometric sign in failed. Use email and password.');
    } finally {
      setBiometricBusy(false);
    }
  };

  const onLogin = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      router.replace('/competitions');
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleLogin = async () => {
    setError(null);
    const baseUrl = API_BASE_URL.replace(/\/+$|\s+$/g, '');
    try {
      await Linking.openURL(`${baseUrl}/oauth2/mobile/google`);
    } catch {
      setError('Could not open Google sign in.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.kicker}><Text style={styles.kickerText}>Member access</Text></View>
          <View style={styles.logoWrap}>
            <Image source={require('../../assets/app-logo.png')} style={styles.logo} />
          </View>
          <Text style={styles.heroTitle}>Welcome Back</Text>
          <Text style={styles.heroSub}>Sign in to manage your picks, review results, and stay ahead of the next lock.</Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}><Text style={styles.heroStatValue}>Live</Text><Text style={styles.heroStatLabel}>Picks</Text></View>
            <View style={styles.heroStat}><Text style={styles.heroStatValue}>Fast</Text><Text style={styles.heroStatLabel}>Results</Text></View>
            <View style={styles.heroStat}><Text style={styles.heroStatValue}>Ready</Text><Text style={styles.heroStatLabel}>Alerts</Text></View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" style={styles.input} placeholderTextColor="#94a3b8" />
          <View style={styles.passwordLabelRow}>
            <Text style={styles.label}>Password</Text>
            <TouchableOpacity onPress={() => router.push('/forgot-password')}><Text style={styles.forgotLink}>Forgot password?</Text></TouchableOpacity>
          </View>
          <View style={styles.passwordWrap}>
            <TextInput value={password} onChangeText={setPassword} secureTextEntry={!showPassword} placeholder="••••••••" style={[styles.input, styles.passwordInput]} placeholderTextColor="#94a3b8" />
            <TouchableOpacity onPress={() => setShowPassword((value) => !value)} style={styles.showButton}>
              <Text style={styles.showButtonText}>{showPassword ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity onPress={onLogin} disabled={submitting} style={[styles.primaryBtn, submitting ? styles.primaryBtnDisabled : null]}>
            <Text style={styles.primaryBtnText}>{submitting ? 'Signing in...' : 'Sign In'}</Text>
          </TouchableOpacity>

          {showBiometricLogin ? (
            <TouchableOpacity onPress={() => void onBiometricLogin()} disabled={biometricBusy || !biometricAvailable} style={styles.biometricBtn}>
              <Ionicons name="finger-print" size={18} color="#7dd3fc" />
              <Text style={styles.biometricBtnText}>{biometricBusy ? 'Checking...' : `Sign in with ${biometricLabel}`}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.socialCard}>
          <TouchableOpacity onPress={onGoogleLogin} activeOpacity={0.88} style={styles.socialButton}>
            <View style={styles.googleIconWrap}>
              <FontAwesome name="google" size={17} color="#4285F4" />
            </View>
            <Text style={styles.socialButtonText}>Continue with Google</Text>
            <View style={styles.socialArrowWrap}>
              <Ionicons name="arrow-forward" size={18} color="#e2e8f0" />
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.signupRow}>
          <Text style={styles.signupText}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/signup')}><Text style={styles.signupLink}>Sign up</Text></TouchableOpacity>
        </View>

        <View style={styles.clubCtaCard}>
          <View style={styles.clubCtaPill}><Text style={styles.clubCtaPillText}>Running a club?</Text></View>
          <Text style={styles.clubCtaTitle}>Create a club account</Text>
          <Text style={styles.clubCtaText}>Set up your club, create competitions, invite members, and manage payments from one admin area.</Text>
          <TouchableOpacity onPress={() => router.push('/register-club')} style={styles.clubCtaButton}>
            <Text style={styles.clubCtaButtonText}>Start a club</Text>
            <Ionicons name="arrow-forward" size={17} color="#e0f2fe" />
          </TouchableOpacity>
        </View>

        <View style={styles.footerLinks}>
          <TouchableOpacity onPress={() => router.push('/faq')} style={styles.footerLinkItem}>
            <Text style={styles.footerLinkText}>FAQ</Text>
          </TouchableOpacity>
          <Text style={styles.footerSeparator}>•</Text>
          <TouchableOpacity onPress={() => router.push('/contact')} style={styles.footerLinkItem}>
            <Text style={styles.footerLinkText}>Contact</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b1220' },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, gap: 14 },
  hero: {
    borderWidth: 1,
    borderColor: '#ffffff14',
    borderRadius: 28,
    backgroundColor: '#0f172a',
    paddingHorizontal: 20,
    paddingVertical: 24,
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
  logoWrap: { marginTop: 22, width: 80, height: 80, borderRadius: 24, overflow: 'hidden', backgroundColor: '#020617' },
  logo: { width: '100%', height: '100%' },
  heroTitle: { color: '#f8fafc', fontSize: 36, fontWeight: '900', marginTop: 22 },
  heroSub: { color: '#cbd5e1', fontSize: 14, lineHeight: 22, marginTop: 8 },
  heroStats: { flexDirection: 'row', gap: 10, marginTop: 24 },
  heroStat: { flex: 1, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 16, paddingVertical: 11, alignItems: 'center' },
  heroStatValue: { color: '#f8fafc', fontSize: 17, fontWeight: '900' },
  heroStatLabel: { color: '#94a3b8', fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.1, marginTop: 3 },
  card: {
    borderWidth: 1,
    borderColor: '#ffffff1f',
    borderRadius: 22,
    backgroundColor: '#0f172a',
    padding: 18,
    gap: 8,
  },
  label: { color: '#d1d5db', fontSize: 13, fontWeight: '700', marginBottom: 2 },
  input: {
    backgroundColor: '#111827',
    color: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  passwordLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  forgotLink: { color: '#38bdf8', fontSize: 12, fontWeight: '700' },
  passwordWrap: { position: 'relative' },
  passwordInput: { paddingRight: 64 },
  showButton: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },
  showButtonText: { color: '#94a3b8', fontSize: 12, fontWeight: '800' },
  primaryBtn: { backgroundColor: '#0284c7', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  biometricBtn: { borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e91a', borderRadius: 10, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  biometricBtnText: { color: '#7dd3fc', fontWeight: '900', fontSize: 13 },
  socialCard: { borderWidth: 1, borderColor: '#ffffff1f', borderRadius: 22, backgroundColor: '#0f172a', padding: 18 },
  socialButton: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#ffffff1f',
    borderRadius: 12,
    backgroundColor: '#ffffff08',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  googleIconWrap: { width: 28, height: 28, borderRadius: 999, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  socialButtonText: { flex: 1, color: '#e2e8f0', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  socialArrowWrap: { width: 28, height: 28, borderRadius: 999, backgroundColor: '#ffffff12', alignItems: 'center', justifyContent: 'center' },
  clubCtaCard: { borderWidth: 1, borderColor: '#7dd3fc55', borderRadius: 22, backgroundColor: '#0f2538', padding: 18, gap: 10 },
  clubCtaPill: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#7dd3fc55', backgroundColor: '#0ea5e922', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  clubCtaPillText: { color: '#bae6fd', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  clubCtaTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900', letterSpacing: -0.2 },
  clubCtaText: { color: '#cbd5e1', fontSize: 13, lineHeight: 20 },
  clubCtaButton: { marginTop: 2, borderWidth: 1, borderColor: '#7dd3fc66', backgroundColor: '#0ea5e933', borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  clubCtaButtonText: { color: '#e0f2fe', fontSize: 14, fontWeight: '900' },
  signupRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  signupText: { color: '#94a3b8', fontSize: 13 },
  signupLink: { color: '#38bdf8', fontSize: 13, fontWeight: '800' },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 9, paddingVertical: 4 },
  footerLinkItem: { paddingVertical: 4, paddingHorizontal: 2 },
  footerLinkText: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  footerSeparator: { color: '#475569', fontSize: 12, fontWeight: '900' },
  error: { color: '#fca5a5', fontSize: 12, fontWeight: '600' },
});
