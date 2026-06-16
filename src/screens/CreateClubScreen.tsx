import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import { api, getApiErrorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { AuthResponse } from '../types';

interface CreateClubResponse {
  auth: AuthResponse;
  clubId: number;
  clubName: string;
}

const adminBenefits = [
  { icon: 'trophy-outline' as const, text: 'Create unlimited Last Man Standing competitions' },
  { icon: 'cash-outline' as const, text: 'Set entry fees, rules and missed pick behaviour' },
  { icon: 'people-outline' as const, text: 'Manage participants, payments, and winners' },
  { icon: 'stats-chart-outline' as const, text: 'View survivor tables and results history' },
];

export default function CreateClubScreen() {
  const router = useRouter();
  const { user, loading, loginWithData } = useAuth();
  const [clubName, setClubName] = useState('');
  const [clubDescription, setClubDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [clubNameError, setClubNameError] = useState('');
  const [formError, setFormError] = useState('');

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingWrap}><ActivityIndicator color="#38bdf8" /></View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return <Redirect href="/login?returnTo=%2Fcreate-club" />;
  }

  const createClub = async () => {
    const normalizedName = clubName.trim();
    setClubNameError('');
    setFormError('');
    if (!normalizedName) {
      setClubNameError('Club name is required.');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post<CreateClubResponse>('/auth/create-club', {
        clubName: normalizedName,
        clubDescription: clubDescription.trim() ? clubDescription.trim() : null,
      });
      await loginWithData(data.auth);
      router.replace('/(tabs)/club-admin');
    } catch (e: any) {
      setFormError(getApiErrorMessage(e, 'Failed to create club.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.kicker}><Text style={styles.kickerText}>Existing account</Text></View>
          <View style={styles.heroIcon}><Ionicons name="home" size={34} color="#082f49" /></View>
          <Text style={styles.heroTitle}>Create Your Club</Text>
          <Text style={styles.heroSub}>Use your signed-in account to launch a club and manage competitions.</Text>
          <View style={styles.heroStats}>
            <Metric label="Account" value="Signed in" />
            <Metric label="Setup" value="One form" />
            <Metric label="Admin" value="Instant" />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.formTitle}>Tell us about your club</Text>
            <Text style={styles.formCopy}>This is how your club will appear to participants.</Text>
          </View>

          <FieldLabel label="Club Name" required />
          <TextInput
            value={clubName}
            onChangeText={(value) => { setClubName(value); setClubNameError(''); }}
            placeholder="e.g. St. Nicholas GAA, The Red Lion Pub"
            placeholderTextColor="#64748b"
            style={[styles.input, clubNameError ? styles.inputError : null]}
            maxLength={80}
          />
          {clubNameError ? <Text style={styles.fieldError}>{clubNameError}</Text> : <Text style={styles.fieldHelp}>Must be unique across the platform.</Text>}

          <FieldLabel label="Description" optional />
          <TextInput
            value={clubDescription}
            onChangeText={setClubDescription}
            placeholder="A short description of your club or competition rules..."
            placeholderTextColor="#64748b"
            style={[styles.input, styles.multiline]}
            multiline
            numberOfLines={3}
            maxLength={300}
          />

          <View style={styles.benefitsPanel}>
            <Text style={styles.benefitsTitle}>What you get as a Club Admin:</Text>
            {adminBenefits.map((benefit) => (
              <View key={benefit.text} style={styles.benefitRow}>
                <View style={styles.benefitIcon}><Ionicons name={benefit.icon} size={15} color="#86efac" /></View>
                <Text style={styles.benefitText}>{benefit.text}</Text>
              </View>
            ))}
          </View>

          {formError ? <Text style={styles.error}>{formError}</Text> : null}
          <TouchableOpacity onPress={() => void createClub()} disabled={submitting} style={[styles.primaryBtn, submitting ? styles.primaryBtnDisabled : null]}>
            <Text style={styles.primaryBtnText}>{submitting ? 'Creating...' : 'Create Club'}</Text>
            <Ionicons name="checkmark-circle" size={17} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.replace('/(tabs)/competitions')} style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatLabel}>{label}</Text>
      <Text style={styles.heroStatValue}>{value}</Text>
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
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  heroStatValue: { color: '#f8fafc', fontSize: 13, fontWeight: '900', marginTop: 3 },
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
  secondaryBtn: { borderWidth: 1, borderColor: '#ffffff1f', backgroundColor: '#ffffff08', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  secondaryBtnText: { color: '#dbeafe', fontSize: 13, fontWeight: '900' },
  error: { color: '#fca5a5', fontSize: 12, fontWeight: '700', lineHeight: 17 },
});
