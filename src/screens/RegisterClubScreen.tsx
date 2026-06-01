import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { AuthResponse } from '../types';

interface RegisterClubResponse {
  auth: AuthResponse;
  clubId: number;
  clubName: string;
}

type Step = 1 | 2;
type CheckState = 'idle' | 'checking' | 'available' | 'taken' | 'error';

type FieldErrors = Partial<Record<'clubName' | 'username' | 'email' | 'password' | 'confirmPassword' | 'form', string>>;

const adminBenefits = [
  { icon: 'trophy-outline' as const, text: 'Create unlimited Last Man Standing competitions' },
  { icon: 'cash-outline' as const, text: 'Set entry fees, rules and missed pick behaviour' },
  { icon: 'people-outline' as const, text: 'Manage participants, remove entries or declare winners' },
  { icon: 'stats-chart-outline' as const, text: 'View survivor tables and results history' },
];

export default function RegisterClubScreen() {
  const router = useRouter();
  const { loginWithData } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [clubName, setClubName] = useState('');
  const [clubDescription, setClubDescription] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [usernameStatus, setUsernameStatus] = useState<CheckState>('idle');
  const [usernameMessage, setUsernameMessage] = useState('');

  const clearFieldError = (field: keyof FieldErrors) => {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const checkUsernameAvailability = async () => {
    const normalized = username.trim();
    if (!normalized || normalized.length < 3) {
      setUsernameStatus('idle');
      setUsernameMessage('');
      return true;
    }
    if (/\s/.test(normalized)) {
      setUsernameStatus('error');
      setUsernameMessage('Username cannot contain spaces');
      return false;
    }
    setUsernameStatus('checking');
    setUsernameMessage('');
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

  const goNext = () => {
    const errors: FieldErrors = {};
    if (!clubName.trim()) errors.clubName = 'Club name is required.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setStep(2);
  };

  const onSubmit = async () => {
    const errors: FieldErrors = {};
    if (!clubName.trim()) errors.clubName = 'Club name is required.';
    if (!username.trim()) errors.username = 'Username is required.';
    else if (username.trim().length < 3) errors.username = 'Username must be at least 3 characters.';
    else if (/\s/.test(username.trim())) errors.username = 'Username cannot contain spaces.';
    if (!email.trim()) errors.email = 'Email is required.';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (!password) errors.password = 'Password is required.';
    else if (password.length < 6) errors.password = 'Password must be at least 6 characters.';
    if (!confirmPassword) errors.confirmPassword = 'Confirm password is required.';
    else if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const usernameAvailable = await checkUsernameAvailability();
    if (!usernameAvailable) {
      setFieldErrors({ username: usernameMessage || 'Username is not available.' });
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post<RegisterClubResponse>('/auth/register-club', {
        clubName: clubName.trim(),
        clubDescription: clubDescription.trim() ? clubDescription.trim() : null,
        username: username.trim(),
        email: email.trim(),
        password,
      });
      await loginWithData(data.auth);
      router.replace('/(tabs)/club-admin');
    } catch (e: any) {
      setFieldErrors({ form: e?.response?.data?.message ?? 'Failed to register club.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.kicker}><Text style={styles.kickerText}>Club launch</Text></View>
          <View style={styles.heroIcon}>
            <Ionicons name="home" size={34} color="#082f49" />
          </View>
          <Text style={styles.heroTitle}>Register Your Club</Text>
          <Text style={styles.heroSub}>Set up your club, create competitions, and start inviting members with private or public join flows.</Text>
          <View style={styles.heroStats}>
            <Metric label="Setup" value="2 steps" />
            <Metric label="Admin" value="Instant" />
            <Metric label="Invites" value="Ready" />
          </View>
        </View>

        <View style={styles.formIntro}>
          <View style={styles.formIcon}>
            <Ionicons name="home-outline" size={28} color="#7dd3fc" />
          </View>
          <Text style={styles.formIntroTitle}>Register Your Club</Text>
          <Text style={styles.formIntroCopy}>Set up your club in minutes and start running Last Man Standing competitions.</Text>
        </View>

        <View style={styles.stepper}>
          <StepBadge index={1} label="Club Details" active={step === 1} complete={step > 1} />
          <View style={styles.stepLine} />
          <StepBadge index={2} label="Your Account" active={step === 2} complete={false} />
        </View>

        {step === 1 ? (
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Text style={styles.formTitle}>Tell us about your club</Text>
              <Text style={styles.formCopy}>This is how your club will appear to participants.</Text>
            </View>

            <FieldLabel label="Club Name" required />
            <TextInput value={clubName} onChangeText={(value) => { setClubName(value); clearFieldError('clubName'); }} placeholder="e.g. St. Nicholas GAA, The Red Lion Pub" placeholderTextColor="#64748b" style={[styles.input, fieldErrors.clubName ? styles.inputError : null]} maxLength={80} />
            {fieldErrors.clubName ? <Text style={styles.fieldError}>{fieldErrors.clubName}</Text> : <Text style={styles.fieldHelp}>Must be unique across the platform.</Text>}

            <FieldLabel label="Description" optional />
            <TextInput value={clubDescription} onChangeText={setClubDescription} placeholder="A short description of your club or competition rules..." placeholderTextColor="#64748b" style={[styles.input, styles.multiline]} multiline numberOfLines={3} maxLength={300} />

            <View style={styles.benefitsPanel}>
              <Text style={styles.benefitsTitle}>What you get as a Club Admin:</Text>
              {adminBenefits.map((benefit) => (
                <View key={benefit.text} style={styles.benefitRow}>
                  <View style={styles.benefitIcon}><Ionicons name={benefit.icon} size={15} color="#86efac" /></View>
                  <Text style={styles.benefitText}>{benefit.text}</Text>
                </View>
              ))}
            </View>

            {fieldErrors.form ? <Text style={styles.error}>{fieldErrors.form}</Text> : null}
            <TouchableOpacity onPress={goNext} style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>Continue</Text>
              <Ionicons name="arrow-forward" size={17} color="#ffffff" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.accountHeader}>
              <TouchableOpacity onPress={() => { setFieldErrors({}); setStep(1); }} style={styles.backButton}>
                <Ionicons name="arrow-back" size={16} color="#cbd5e1" />
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
              <View style={styles.accountCopy}>
                <Text style={styles.formTitle}>Create your account</Text>
                <Text style={styles.formCopy}>This will be the admin account for <Text style={styles.highlightText}>"{clubName}"</Text></Text>
              </View>
            </View>

            <FieldLabel label="Username" required />
            <TextInput value={username} onChangeText={(value) => { setUsername(value.replace(/\s+/g, '')); clearFieldError('username'); setUsernameStatus('idle'); setUsernameMessage(''); }} autoCapitalize="none" placeholder="yourname" placeholderTextColor="#64748b" style={[styles.input, fieldErrors.username ? styles.inputError : null]} maxLength={30} />
            {fieldErrors.username ? <Text style={styles.fieldError}>{fieldErrors.username}</Text> : usernameStatus !== 'idle' ? <Text style={statusStyle(usernameStatus)}>{usernameStatus === 'checking' ? 'Checking username...' : usernameMessage}</Text> : null}

            <FieldLabel label="Email" required />
            <TextInput value={email} onChangeText={(value) => { setEmail(value); clearFieldError('email'); }} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor="#64748b" style={[styles.input, fieldErrors.email ? styles.inputError : null]} />
            {fieldErrors.email ? <Text style={styles.fieldError}>{fieldErrors.email}</Text> : null}

            <FieldLabel label="Password" required />
            <View style={styles.passwordWrap}>
              <TextInput value={password} onChangeText={(value) => { setPassword(value); clearFieldError('password'); clearFieldError('confirmPassword'); }} secureTextEntry={!showPassword} placeholder="At least 6 characters" placeholderTextColor="#64748b" style={[styles.input, styles.passwordInput, fieldErrors.password ? styles.inputError : null]} />
              <TouchableOpacity onPress={() => setShowPassword((value) => !value)} style={styles.showButton}>
                <Text style={styles.showButtonText}>{showPassword ? 'Hide' : 'Show'}</Text>
              </TouchableOpacity>
            </View>
            {fieldErrors.password ? <Text style={styles.fieldError}>{fieldErrors.password}</Text> : null}

            <FieldLabel label="Confirm Password" required />
            <View style={styles.passwordWrap}>
              <TextInput value={confirmPassword} onChangeText={(value) => { setConfirmPassword(value); clearFieldError('confirmPassword'); }} secureTextEntry={!showConfirmPassword} placeholder="Repeat password" placeholderTextColor="#64748b" style={[styles.input, styles.passwordInput, fieldErrors.confirmPassword ? styles.inputError : null]} />
              <TouchableOpacity onPress={() => setShowConfirmPassword((value) => !value)} style={styles.showButton}>
                <Text style={styles.showButtonText}>{showConfirmPassword ? 'Hide' : 'Show'}</Text>
              </TouchableOpacity>
            </View>
            {fieldErrors.confirmPassword ? <Text style={styles.fieldError}>{fieldErrors.confirmPassword}</Text> : null}

            {fieldErrors.form ? <Text style={styles.error}>{fieldErrors.form}</Text> : null}
            <TouchableOpacity onPress={() => void onSubmit()} disabled={submitting} style={[styles.primaryBtn, submitting ? styles.primaryBtnDisabled : null]}>
              <Text style={styles.primaryBtnText}>{submitting ? 'Creating...' : 'Create Club'}</Text>
              <Ionicons name="checkmark-circle" size={17} color="#ffffff" />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.footerLinks}>
          <Text style={styles.footerText}>Already have an account?</Text>
          <TouchableOpacity onPress={() => router.replace('/login')}>
            <Text style={styles.footerLink}>Sign in</Text>
          </TouchableOpacity>
          <Text style={styles.footerSeparator}>•</Text>
          <TouchableOpacity onPress={() => router.push('/faq')}>
            <Text style={styles.footerLink}>FAQ</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function statusStyle(status: CheckState) {
  if (status === 'available') return styles.ok;
  if (status === 'checking') return styles.neutralInfo;
  return styles.warn;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatLabel}>{label}</Text>
      <Text style={styles.heroStatValue}>{value}</Text>
    </View>
  );
}

function StepBadge({ index, label, active, complete }: { index: number; label: string; active: boolean; complete: boolean }) {
  return (
    <View style={styles.stepItem}>
      <View style={[styles.stepCircle, active ? styles.stepCircleActive : complete ? styles.stepCircleComplete : null]}>
        {complete ? <Ionicons name="checkmark" size={16} color="#ffffff" /> : <Text style={[styles.stepNumber, active ? styles.stepNumberActive : null]}>{index}</Text>}
      </View>
      <Text style={[styles.stepLabel, active ? styles.stepLabelActive : null]}>{label}</Text>
    </View>
  );
}

function FieldLabel({ label, required, optional }: { label: string; required?: boolean; optional?: boolean }) {
  return (
    <Text style={styles.label}>{label} {required ? <Text style={styles.required}>*</Text> : null}{optional ? <Text style={styles.optional}>(optional)</Text> : null}</Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b1220' },
  content: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 30, gap: 14 },
  hero: { position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: '#ffffff14', borderRadius: 30, backgroundColor: '#0f172a', paddingHorizontal: 20, paddingVertical: 20 },
  kicker: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e922', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  kickerText: { color: '#bae6fd', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.4 },
  heroIcon: { marginTop: 16, width: 64, height: 64, borderRadius: 21, borderWidth: 1, borderColor: '#7dd3fc55', backgroundColor: '#38bdf8', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: '#fff', fontSize: 34, lineHeight: 39, fontWeight: '900', marginTop: 16, letterSpacing: -0.6 },
  heroSub: { color: '#cbd5e1', fontSize: 14, lineHeight: 22, marginTop: 8 },
  heroStats: { flexDirection: 'row', gap: 8, marginTop: 18 },
  heroStat: { flex: 1, borderWidth: 1, borderColor: '#ffffff18', backgroundColor: '#ffffff0a', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' },
  heroStatLabel: { color: '#94a3b8', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.1 },
  heroStatValue: { color: '#f8fafc', fontSize: 14, fontWeight: '900', marginTop: 3 },
  formIntro: { alignItems: 'center', gap: 7, paddingTop: 2 },
  formIcon: { width: 58, height: 58, borderRadius: 18, borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e922', alignItems: 'center', justifyContent: 'center' },
  formIntroTitle: { color: '#ffffff', fontSize: 25, fontWeight: '900', marginTop: 4 },
  formIntroCopy: { color: '#94a3b8', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  stepItem: { alignItems: 'center', gap: 6, minWidth: 94 },
  stepCircle: { width: 34, height: 34, borderRadius: 999, backgroundColor: '#1f2937', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#334155' },
  stepCircleActive: { backgroundColor: '#0284c7', borderColor: '#38bdf8' },
  stepCircleComplete: { backgroundColor: '#16a34a', borderColor: '#22c55e' },
  stepNumber: { color: '#64748b', fontSize: 13, fontWeight: '900' },
  stepNumberActive: { color: '#ffffff' },
  stepLabel: { color: '#64748b', fontSize: 11, fontWeight: '800' },
  stepLabelActive: { color: '#ffffff' },
  stepLine: { width: 36, height: 1, backgroundColor: '#334155', marginBottom: 19 },
  card: { borderWidth: 1, borderColor: '#253247', borderRadius: 22, backgroundColor: '#111827', padding: 16, gap: 11 },
  sectionHeader: { marginBottom: 2 },
  formTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '900' },
  formCopy: { color: '#94a3b8', fontSize: 12, lineHeight: 18, marginTop: 4 },
  label: { color: '#d1d5db', fontSize: 13, fontWeight: '800', marginTop: 3 },
  required: { color: '#f87171' },
  optional: { color: '#64748b', fontWeight: '600' },
  input: { backgroundColor: '#0f172a', color: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#334155', paddingHorizontal: 12, paddingVertical: 12, fontSize: 13 },
  inputError: { borderColor: '#ef4444', backgroundColor: '#7f1d1d24' },
  multiline: { minHeight: 92, textAlignVertical: 'top' },
  fieldHelp: { color: '#64748b', fontSize: 11, marginTop: -4 },
  fieldError: { color: '#fca5a5', fontSize: 11, fontWeight: '800', marginTop: -5 },
  benefitsPanel: { borderWidth: 1, borderColor: '#0ea5e933', backgroundColor: '#0ea5e912', borderRadius: 16, padding: 13, gap: 9, marginTop: 3 },
  benefitsTitle: { color: '#7dd3fc', fontSize: 13, fontWeight: '900' },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  benefitIcon: { width: 21, height: 21, borderRadius: 999, backgroundColor: '#22c55e22', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  benefitText: { flex: 1, color: '#d1d5db', fontSize: 12, lineHeight: 18, fontWeight: '600' },
  primaryBtn: { backgroundColor: '#0284c7', borderRadius: 12, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 2 },
  primaryBtnDisabled: { opacity: 0.65 },
  primaryBtnText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  accountHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 2 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 7 },
  backButtonText: { color: '#cbd5e1', fontSize: 12, fontWeight: '800' },
  accountCopy: { flex: 1, minWidth: 0 },
  highlightText: { color: '#f8fafc', fontWeight: '900' },
  passwordWrap: { position: 'relative' },
  passwordInput: { paddingRight: 66 },
  showButton: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },
  showButtonText: { color: '#94a3b8', fontSize: 12, fontWeight: '900' },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 7, paddingVertical: 5 },
  footerText: { color: '#94a3b8', fontSize: 13 },
  footerLink: { color: '#38bdf8', fontSize: 13, fontWeight: '900' },
  footerSeparator: { color: '#475569', fontSize: 12, fontWeight: '900' },
  error: { color: '#fca5a5', fontSize: 12, fontWeight: '700', lineHeight: 17 },
  ok: { color: '#86efac', fontSize: 11, fontWeight: '800', marginTop: -5 },
  warn: { color: '#fca5a5', fontSize: 11, fontWeight: '800', marginTop: -5 },
  neutralInfo: { color: '#cbd5e1', fontSize: 11, fontWeight: '800', marginTop: -5 },
});
