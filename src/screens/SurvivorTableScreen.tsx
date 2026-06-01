import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../api/client';
import type { Competition, SurvivorRow, SurvivorTableResponse } from '../types';
import { Card, FilterPill, MetaText, ScreenTitle, StatusPill } from '../components/ui';
import { colors, spacing } from '../theme/tokens';

type StatusFilter = 'ALL' | 'ACTIVE' | 'ELIMINATED' | 'WINNER';
type MobileMode = 'compact' | 'table';

const PAGE_SIZE = 25;

function cellStyle(outcome?: string) {
  const normalized = String(outcome ?? '').toUpperCase();
  if (normalized.includes('ADVANCE') || normalized === 'WIN') return { bg: '#22c55e22', border: '#22c55e55', text: '#86efac' };
  if (normalized.includes('ELIMINATED') || normalized === 'LOSS') return { bg: '#ef444422', border: '#ef444455', text: '#fca5a5' };
  if (normalized.includes('POSTPONED') || normalized === 'DRAW') return { bg: '#f59e0b22', border: '#f59e0b55', text: '#fcd34d' };
  return { bg: '#33415566', border: '#334155', text: '#cbd5e1' };
}

function outcomeLabel(outcome?: string) {
  const normalized = String(outcome ?? '').toUpperCase();
  if (normalized === 'ADVANCE' || normalized === 'WIN') return 'Advanced';
  if (normalized === 'ELIMINATED' || normalized === 'LOSS') return 'Out';
  if (normalized.includes('POSTPONED') || normalized === 'DRAW') return 'Postponed';
  if (normalized === 'PENDING') return 'Pending';
  return normalized || 'Pending';
}

function outcomeSymbol(outcome?: string) {
  const label = outcomeLabel(outcome);
  if (label === 'Advanced') return '✓';
  if (label === 'Out') return '✕';
  if (label === 'Postponed') return '↷';
  return '';
}

