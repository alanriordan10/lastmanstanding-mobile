import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthContext';
import { authenticateWithBiometrics, getBiometricAvailability, isBiometricLoginEnabled, setBiometricLoginEnabled } from '../auth/biometricAuth';
import Constants from 'expo-constants';
import { api } from '../api/client';
import { Card, MetaText, PrimaryButton, ScreenTitle, SectionTitle, StatusPill } from '../components/ui';
import { colors, spacing } from '../theme/tokens';

const isExpoGo = Constants.appOwnership === 'expo';

async function getExpoPushTokenSafe(): Promise<string | null> {
  if (isExpoGo) return null;

  const Device = await import('expo-device');
  const Notifications = await import('expo-notifications');

  if (!Device.isDevice) return null;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return null;

  const projectId = (Constants as any)?.expoConfig?.extra?.eas?.projectId ?? (Constants as any)?.easConfig?.projectId;
  const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return token.data;
}

export default function ProfileScreen() {
  const { user, logout, loginWithData, refreshMe } = useAuth();
  const router = useRouter();
  const [pushStatus, setPushStatus] = useState<string>(isExpoGo ? 'Unavailable in Expo Go' : 'Not registered');
  const [busy, setBusy] = useState(false);

  const [emailOptIn, setEmailOptIn] = useState<boolean>(user?.emailResultsOptIn ?? false);
  const [savingEmailPref, setSavingEmailPref] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Biometrics');
  const [savingBiometric, setSavingBiometric] = useState(false);

  const [deleteSectionOpen, setDeleteSectionOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteToken, setDeleteToken] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setEmailOptIn(user?.emailResultsOptIn ?? false);
  }, [user?.emailResultsOptIn]);

  useEffect(() => {
    const loadBiometricState = async () => {
      const [availability, enabled] = await Promise.all([
        getBiometricAvailability(),
        isBiometricLoginEnabled(),
      ]);
      setBiometricAvailable(availability.available);
      setBiometricLabel(availability.label);
      setBiometricEnabled(enabled);
    };
    void loadBiometricState();
  }, []);

  const initials = useMemo(() => {
    const name = user?.username?.trim() ?? '';
    if (!name) return '??';
    return name.slice(0, 2).toUpperCase();
  }, [user?.username]);

  const onLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const onEnablePush = async () => {
    if (isExpoGo) {
      setPushStatus('Use a development build for remote push');
      return;
    }
    setBusy(true);
    try {
      const token = await getExpoPushTokenSafe();
      if (!token) {
        setPushStatus('Permission denied or unsupported device');
        return;
      }
      await api.post('/notifications/mobile/register', { token, platform: 'android' });
      setPushStatus('Registered');
    } catch {
      setPushStatus('Registration failed');
    } finally {
      setBusy(false);
    }
  };

  const onDisablePush = async () => {
    setBusy(true);
    try {
      const token = await getExpoPushTokenSafe();
      if (token) await api.delete('/notifications/mobile/register', { data: { token } });
      else await api.delete('/notifications/mobile/register');
      setPushStatus('Unregistered');
    } catch {
      setPushStatus('Unregister failed');
    } finally {
      setBusy(false);
    }
  };

  const onToggleBiometric = async () => {
    setSavingBiometric(true);
    try {
      if (biometricEnabled) {
        await setBiometricLoginEnabled(false);
        setBiometricEnabled(false);
        return;
      }
      const availability = await getBiometricAvailability();
      setBiometricAvailable(availability.available);
      setBiometricLabel(availability.label);
      if (!availability.available) return;
      const ok = await authenticateWithBiometrics('Enable login');
      if (!ok) return;
      await setBiometricLoginEnabled(true);
      setBiometricEnabled(true);
    } finally {
      setSavingBiometric(false);
    }
  };

  const onToggleEmailPref = async () => {
    const next = !emailOptIn;
    setSavingEmailPref(true);
    try {
      await api.put('/auth/email-preferences', { emailResultsOptIn: next });
      setEmailOptIn(next);
      if (user) {
        await loginWithData({ ...user, emailResultsOptIn: next });
      } else {
        await refreshMe();
      }
    } finally {
      setSavingEmailPref(false);
    }
  };

  const onVerifyDeletePassword = async () => {
    if (!deletePassword.trim()) return;
    try {
      const { data } = await api.post<{ deleteToken: string }>('/auth/delete-token', { password: deletePassword });
      setDeleteToken(data.deleteToken);
    } catch {
      setDeleteToken(null);
    }
  };

  const onDeleteAccount = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE ACCOUNT') return;
    if (!deleteToken) return;
    setDeleting(true);
    try {
      await api.delete('/auth/me', { data: { deleteToken, confirmText: deleteConfirmText } });
      await logout({ clearBiometric: true });
      router.replace('/login');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={styles.hero}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
          <View style={styles.heroText}>
            <MetaText>Account Centre</MetaText>
            <ScreenTitle>{user?.username ?? 'Profile'}</ScreenTitle>
            <Text style={styles.email}>{user?.email ?? '—'}</Text>
          </View>
        </View>

        <Card>
          <SectionTitle>Account</SectionTitle>
          <View style={styles.fieldRow}><MetaText>Role</MetaText><StatusPill text={user?.role ?? 'USER'} tone={user?.role === 'ADMIN' ? 'warn' : user?.role === 'CLUB_ADMIN' ? 'brand' : 'neutral'} /></View>
          <View style={styles.fieldRow}><MetaText>Email reminders</MetaText><StatusPill text={emailOptIn ? 'ON' : 'OFF'} tone={emailOptIn ? 'success' : 'neutral'} /></View>
          <TouchableOpacity style={styles.toggleBtn} onPress={() => void onToggleEmailPref()} disabled={savingEmailPref}>
            <Text style={styles.toggleBtnText}>{savingEmailPref ? 'Saving...' : emailOptIn ? 'Turn Off Email Reminders' : 'Turn On Email Reminders'}</Text>
          </TouchableOpacity>
        </Card>


        <Card>
          <SectionTitle>Biometric Login</SectionTitle>
          <Text style={styles.hint}>Use {biometricLabel} to unlock your saved session on this device.</Text>
          <View style={styles.fieldRow}><MetaText>Status</MetaText><StatusPill text={!biometricAvailable ? 'UNAVAILABLE' : biometricEnabled ? 'ON' : 'OFF'} tone={!biometricAvailable ? 'neutral' : biometricEnabled ? 'success' : 'neutral'} /></View>
          <TouchableOpacity style={styles.toggleBtn} onPress={() => void onToggleBiometric()} disabled={savingBiometric || !biometricAvailable}>
            <Text style={styles.toggleBtnText}>{savingBiometric ? 'Please wait...' : biometricEnabled ? `Disable ${biometricLabel} Login` : `Enable ${biometricLabel} Login`}</Text>
          </TouchableOpacity>
        </Card>

        <Card>
          <SectionTitle>Push Notifications</SectionTitle>
          <Text style={styles.hint}>{isExpoGo ? 'Remote push needs a development build (Expo Go does not support it).' : 'Enable to receive reminders and results on this device.'}</Text>
          <View style={styles.row}>
            <View style={styles.flexOne}><PrimaryButton label={busy ? 'Please wait...' : 'Enable Push'} onPress={() => void onEnablePush()} disabled={busy || isExpoGo} /></View>
            <View style={styles.flexOne}><PrimaryButton label="Disable" onPress={() => void onDisablePush()} disabled={busy} /></View>
          </View>
          <View style={{ marginTop: 8 }}><StatusPill text={pushStatus} tone={pushStatus === 'Registered' ? 'success' : pushStatus.includes('failed') ? 'danger' : 'neutral'} /></View>
        </Card>

        <Card>
          <SectionTitle>Help</SectionTitle>
          <View style={styles.row}>
            <View style={styles.flexOne}><PrimaryButton label="FAQ" onPress={() => router.push('/faq')} /></View>
            <View style={styles.flexOne}><PrimaryButton label="Contact Us" onPress={() => router.push('/contact')} /></View>
          </View>
        </Card>

        <Card>
          <TouchableOpacity onPress={() => setDeleteSectionOpen((v) => !v)} style={[styles.dangerHeader, deleteSectionOpen ? styles.dangerHeaderOpen : null]}>
            <View style={styles.dangerHeaderCopy}>
              <Text style={styles.dangerKicker}>Danger zone</Text>
              <Text style={styles.dangerTitle}>Delete Account</Text>
              <Text style={styles.dangerMeta}>{deleteSectionOpen ? 'Expanded' : 'Tap to show delete controls'}</Text>
            </View>
            <View style={[styles.dangerChevronBox, deleteSectionOpen ? styles.dangerChevronBoxOpen : null]}><Text style={styles.dangerSub}>{deleteSectionOpen ? '▲' : '▼'}</Text></View>
          </TouchableOpacity>
          {deleteSectionOpen ? (
            <View style={styles.dangerBody}>
              <Text style={styles.hint}>This permanently closes your account and signs you out.</Text>
              <TextInput value={deletePassword} onChangeText={(v) => { setDeletePassword(v); setDeleteToken(null); }} secureTextEntry placeholder="Password" placeholderTextColor={colors.textMuted} style={styles.input} />
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => void onVerifyDeletePassword()}><Text style={styles.secondaryBtnText}>{deleteToken ? 'Verified' : 'Verify Password'}</Text></TouchableOpacity>
              <TextInput value={deleteConfirmText} onChangeText={setDeleteConfirmText} placeholder="Type DELETE ACCOUNT" placeholderTextColor={colors.textMuted} style={styles.input} autoCapitalize="characters" />
              <TouchableOpacity style={styles.deleteBtn} onPress={() => void onDeleteAccount()} disabled={deleting}>
                <Text style={styles.deleteBtnText}>{deleting ? 'Deleting...' : 'Delete Account Permanently'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </Card>

        <TouchableOpacity onPress={() => void onLogout()} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.screen },
  hero: { borderWidth: 1, borderColor: '#ffffff1a', borderRadius: 18, backgroundColor: '#111827', padding: 14, flexDirection: 'row', gap: 12, alignItems: 'center' },
  avatar: { height: 56, width: 56, borderRadius: 16, backgroundColor: '#0ea5e9', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#062033', fontWeight: '900', fontSize: 20 },
  heroText: { flex: 1 },
  email: { color: '#94a3b8', marginTop: 4, fontSize: 12 },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  hint: { color: colors.textMuted, marginTop: 2, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  flexOne: { flex: 1 },
  toggleBtn: { marginTop: 8, borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e922', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  toggleBtnText: { color: '#7dd3fc', fontWeight: '700', fontSize: 12 },
  dangerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#7f1d1d66', backgroundColor: '#450a0a33', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12, gap: 12 },
  dangerHeaderOpen: { borderColor: '#ef444466', backgroundColor: '#7f1d1d3d' },
  dangerHeaderCopy: { flex: 1, minWidth: 0 },
  dangerKicker: { color: '#fca5a5', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 3 },
  dangerTitle: { color: '#fecaca', fontWeight: '900', fontSize: 16 },
  dangerMeta: { color: '#fca5a5', opacity: 0.75, fontSize: 11, fontWeight: '700', marginTop: 3 },
  dangerChevronBox: { width: 32, height: 32, borderRadius: 11, borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  dangerChevronBoxOpen: { backgroundColor: '#ef444422' },
  dangerSub: { color: '#fca5a5', fontSize: 10, fontWeight: '900' },
  dangerBody: { marginTop: 10, gap: 8 },
  input: { backgroundColor: colors.panelSoft, color: colors.text, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10 },
  secondaryBtn: { borderWidth: 1, borderColor: '#ffffff2a', backgroundColor: '#ffffff12', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  secondaryBtnText: { color: '#e2e8f0', fontWeight: '700', fontSize: 12 },
  deleteBtn: { borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#ef444422', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  deleteBtnText: { color: '#fca5a5', fontWeight: '700', fontSize: 12 },
  logoutBtn: { marginTop: 10, borderWidth: 1, borderColor: '#ef444455', borderRadius: 10, backgroundColor: '#ef444422', paddingVertical: 11, alignItems: 'center' },
  logoutText: { color: '#fca5a5', fontWeight: '700' },
});
