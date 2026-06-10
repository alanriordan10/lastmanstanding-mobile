import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme/tokens';

function formatUpdatedAt(value?: Date | number | null): string {
  if (!value) return 'Not loaded yet';
  const time = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(time)) return 'Not loaded yet';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 10) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `Updated ${hours}h ago`;
}

export function DataFreshnessBar({ updatedAt, refreshing, onRefresh, label = 'Data' }: { updatedAt?: Date | number | null; refreshing?: boolean; onRefresh: () => void; label?: string }) {
  return (
    <View style={styles.wrap}>
      <View>
        <Text style={styles.kicker}>{label}</Text>
        <Text style={styles.meta}>{refreshing ? 'Refreshing...' : formatUpdatedAt(updatedAt)}</Text>
      </View>
      <TouchableOpacity disabled={refreshing} onPress={onRefresh} style={[styles.button, refreshing ? styles.buttonDisabled : null]}>
        <Text style={styles.buttonText}>{refreshing ? 'Updating' : 'Refresh'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#ffffff12',
    backgroundColor: '#ffffff08',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  kicker: { color: '#64748b', fontSize: 9, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
  meta: { color: colors.textSoft, fontSize: 12, fontWeight: '800', marginTop: 2 },
  button: { borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e922', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#bae6fd', fontSize: 11, fontWeight: '900' },
});
