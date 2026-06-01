import { useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import type { Competition, GameweekSelectionsData } from '../types';

type PickStat = {
  teamId?: number;
  teamName?: string;
  teamShortName: string;
  pickCount: number;
  percentage?: number;
};
import { Card, FilterPill, MetaText, ScreenTitle, SectionTitle, StatusPill } from '../components/ui';
import { colors, spacing } from '../theme/tokens';

export default function GameweekResultsScreen() {
  const params = useLocalSearchParams<{ id: string; gwId: string }>();
  const compId = Number(params.id);
  const gameweekId = Number(params.gwId);
  const [search, setSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<'ALL' | 'ADVANCE' | 'ELIMINATED' | 'PENDING'>('ALL');

  const compQuery = useQuery({
    queryKey: ['competition', compId],
    queryFn: async () => (await api.get<Competition>(`/competitions/${compId}`)).data,
    enabled: Number.isFinite(compId),
  });

  const { data, isLoading, error, isRefetching, refetch } = useQuery({
    queryKey: ['gameweek-results', compId, gameweekId],
    queryFn: async () => {
      const res = await api.get(`/competitions/${compId}/gameweeks/${gameweekId}/selections`);
      if (Array.isArray(res.data)) return { selections: res.data, byeGranted: false, weekNumber: 0 } as GameweekSelectionsData;
      return res.data as GameweekSelectionsData;
    },
    enabled: Number.isFinite(compId) && Number.isFinite(gameweekId),
  });

  const pickStatsQuery = useQuery({
    queryKey: ['gameweek-results-pick-stats', compId, gameweekId],
    queryFn: async () => (await api.get<PickStat[]>(`/competitions/${compId}/gameweeks/${gameweekId}/pick-stats`)).data ?? [],
    enabled: Number.isFinite(compId) && Number.isFinite(gameweekId),
  });

  const selections = data?.selections ?? [];
  const pickStats = useMemo(() => {
    const rawStats = pickStatsQuery.data ?? [];
    const total = rawStats.reduce((sum, stat) => sum + (stat.pickCount ?? 0), 0);
    return [...rawStats]
      .map((stat) => ({
        ...stat,
        percentage: typeof stat.percentage === 'number'
          ? stat.percentage
          : total > 0
          ? Math.round(((stat.pickCount ?? 0) / total) * 100)
          : 0,
      }))
      .sort((a, b) => (b.pickCount ?? 0) - (a.pickCount ?? 0) || a.teamShortName.localeCompare(b.teamShortName));
  }, [pickStatsQuery.data]);
  const pickStatByTeam = useMemo(() => {
    const map = new Map<string, PickStat>();
    for (const stat of pickStats) {
      if (stat.teamId != null) map.set(`id:${stat.teamId}`, stat);
      map.set(`short:${stat.teamShortName}`, stat);
      if (stat.teamName) map.set(`name:${stat.teamName}`, stat);
    }
    return map;
  }, [pickStats]);
  const getPickStat = (teamId: number, teamShortName: string, teamName: string) => pickStatByTeam.get(`id:${teamId}`) ?? pickStatByTeam.get(`short:${teamShortName}`) ?? pickStatByTeam.get(`name:${teamName}`);

  const advanced = selections.filter((s) => s.outcome === 'ADVANCE' || s.outcome === 'POSTPONED_ADVANCE');
  const eliminated = selections.filter((s) => s.outcome === 'ELIMINATED');
  const pending = selections.filter((s) => s.outcome === 'PENDING');

  const filtered = useMemo(() => {
    let rows = selections;
    if (outcomeFilter === 'ADVANCE') rows = advanced;
    if (outcomeFilter === 'ELIMINATED') rows = eliminated;
    if (outcomeFilter === 'PENDING') rows = pending;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.username.toLowerCase().includes(q) || r.teamName.toLowerCase().includes(q));
    }
    return rows;
  }, [selections, advanced, eliminated, pending, outcomeFilter, search]);

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <ScrollView refreshControl={<RefreshControl refreshing={isRefetching || pickStatsQuery.isRefetching} onRefresh={() => void Promise.all([refetch(), pickStatsQuery.refetch()])} tintColor={colors.brand} />}>
        <View style={styles.hero}>
          <MetaText>{compQuery.data?.name ?? 'Competition'}</MetaText>
          <ScreenTitle>Gameweek Results</ScreenTitle>
          <MetaText>{selections.length} picks processed</MetaText>
          <View style={styles.heroStats}>
            <StatusPill text={`Advanced ${advanced.length}`} tone="success" />
            <StatusPill text={`Out ${eliminated.length}`} tone="danger" />
            <StatusPill text={`Pending ${pending.length}`} tone="warn" />
          </View>
        </View>

        <Card>
          <TextInput value={search} onChangeText={setSearch} placeholder="Search participant" placeholderTextColor={colors.textMuted} style={styles.input} />
          <View style={styles.filterRow}>
            {(['ALL', 'ADVANCE', 'ELIMINATED', 'PENDING'] as const).map((f) => (
              <FilterPill key={f} label={f} active={outcomeFilter === f} onPress={() => setOutcomeFilter(f)} />
            ))}
          </View>
        </Card>

        {isLoading ? <Text style={styles.meta}>Loading...</Text> : null}
        {error ? <Text style={styles.error}>Failed to load results</Text> : null}

        <Card>
          <View style={styles.sectionHeaderRow}>
            <SectionTitle>Team pick share</SectionTitle>
            <MetaText>{pickStats.length} teams</MetaText>
          </View>
          {pickStats.length > 0 ? (
            <View style={styles.pickShareList}>
              {pickStats.map((stat) => (
                <View key={`${stat.teamId ?? stat.teamShortName}`} style={styles.pickShareRow}>
                  <View style={styles.pickShareTop}>
                    <Text style={styles.pickShareTeam}>{stat.teamShortName}</Text>
                    <Text style={styles.pickSharePercent}>{stat.percentage}%</Text>
                  </View>
                  <View style={styles.pickShareTrack}>
                    <View style={[styles.pickShareFill, { width: `${Math.max(3, Math.min(100, stat.percentage ?? 0))}%` }]} />
                  </View>
                  <Text style={styles.pickShareCount}>{stat.pickCount} {stat.pickCount === 1 ? 'player' : 'players'}</Text>
                </View>
              ))}
            </View>
          ) : (
            <MetaText>No team pick share available yet.</MetaText>
          )}
        </Card>

        <Card>
          <SectionTitle>Results</SectionTitle>
          {filtered.map((s, idx) => {
            const stat = getPickStat(s.teamId, s.teamShortName, s.teamName);
            return (
              <View key={`${s.participantId ?? s.userId}-${s.teamId}-${idx}`} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{s.username}{s.entryNumber ? ` · Entry #${s.entryNumber}` : ''}</Text>
                  <View style={styles.selectionMetaRow}>
                    <MetaText>{s.teamShortName} · {s.source}{s.useLifeline ? ' · Lifeline' : ''}</MetaText>
                    {stat ? <Text style={styles.pickPercentChip}>{stat.percentage}% · {stat.pickCount} {stat.pickCount === 1 ? 'player' : 'players'}</Text> : null}
                  </View>
                </View>
                <StatusPill text={s.outcome} tone={s.outcome === 'ELIMINATED' ? 'danger' : s.outcome === 'PENDING' ? 'warn' : 'success'} />
              </View>
            );
          })}
          {filtered.length === 0 ? <MetaText>No results match current filters.</MetaText> : null}
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
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  pickShareList: { marginTop: 8, gap: 10 },
  pickShareRow: { borderWidth: 1, borderColor: '#263244', backgroundColor: '#0f172a', borderRadius: 12, padding: 10 },
  pickShareTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  pickShareTeam: { color: colors.text, fontSize: 14, fontWeight: '900' },
  pickSharePercent: { color: '#7dd3fc', fontSize: 14, fontWeight: '900' },
  pickShareTrack: { marginTop: 8, height: 7, borderRadius: 999, backgroundColor: '#1f2937', overflow: 'hidden' },
  pickShareFill: { height: '100%', borderRadius: 999, backgroundColor: '#38bdf8' },
  pickShareCount: { marginTop: 6, color: '#94a3b8', fontSize: 11, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  selectionMetaRow: { marginTop: 2, flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  pickPercentChip: { overflow: 'hidden', borderRadius: 999, backgroundColor: '#ffffff14', color: '#d1d5db', fontSize: 10, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 3 },
  name: { color: colors.text, fontWeight: '700' },
  meta: { color: colors.textMuted, marginTop: 8 },
  error: { color: '#fca5a5', marginTop: 8 },
});
