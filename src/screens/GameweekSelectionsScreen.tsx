import { useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import type { GameweekSelectionsData } from '../types';
import { Card, FilterPill, MetaText, ScreenTitle, SectionTitle, StatusPill } from '../components/ui';
import { colors, spacing } from '../theme/tokens';

export default function GameweekSelectionsScreen() {
  const params = useLocalSearchParams<{ id: string; gwId: string }>();
  const compId = Number(params.id);
  const gameweekId = Number(params.gwId);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'LIVE' | 'RESOLVED'>('ALL');

  const { data, isLoading, error, isRefetching, refetch } = useQuery({
    queryKey: ['gameweek-selections', compId, gameweekId],
    queryFn: async () => {
      const res = await api.get(`/competitions/${compId}/gameweeks/${gameweekId}/selections`);
      if (Array.isArray(res.data)) return { selections: res.data, byeGranted: false, weekNumber: 0 } as GameweekSelectionsData;
      return res.data as GameweekSelectionsData;
    },
    enabled: Number.isFinite(compId) && Number.isFinite(gameweekId),
  });

  const selections = data?.selections ?? [];
  const resolved = selections.filter((s) => s.outcome !== 'PENDING');
  const pending = selections.filter((s) => s.outcome === 'PENDING');

  const filtered = useMemo(() => {
    let rows = selections;
    if (statusFilter === 'LIVE') rows = pending;
    if (statusFilter === 'RESOLVED') rows = resolved;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.username.toLowerCase().includes(q) || r.teamName.toLowerCase().includes(q));
    }
    return rows;
  }, [selections, pending, resolved, statusFilter, search]);

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <ScrollView refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.brand} />}>
        <View style={styles.hero}>
          <MetaText>Competition</MetaText>
          <ScreenTitle>Gameweek Selections</ScreenTitle>
          <MetaText>{selections.length} picks revealed</MetaText>
          <View style={styles.heroStats}>
            <StatusPill text={`Picks ${selections.length}`} tone="neutral" />
            <StatusPill text={`Resolved ${resolved.length}`} tone="success" />
            <StatusPill text={`Live ${pending.length}`} tone="warn" />
          </View>
        </View>

        <Card>
          <TextInput value={search} onChangeText={setSearch} placeholder="Search participant or team" placeholderTextColor={colors.textMuted} style={styles.input} />
          <View style={styles.filterRow}>
            {(['ALL', 'LIVE', 'RESOLVED'] as const).map((f) => (
              <FilterPill key={f} label={f} active={statusFilter === f} onPress={() => setStatusFilter(f)} />
            ))}
          </View>
        </Card>

        {isLoading ? <Text style={styles.meta}>Loading...</Text> : null}
        {error ? <Text style={styles.error}>Failed to load selections</Text> : null}

        <Card>
          <SectionTitle>Selections</SectionTitle>
          {filtered.map((s, idx) => (
            <View key={`${s.userId}-${s.teamId}-${idx}`} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{s.username}{s.entryNumber ? ` · Entry #${s.entryNumber}` : ''}</Text>
                <MetaText>{s.teamShortName} · {s.source}</MetaText>
              </View>
              <StatusPill text={s.outcome} tone={s.outcome === 'ELIMINATED' ? 'danger' : s.outcome === 'PENDING' ? 'warn' : 'success'} />
            </View>
          ))}
          {filtered.length === 0 ? <MetaText>No selections match current filters.</MetaText> : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.screen },
  hero: { borderWidth: 1, borderColor: '#ffffff1a', borderRadius: 18, backgroundColor: '#111827', padding: 14, marginBottom: 8 },
  heroStats: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  input: { backgroundColor: colors.panelSoft, color: colors.text, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10 },
  filterRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  name: { color: colors.text, fontWeight: '700' },
  meta: { color: colors.textMuted, marginTop: 8 },
  error: { color: '#fca5a5', marginTop: 8 },
});
