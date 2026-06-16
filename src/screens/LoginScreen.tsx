import { useEffect, useState } from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { API_BASE_URL, getApiErrorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { authenticateWithBiometrics, getBiometricAvailability, hasStoredTokensForBiometricLogin, isBiometricLoginEnabled } from '../auth/biometricAuth';

function GoogleMark() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <Path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <Path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <Path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </Svg>
  );
}

export default function LoginScreen() {
  const { login, refreshMe } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const decodedReturnTo = returnTo ? decodeURIComponent(returnTo) : undefined;
  const hideClubCta = decodedReturnTo === '/create-club';
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
      router.replace(returnTo ? decodeURIComponent(returnTo) : '/competitions');
    } catch (e: any) {
      setError(getApiErrorMessage(e, 'Biometric sign in failed. Use email and password.'));
    } finally {
      setBiometricBusy(false);
    }
  };

  const onLogin = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      router.replace(returnTo ? decodeURIComponent(returnTo) : '/competitions');
    } catch (e: any) {
      setError(getApiErrorMessage(e, 'Login failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleLogin = async () => {
    setError(null);
    const baseUrl = API_BASE_URL.replace(/\/+$|\s+$/g, '');
    const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
    try {
      await Linking.openURL(`${baseUrl}/oauth2/mobile/google${query}`);
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
          <View style={styles.socialDivider}>
            <View style={styles.socialDividerLine} />
            <Text style={styles.socialDividerText}>or Sign in with</Text>
            <View style={styles.socialDividerLine} />
          </View>
          <TouchableOpacity onPress={onGoogleLogin} activeOpacity={0.88} style={styles.socialButton}>
            <GoogleMark />
            <Text style={styles.socialButtonText}>Sign in with Google</Text>
            <Ionicons name="arrow-forward" size={17} color="#7dd3fc" />
          </TouchableOpacity>
        </View>

        <View style={styles.signupRow}>
          <Text style={styles.signupText}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/signup')}><Text style={styles.signupLink}>Sign up</Text></TouchableOpacity>
        </View>

        {!hideClubCta ? (
          <View style={styles.clubCtaCard}>
            <View style={styles.clubCtaPill}><Text style={styles.clubCtaPillText}>Running a club?</Text></View>
            <Text style={styles.clubCtaTitle}>Create your club</Text>
            <Text style={styles.clubCtaText}>Use your existing account to create a club, launch competitions, invite members, and manage payments from one admin area.</Text>
            <TouchableOpacity onPress={() => router.push('/create-club')} style={styles.clubCtaButton}>
              <Text style={styles.clubCtaButtonText}>Create club</Text>
              <Ionicons name="arrow-forward" size={17} color="#e0f2fe" />
            </TouchableOpacity>
          </View>
        ) : null}

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
  socialCard: { borderWidth: 1, borderColor: '#ffffff1f', borderRadius: 22, backgroundColor: '#0c1629', padding: 18, gap: 13 },
  socialDivider: { flexDirection: 'row', alignItems: 'center' },
  socialDividerLine: { flex: 1, height: 1, backgroundColor: '#374151' },
  socialDividerText: { flexShrink: 0, color: '#6b7280', fontSize: 12, fontWeight: '700', marginHorizontal: 12 },
  socialButton: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#ffffff1f',
    borderRadius: 12,
    backgroundColor: '#172033e8',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  socialButtonText: { color: '#f3f4f6', fontSize: 14, fontWeight: '900', textAlign: 'center', letterSpacing: -0.1 },
  clubCtaCard: { borderWidth: 1, borderColor: '#7dd3fc55', borderRadius: 22, backgroundColor: '#0f2538', padding: 18, gap: 10 },
  clubCtaPill: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#7dd3fc55', backgroundColor: '#0ea5e922', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  clubCtaPillText: { color: '#bae6fd', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  clubCtaTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900', letterSpacing: -0.2 },
  clubCtaText: { color: '#cbd5e1', fontSize: 13, lineHeight: 20 },
  clubCtaButton: { marginTop: 2, borderWidth: 1, borderColor: '#7dd3fc66', backgroundColor: '#0ea5e933', borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  clubCtaButtonText: { color: '#e0f2fe', fontSize: 14, fontWeight: '900' },
  clubCtaBackButton: { borderRadius: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff12', backgroundColor: '#ffffff08', marginTop: 10 },
  clubCtaBackButtonText: { color: '#dbeafe', fontSize: 13, fontWeight: '800' },
  signupRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  signupText: { color: '#94a3b8', fontSize: 13 },
  signupLink: { color: '#38bdf8', fontSize: 13, fontWeight: '800' },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 9, paddingVertical: 4 },
  footerLinkItem: { paddingVertical: 4, paddingHorizontal: 2 },
  footerLinkText: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  footerSeparator: { color: '#475569', fontSize: 12, fontWeight: '900' },
  error: { color: '#fca5a5', fontSize: 12, fontWeight: '600' },
});
