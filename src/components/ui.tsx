import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radius, shadows, spacing } from '../theme/tokens';

export function ScreenTitle({ children }: PropsWithChildren) {
  return <Text style={styles.screenTitle}>{children}</Text>;
}

export function SectionTitle({ children }: PropsWithChildren) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function MetaText({ children }: PropsWithChildren) {
  return <Text style={styles.meta}>{children}</Text>;
}

export function Card({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

export function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export function FilterPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.filterPill, active ? styles.filterPillActive : null]} onPress={onPress}>
      <Text style={[styles.filterPillText, active ? styles.filterPillTextActive : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function StatusPill({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'brand' | 'success' | 'danger' | 'warn' | 'info' }) {
  const toneStyle = toneStyles[tone];
  return (
    <View style={[styles.pill, toneStyle.box]}>
      <Text style={[styles.pillText, toneStyle.text]}>{text}</Text>
    </View>
  );
}

export function PrimaryButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled ? styles.buttonDisabled : null]}>
      <Text style={styles.primaryButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const toneStyles = {
  neutral: {
    box: { borderColor: '#ffffff25', backgroundColor: colors.neutralSoft },
    text: { color: '#cbd5e1' },
  },
  brand: {
    box: { borderColor: '#0ea5e955', backgroundColor: colors.brandSoft },
    text: { color: '#7dd3fc' },
  },
  success: {
    box: { borderColor: '#22c55e55', backgroundColor: colors.successSoft },
    text: { color: '#86efac' },
  },
  danger: {
    box: { borderColor: '#ef444455', backgroundColor: colors.dangerSoft },
    text: { color: '#fca5a5' },
  },
  warn: {
    box: { borderColor: '#f59e0b55', backgroundColor: colors.warnSoft },
    text: { color: '#fcd34d' },
  },
  info: {
    box: { borderColor: '#38bdf855', backgroundColor: colors.infoSoft },
    text: { color: '#7dd3fc' },
  },
} as const;

const styles = StyleSheet.create({
  screenTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: spacing.cardPad,
    marginTop: 12,
    ...shadows.card,
  },
  metricTile: {
    flex: 1,
    minHeight: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffffff1a',
    backgroundColor: '#ffffff0f',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  metricValue: {
    color: colors.text,
    fontSize: 23,
    fontWeight: '800',
    lineHeight: 27,
  },
  metricLabel: {
    marginTop: 3,
    color: colors.textSoft,
    fontSize: 10,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  filterPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ffffff1a',
    backgroundColor: '#ffffff08',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterPillActive: {
    borderColor: '#0ea5e980',
    backgroundColor: '#0ea5e922',
  },
  filterPillText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: '#7dd3fc',
  },
  pill: {
    borderWidth: 1,
    borderRadius: radius.chip,
    paddingHorizontal: 9,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  primaryButton: {
    backgroundColor: colors.brand,
    borderRadius: radius.button,
    paddingVertical: 11,
    paddingHorizontal: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
});
