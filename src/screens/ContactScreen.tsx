import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { Card, MetaText, PrimaryButton, ScreenTitle, SectionTitle, StatusPill } from '../components/ui';
import { colors, spacing } from '../theme/tokens';

const SUPPORT_EMAIL = 'support@lastmanstanding.com';

function mailto(subject: string, body: string) {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function ContactScreen() {
  const [issueType, setIssueType] = useState<'BUG' | 'PAYMENT' | 'ACCOUNT' | 'OTHER'>('BUG');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [competitionName, setCompetitionName] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const bugTemplate = `Hi support team,\n\nI found an issue in Last Man Standing.\n\nPage URL:\nWhat happened:\nWhat I expected:\nSteps to reproduce:\n`;
  const paymentTemplate = `Hi support team,\n\nI need help with a payment issue.\n\nCompetition name:\nPayment mode (Stripe/Manual):\nWhat happened:\nReference IDs (if any):\n`;

  const submit = async () => {
    if (!subject.trim() || !message.trim()) {
      setStatus('Subject and message are required');
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const formData = new FormData();
      formData.append('issueType', issueType);
      formData.append('subject', subject.trim());
      formData.append('message', message.trim());
      if (competitionName.trim()) formData.append('competitionName', competitionName.trim());
      await api.post('/support/tickets', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setStatus('Support request submitted');
      setSubject('');
      setMessage('');
      setCompetitionName('');
      setIssueType('BUG');
    } catch (e: any) {
      setStatus(e?.response?.data?.message ?? 'Could not submit support request');
    } finally {
      setBusy(false);
    }
  };

  const openBugMail = async () => {
    await Linking.openURL(mailto('[Support] Bug report', bugTemplate));
  };

  const openPaymentMail = async () => {
    await Linking.openURL(mailto('[Support] Payment issue', paymentTemplate));
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={styles.hero}>
          <MetaText>Support</MetaText>
          <ScreenTitle>Contact Us</ScreenTitle>
          <MetaText>Need help with payments, joining competitions, or account issues?</MetaText>
        </View>

        <Card>
          <SectionTitle>Send from app</SectionTitle>
          <View style={styles.issueRow}>
            {(['BUG', 'PAYMENT', 'ACCOUNT', 'OTHER'] as const).map((kind) => (
              <TouchableOpacity key={kind} onPress={() => setIssueType(kind)}>
                <StatusPill text={kind} tone={issueType === kind ? 'brand' : 'neutral'} />
              </TouchableOpacity>
            ))}
          </View>
          <TextInput value={competitionName} onChangeText={setCompetitionName} placeholder="Competition (optional)" placeholderTextColor={colors.textMuted} style={styles.input} />
          <TextInput value={subject} onChangeText={setSubject} placeholder="Subject" placeholderTextColor={colors.textMuted} style={styles.input} />
          <TextInput value={message} onChangeText={setMessage} placeholder="Describe what happened" placeholderTextColor={colors.textMuted} style={[styles.input, styles.multiline]} multiline numberOfLines={5} />
          {status ? <Text style={styles.status}>{status}</Text> : null}
          <PrimaryButton label={busy ? 'Sending...' : 'Send support request'} onPress={() => void submit()} disabled={busy} />
        </Card>

        <Card>
          <SectionTitle>Quick templates</SectionTitle>
          <MetaText>Open pre-filled email templates for faster support.</MetaText>
          <View style={styles.templateRow}>
            <View style={styles.templateBtn}><PrimaryButton label="Report a bug" onPress={() => void openBugMail()} /></View>
            <View style={styles.templateBtn}><PrimaryButton label="Payment support" onPress={() => void openPaymentMail()} /></View>
          </View>
        </Card>

        <Card>
          <SectionTitle>Support email</SectionTitle>
          <Text style={styles.email}>{SUPPORT_EMAIL}</Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.screen },
  hero: { borderWidth: 1, borderColor: '#ffffff1a', borderRadius: 18, backgroundColor: '#111827', padding: 14, marginBottom: 8 },
  issueRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  input: { backgroundColor: colors.panelSoft, color: colors.text, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  status: { color: '#cbd5e1', marginTop: 4 },
  templateRow: { gap: 8, marginTop: 8 },
  templateBtn: { width: '100%' },
  email: { color: '#7dd3fc', fontWeight: '700' },
});
