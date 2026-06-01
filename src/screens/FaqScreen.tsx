import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, MetaText, ScreenTitle, SectionTitle } from '../components/ui';
import { colors, spacing } from '../theme/tokens';

const FAQ_SECTIONS = [
  {
    title: 'Player Rules',
    items: [
      { q: 'How does a last man standing competition work?', a: 'Each entry picks one team per gameweek. A win advances the entry. A loss eliminates the entry. Draw handling depends on competition settings, including whether lifeline is enabled and used.' },
      { q: 'What are the core rules in every competition?', a: 'Each entry must pick one eligible team per gameweek before lock. You cannot reuse a team already used by that entry. Win advances, loss eliminates.' },
      { q: 'Can I change my pick?', a: 'Yes, until the gameweek lock time. After lock, picks are frozen.' },
      { q: 'What if I miss a pick?', a: 'This depends on competition setup. Some competitions eliminate missed picks; others may support automatic assignment based on admin settings.' },
    ],
  },
  {
    title: 'Lifeline Rules',
    items: [
      { q: 'How does lifeline work?', a: 'When enabled, each entry can play one lifeline before a gameweek starts. A loss still eliminates the entry.' },
      { q: 'When can I use lifeline?', a: 'Only before gameweek lock. Lifeline cannot be activated after lock.' },
      { q: 'How many lifelines do I get?', a: 'At most one lifeline per entry in lifeline-enabled competitions.' },
    ],
  },
  {
    title: 'Payments and Entries',
    items: [
      { q: 'Which payment modes are supported?', a: 'FREE, MANUAL, and STRIPE are supported per competition.' },
      { q: 'Can users enter multiple times?', a: 'Yes. Admins can configure max entries per user, and each entry is tracked independently.' },
      { q: 'Can one user have paid and unpaid entries at once?', a: 'Yes. Payment state is tracked per entry, not per user account.' },
    ],
  },
  {
    title: 'Gameweek and Admin Rules',
    items: [
      { q: 'What statuses can an entry have?', a: 'Typical statuses are ACTIVE, ELIMINATED, and WINNER.' },
      { q: 'Can admins remove participants or declare winners?', a: 'Yes. Club admins can manage participants and declare winners using Club Admin tools.' },
      { q: 'Can competitions be public or private?', a: 'Yes. Competitions can be configured as public or private with admin-controlled join behavior.' },
    ],
  },
];

export default function FaqScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={styles.hero}>
          <MetaText>Help</MetaText>
          <ScreenTitle>Frequently Asked Questions</ScreenTitle>
          <MetaText>Rules, lifeline usage, payment modes, and results behavior.</MetaText>
        </View>

        {FAQ_SECTIONS.map((section) => (
          <Card key={section.title}>
            <SectionTitle>{section.title}</SectionTitle>
            {section.items.map((item) => (
              <View key={item.q} style={styles.item}>
                <Text style={styles.q}>{item.q}</Text>
                <Text style={styles.a}>{item.a}</Text>
              </View>
            ))}
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.screen },
  hero: { borderWidth: 1, borderColor: '#ffffff1a', borderRadius: 18, backgroundColor: '#111827', padding: 14, marginBottom: 8 },
  item: { borderBottomWidth: 1, borderBottomColor: '#1f2937', paddingVertical: 8 },
  q: { color: colors.text, fontWeight: '700', marginBottom: 3 },
  a: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
});