export default function SurvivorTableScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const compId = Number(params.id);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [eliminatedWeekFilter, setEliminatedWeekFilter] = useState<'ALL' | number>('ALL');
  const [mobileMode, setMobileMode] = useState<MobileMode>('compact');
  const [page, setPage] = useState(1);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const compQuery = useQuery({
    queryKey: ['competition', compId],
    queryFn: async () => (await api.get<Competition>(`/competitions/${compId}`)).data,
    enabled: Number.isFinite(compId),
  });

  const { data, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: ['survivor-table', compId],
    queryFn: async () => (await api.get<SurvivorTableResponse>(`/competitions/${compId}/survivor-table`)).data,
    enabled: Number.isFinite(compId),
    refetchInterval: (query) => {
      const table = query.state.data as SurvivorTableResponse | undefined;
      const hasLive = table?.gameweeks?.some((gw) => gw.status === 'IN_PROGRESS');
      return hasLive ? 60000 : 300000;
    },
  });

  if (!Number.isFinite(compId)) {
    return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}><Text style={styles.error}>Invalid competition id.</Text></SafeAreaView>;
  }

  const rows = data?.rows ?? [];
  const gameweeks = data?.gameweeks ?? [];

  const userEntryCounts = useMemo(() => {
    const counts = new Map<number, number>();
    rows.forEach((row) => counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1));
    return counts;
  }, [rows]);

  const displayName = (row: SurvivorRow) => {
    const count = userEntryCounts.get(row.userId) ?? 0;
    return count > 1 ? `${row.username} • Entry #${row.entryNumber ?? 1}` : row.username;
  };

  const eliminatedWeeks = useMemo(
    () => Array.from(new Set(rows.map((row) => row.eliminatedWeek).filter((week): week is number => typeof week === 'number'))).sort((a, b) => a - b),
    [rows],
  );

  const counts = useMemo(() => ({
    ALL: rows.length,
    ACTIVE: rows.filter((row) => row.status === 'ACTIVE').length,
    ELIMINATED: rows.filter((row) => row.status === 'ELIMINATED').length,
    WINNER: rows.filter((row) => row.status === 'WINNER').length,
  }), [rows]);

  const filtered = useMemo(() => rows.filter((row) => {
    const matchSearch = !search.trim() || displayName(row).toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'ALL' || row.status === statusFilter;
    const matchEliminatedWeek = eliminatedWeekFilter === 'ALL' || row.eliminatedWeek === eliminatedWeekFilter;
    return matchSearch && matchStatus && matchEliminatedWeek;
  }), [rows, search, statusFilter, eliminatedWeekFilter, userEntryCounts]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const rank = (row: SurvivorRow) => (row.status === 'WINNER' ? 0 : row.status === 'ACTIVE' ? 1 : 2);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.status === 'ELIMINATED' && b.status === 'ELIMINATED') return (b.eliminatedWeek ?? 0) - (a.eliminatedWeek ?? 0);
      const username = a.username.localeCompare(b.username);
      if (username !== 0) return username;
      return (a.entryNumber ?? 1) - (b.entryNumber ?? 1);
    });
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('ALL');
    setEliminatedWeekFilter('ALL');
    setPage(1);
  };

  const toggleExpanded = (rowKey: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.brand} />}>
        <View style={styles.hero}>
          <TouchableOpacity onPress={() => router.push(`/competitions/${compId}`)}><Text style={styles.backLink}>← Competition</Text></TouchableOpacity>
          <ScreenTitle>Survivor Table</ScreenTitle>
          <MetaText>{compQuery.data?.name ?? 'Competition standings'}</MetaText>
          <View style={styles.heroStats}>
            <View style={styles.heroStatCard}><Text style={[styles.heroStatValue, { color: '#86efac' }]}>{counts.ACTIVE}</Text><Text style={styles.heroStatLabel}>Active</Text></View>
            <View style={styles.heroStatCard}><Text style={[styles.heroStatValue, { color: '#fca5a5' }]}>{counts.ELIMINATED}</Text><Text style={styles.heroStatLabel}>Out</Text></View>
            <View style={styles.heroStatCard}><Text style={[styles.heroStatValue, { color: '#fde68a' }]}>{counts.WINNER}</Text><Text style={styles.heroStatLabel}>Winner</Text></View>
          </View>
        </View>

        <Card>
          <TextInput value={search} onChangeText={(v) => { setSearch(v); setPage(1); }} placeholder="Search participant" placeholderTextColor={colors.textMuted} style={styles.searchInput} />
          <View style={styles.filterRow}>
            {(['ALL', 'ACTIVE', 'ELIMINATED', 'WINNER'] as const).map((status) => (
              <FilterPill key={status} label={`${status} (${counts[status]})`} active={statusFilter === status} onPress={() => { setStatusFilter(status); setPage(1); }} />
            ))}
          </View>
          <View style={styles.filterRow}>
            <FilterPill label="Elim: All" active={eliminatedWeekFilter === 'ALL'} onPress={() => { setEliminatedWeekFilter('ALL'); setPage(1); }} />
            {eliminatedWeeks.map((week) => (
              <FilterPill key={week} label={`Elim: GW${week}`} active={eliminatedWeekFilter === week} onPress={() => { setEliminatedWeekFilter(week); setPage(1); }} />
            ))}
          </View>
          <View style={styles.modeRow}>
            <TouchableOpacity style={[styles.modeBtn, mobileMode === 'compact' ? styles.modeBtnActive : null]} onPress={() => setMobileMode('compact')}><Text style={[styles.modeBtnText, mobileMode === 'compact' ? styles.modeBtnTextActive : null]}>Compact</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.modeBtn, mobileMode === 'table' ? styles.modeBtnActive : null]} onPress={() => setMobileMode('table')}><Text style={[styles.modeBtnText, mobileMode === 'table' ? styles.modeBtnTextActive : null]}>Table</Text></TouchableOpacity>
          </View>
          {(search.trim() || statusFilter !== 'ALL' || eliminatedWeekFilter !== 'ALL') ? (
            <TouchableOpacity onPress={clearFilters}><Text style={styles.clearLink}>Clear filters</Text></TouchableOpacity>
          ) : null}
        </Card>

        {isLoading ? <Text style={styles.meta}>Loading survivor table...</Text> : null}
        {error ? <Text style={styles.error}>Failed to load survivor table</Text> : null}

        {!isLoading && !error ? (
          <View style={styles.resultInfoRow}>
            <MetaText>{sorted.length === rows.length ? `${rows.length} participant(s)` : `${sorted.length} of ${rows.length} participants`} · page {currentPage}/{totalPages}</MetaText>
          </View>
        ) : null}

        {!isLoading && !error && mobileMode === 'compact' ? (
          <FlatList
            data={paginated}
            keyExtractor={(row) => `${row.userId}-${row.entryNumber ?? 1}`}
            scrollEnabled={false}
            contentContainerStyle={{ paddingBottom: 8 }}
            renderItem={({ item }) => {
              const rowKey = `${item.userId}-${item.entryNumber ?? 1}`;
              const isOpen = expandedRows.has(rowKey);
              const latestPick = [...gameweeks]
                .reverse()
                .map((gw) => ({ gw, pick: item.picks[gw.weekNumber] }))
                .find((entry) => entry.pick != null);

              return (
                <View style={styles.compactCard}>
                  <TouchableOpacity style={styles.compactHeader} onPress={() => toggleExpanded(rowKey)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.compactName}>{displayName(item)}</Text>
                      <Text style={styles.compactMeta}>
                        {item.status}
                        {item.status === 'ELIMINATED' && item.eliminatedWeek ? ` · GW${item.eliminatedWeek}` : ''}
                        {latestPick?.pick ? ` · ${latestPick.pick.teamShortName}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.compactChevron}>{isOpen ? '▲' : '▼'}</Text>
                  </TouchableOpacity>

                  {isOpen ? (
                    <View style={styles.compactExpanded}>
                      {compQuery.data?.lifelineEnabled ? (
                        <Text style={styles.compactLine}>Lifeline: <Text style={{ color: item.lifelineUsed ? '#fcd34d' : '#86efac' }}>{item.lifelineUsed ? `Used${item.lifelineUsedWeek ? ` · GW${item.lifelineUsedWeek}` : ''}` : 'Available'}</Text></Text>
                      ) : null}
                      <Text style={styles.compactLine}>Last resolved pick: <Text style={{ color: '#e2e8f0' }}>{latestPick?.pick ? `${latestPick.pick.teamShortName} (${latestPick.pick.outcome})` : '—'}</Text></Text>
                    </View>
                  ) : null}
                </View>
              );
            }}
            ListEmptyComponent={<Text style={styles.meta}>No participants found.</Text>}
          />
        ) : null}

        {!isLoading && !error && mobileMode === 'table' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableShell}>
            <View>
              <View style={styles.tableHeaderRow}>
                <View style={styles.participantHeaderCell}><Text style={styles.headerText}>Participant</Text></View>
                {gameweeks.map((gw) => (
                  <View key={gw.weekNumber} style={styles.gwHeaderCell}>
                    <Text style={styles.headerText}>GW{gw.weekNumber}</Text>
                    <Text style={[styles.gwStatusText, gw.status === 'COMPLETED' ? styles.gwComplete : gw.status === 'IN_PROGRESS' ? styles.gwLive : gw.status === 'LOCKED' ? styles.gwLocked : styles.gwUpcoming]}>{gw.status}</Text>
                  </View>
                ))}
              </View>

              {paginated.length === 0 ? <Text style={[styles.meta, { padding: 12 }]}>No participants found.</Text> : null}

              {paginated.map((row) => (
                <View key={`${row.userId}-${row.entryNumber ?? 1}`} style={styles.tableDataRow}>
                  <View style={styles.participantCell}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.participantName} numberOfLines={1}>{displayName(row)}</Text>
                      {row.status === 'WINNER' ? <Text>🏆</Text> : null}
                      {row.status === 'ELIMINATED' && row.eliminatedWeek ? <Text style={styles.elimWeekText}>GW{row.eliminatedWeek}</Text> : null}
                    </View>
                    {compQuery.data?.lifelineEnabled ? (
                      <Text style={[styles.lifelineMeta, row.lifelineUsed ? styles.lifelineUsed : styles.lifelineAvail]}>
                        {row.lifelineUsed ? `Lifeline used${row.lifelineUsedWeek ? ` · GW${row.lifelineUsedWeek}` : ''}` : 'Lifeline available'}
                      </Text>
                    ) : null}
                  </View>

                  {gameweeks.map((gw) => {
                    const pick = row.picks[gw.weekNumber] as (typeof row.picks[number] & { useLifeline?: boolean }) | null;
                    if (gw.status === 'UPCOMING') {
                      return <View key={gw.weekNumber} style={styles.gwCell}><Text style={styles.lockIcon}>🔒</Text></View>;
                    }
                    if (!pick) {
                      const eliminatedBefore = row.eliminatedWeek != null && gw.weekNumber > row.eliminatedWeek;
                      return <View key={gw.weekNumber} style={styles.gwCell}><Text style={styles.noPickText}>{eliminatedBefore ? '—' : 'no pick'}</Text></View>;
                    }
                    const tone = cellStyle(pick.outcome);
                    const label = outcomeLabel(pick.outcome);
                    const symbol = outcomeSymbol(pick.outcome);
                    return (
                      <View key={gw.weekNumber} style={styles.gwCell}>
                        <View style={[styles.pickBadge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                          <Text style={[styles.pickBadgeText, { color: tone.text }]}>{pick.teamShortName}</Text>
                        </View>
                        {String(pick.outcome ?? '').toUpperCase() !== 'PENDING' ? (
                          <View style={[styles.outcomeChip, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                            <Text style={[styles.outcomeChipText, { color: tone.text }]}>{symbol ? `${symbol} ` : ''}{label}</Text>
                          </View>
                        ) : null}
                        {pick.source === 'AUTO' ? <Text style={styles.autoTag}>auto</Text> : null}
                        {pick.useLifeline ? <Text style={styles.cellTag}>lifeline</Text> : null}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        ) : null}

        {!isLoading && !error && mobileMode === 'table' ? <SurvivorLegend /> : null}

        {!isLoading && !error && totalPages > 1 ? (
          <View style={styles.paginationRow}>
            <TouchableOpacity style={styles.pageBtn} onPress={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}><Text style={styles.pageBtnText}>← Prev</Text></TouchableOpacity>
            <Text style={styles.pageInfo}>Page {currentPage} / {totalPages}</Text>
            <TouchableOpacity style={styles.pageBtn} onPress={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}><Text style={styles.pageBtnText}>Next →</Text></TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function SurvivorLegend() {
  return (
    <View style={styles.legendCard}>
      <LegendItem label="Advanced" sample="Advanced" tone="success" />
      <LegendItem label="Eliminated" sample="Out" tone="danger" />
      <LegendItem label="Postponed / Bye" sample="Postponed" tone="warn" />
      <LegendItem label="Pending" sample="LIV" tone="neutral" />
      <View style={styles.legendItem}><Text style={styles.legendLock}>🔒</Text><Text style={styles.legendText}>Picks hidden (not yet locked)</Text></View>
      <View style={styles.legendItem}><Text style={styles.legendAuto}>auto</Text><Text style={styles.legendText}>Auto-picked</Text></View>
      <View style={styles.legendItem}><Text style={styles.legendLife}>lifeline</Text><Text style={styles.legendText}>Lifeline used on pick</Text></View>
    </View>
  );
}

function LegendItem({ label, sample, tone }: { label: string; sample: string; tone: 'success' | 'danger' | 'warn' | 'neutral' }) {
  const color = tone === 'success' ? '#86efac' : tone === 'danger' ? '#fca5a5' : tone === 'warn' ? '#fcd34d' : '#cbd5e1';
  const bg = tone === 'success' ? '#22c55e22' : tone === 'danger' ? '#ef444422' : tone === 'warn' ? '#f59e0b22' : '#33415566';
  return (
    <View style={styles.legendItem}>
      <Text style={[styles.legendSample, { color, backgroundColor: bg }]}>{sample}</Text>
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.screen },
  hero: {
    borderWidth: 1,
    borderColor: '#ffffff1f',
    borderRadius: 26,
    backgroundColor: '#0f172a',
    padding: 16,
    marginBottom: 10,
  },
  backLink: { color: '#93c5fd', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.1 },
  heroStats: { flexDirection: 'row', gap: 8, marginTop: 10 },
  heroStatCard: { flex: 1, borderWidth: 1, borderColor: '#ffffff1f', borderRadius: 12, backgroundColor: '#ffffff0c', paddingVertical: 8, alignItems: 'center' },
  heroStatValue: { fontWeight: '800', fontSize: 15 },
  heroStatLabel: { color: colors.textMuted, fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.6 },

  searchInput: { borderWidth: 1, borderColor: '#33415599', backgroundColor: '#0b1220', color: colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  modeRow: { marginTop: 8, flexDirection: 'row', gap: 8 },
  modeBtn: { flex: 1, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  modeBtnActive: { borderColor: '#0ea5e980', backgroundColor: '#0ea5e922' },
  modeBtnText: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  modeBtnTextActive: { color: '#7dd3fc' },
  clearLink: { marginTop: 8, color: '#7dd3fc', textDecorationLine: 'underline', fontSize: 12, fontWeight: '700' },

  resultInfoRow: { marginTop: 8, marginBottom: 6 },
  meta: { color: colors.textMuted, marginTop: 8 },
  error: { color: '#fca5a5', marginTop: 8 },

  compactCard: { borderWidth: 1, borderColor: '#ffffff18', borderRadius: 12, backgroundColor: '#111827', marginBottom: 8 },
  compactHeader: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  compactName: { color: '#f1f5f9', fontSize: 14, fontWeight: '700' },
  compactMeta: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  compactChevron: { color: '#94a3b8', fontSize: 11 },
  compactExpanded: { borderTopWidth: 1, borderTopColor: '#ffffff14', paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#0f172a' },
  compactLine: { color: '#cbd5e1', fontSize: 12, marginTop: 2 },

  tableShell: { marginTop: 6, borderWidth: 1, borderColor: '#ffffff1a', borderRadius: 14, backgroundColor: '#0f172a' },
  tableHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#334155aa' },
  participantHeaderCell: { width: 190, minHeight: 52, justifyContent: 'center', paddingHorizontal: 10, backgroundColor: '#1f2937' },
  gwHeaderCell: { width: 96, minHeight: 52, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6, backgroundColor: '#1f2937' },
  headerText: { color: '#e2e8f0', fontSize: 12, fontWeight: '700' },
  gwStatusText: { marginTop: 2, fontSize: 10, fontWeight: '600' },
  gwComplete: { color: '#4ade80' },
  gwLive: { color: '#facc15' },
  gwLocked: { color: '#60a5fa' },
  gwUpcoming: { color: '#94a3b8' },

  tableDataRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#233145' },
  participantCell: { width: 190, paddingHorizontal: 10, paddingVertical: 9, backgroundColor: '#111827' },
  participantName: { color: '#f8fafc', fontSize: 12, fontWeight: '700', flexShrink: 1 },
  elimWeekText: { color: '#fca5a5', fontSize: 10, fontWeight: '700' },
  lifelineMeta: { marginTop: 4, fontSize: 9, fontWeight: '600', borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  lifelineUsed: { color: '#fde68a', borderColor: '#f59e0b55', backgroundColor: '#f59e0b22' },
  lifelineAvail: { color: '#86efac', borderColor: '#22c55e55', backgroundColor: '#22c55e22' },

  gwCell: { width: 96, minHeight: 62, justifyContent: 'center', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6 },
  lockIcon: { color: '#64748b', fontSize: 13 },
  noPickText: { color: '#94a3b8', fontSize: 10, fontStyle: 'italic' },
  pickBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pickBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
  cellTag: { marginTop: 4, color: '#67e8f9', fontSize: 9, fontWeight: '700' },
  autoTag: { marginTop: 4, overflow: 'hidden', borderRadius: 999, backgroundColor: '#1f2937', color: '#94a3b8', fontSize: 9, fontWeight: '700', fontStyle: 'italic', paddingHorizontal: 6, paddingVertical: 2 },
  outcomeChip: { marginTop: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  outcomeChipText: { fontSize: 9, fontWeight: '800' },

  legendCard: { marginTop: 10, borderWidth: 1, borderColor: '#ffffff1a', borderRadius: 12, backgroundColor: '#111827', padding: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 6 },
  legendSample: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 10, fontWeight: '800' },
  legendText: { color: '#94a3b8', fontSize: 11, fontWeight: '600' },
  legendLock: { color: '#64748b', fontSize: 13 },
  legendAuto: { overflow: 'hidden', borderRadius: 999, backgroundColor: '#1f2937', color: '#94a3b8', fontSize: 9, fontWeight: '700', fontStyle: 'italic', paddingHorizontal: 6, paddingVertical: 2 },
  legendLife: { overflow: 'hidden', borderRadius: 999, backgroundColor: '#06b6d433', color: '#67e8f9', fontSize: 9, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2 },

  paginationRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pageBtn: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#1f2937', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  pageBtnText: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  pageInfo: { color: '#94a3b8', fontSize: 12 },
});
