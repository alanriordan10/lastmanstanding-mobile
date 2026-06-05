import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import type { Competition, Fixture, GameweekSelection, GameweekSelectionsData } from '../types';
import { Card, MetaText, ScreenTitle, SectionTitle, StatusPill } from '../components/ui';
import { colors, spacing } from '../theme/tokens';

type PickStat = {
  teamId?: number;
  teamName?: string;
  teamShortName: string;
  pickCount: number;
  percentage?: number;
};

type ViewMode = 'cards' | 'table' | 'byteam' | 'compact';
type OutcomeFilter = 'ALL' | 'ADVANCE' | 'ELIMINATED' | 'PENDING';

function outcomeTone(outcome: string) {
  if (outcome === 'ELIMINATED') return 'danger' as const;
  if (outcome === 'PENDING') return 'warn' as const;
  return 'success' as const;
}

function outcomeLabel(outcome: string) {
  if (outcome === 'ADVANCE') return 'Advance';
  if (outcome === 'POSTPONED_ADVANCE') return 'PP Advance';
  if (outcome === 'ELIMINATED') return 'Out';
  if (outcome === 'PENDING') return 'Pending';
  return outcome;
}

function fixtureScore(fixture?: Fixture) {
  if (!fixture) return '-';
  if (fixture.status === 'FINISHED') return `${fixture.scoreHome ?? '-'}-${fixture.scoreAway ?? '-'}`;
  if (fixture.status === 'POSTPONED' || fixture.status === 'CANCELLED') return 'PP';
  return '-';
}

export default function GameweekResultsScreen() {
  const params = useLocalSearchParams<{ id: string; gwId: string }>();
  const compId = Number(params.id);
  const gameweekId = Number(params.gwId);
  const [search, setSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('ALL');
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [expandedCompactRows, setExpandedCompactRows] = useState<Set<string>>(new Set());

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

  const fixturesQuery = useQuery({
    queryKey: ['gameweek-results-fixtures', compId, gameweekId],
    queryFn: async () => (await api.get<Fixture[]>(`/competitions/${compId}/gameweeks/${gameweekId}/fixtures`)).data ?? [],
    enabled: Number.isFinite(compId) && Number.isFinite(gameweekId),
  });

  const pickStatsQuery = useQuery({
    queryKey: ['gameweek-results-pick-stats', compId, gameweekId],
    queryFn: async () => (await api.get<PickStat[]>(`/competitions/${compId}/gameweeks/${gameweekId}/pick-stats`)).data ?? [],
    enabled: Number.isFinite(compId) && Number.isFinite(gameweekId),
  });

  useEffect(() => {
    setExpandedCompactRows(new Set());
  }, [search, outcomeFilter, viewMode]);

  const selections = data?.selections ?? [];
  const fixtures = fixturesQuery.data ?? [];
  const comp = compQuery.data;
  const weekNumber = fixtures[0]?.weekNumber || data?.weekNumber || 'N/A';

  const userEntryCounts = useMemo(() => {
    const counts = new Map<number, number>();
    selections.forEach((s) => counts.set(s.userId, (counts.get(s.userId) ?? 0) + 1));
    return counts;
  }, [selections]);

  const displayName = (s: GameweekSelection) => (userEntryCounts.get(s.userId) ?? 0) > 1
    ? `${s.username} • Entry #${s.entryNumber ?? 1}`
    : s.username;

  const fixtureByTeam = useMemo(() => {
    const map = new Map<number, Fixture>();
    fixtures.forEach((fixture) => {
      map.set(fixture.homeTeamId, fixture);
      map.set(fixture.awayTeamId, fixture);
    });
    return map;
  }, [fixtures]);

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
  const lifelineUsedCount = selections.filter((s) => s.lifelineUsed).length;
  const lifelineRemainingCount = selections.filter((s) => !s.lifelineUsed).length;
  const allEliminated = selections.length > 0 && eliminated.length === selections.length;

  const filtered = useMemo(() => {
    let rows = selections;
    if (outcomeFilter === 'ADVANCE') rows = advanced;
    if (outcomeFilter === 'ELIMINATED') rows = eliminated;
    if (outcomeFilter === 'PENDING') rows = pending;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => displayName(r).toLowerCase().includes(q) || r.teamName.toLowerCase().includes(q) || r.teamShortName.toLowerCase().includes(q));
    }
    return rows;
  }, [selections, advanced, eliminated, pending, outcomeFilter, search, userEntryCounts]);

  const byTeam = useMemo(() => {
    return filtered.reduce((acc, sel) => {
      const key = sel.teamShortName;
      if (!acc[key]) acc[key] = [];
      acc[key].push(sel);
      return acc;
    }, {} as Record<string, GameweekSelection[]>);
  }, [filtered]);

  const toggleCompactRow = (id: string) => {
    setExpandedCompactRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderSelectionCard = (s: GameweekSelection, idx: number) => {
    const fixture = fixtureByTeam.get(s.teamId);
    const isHome = fixture?.homeTeamId === s.teamId;
    const opponent = isHome ? fixture?.awayTeamShortName : fixture?.homeTeamShortName;
    const stat = getPickStat(s.teamId, s.teamShortName, s.teamName);
    return (
      <View key={`${s.participantId ?? s.userId}-${s.teamId}-${idx}`} style={[styles.selectionCard, s.outcome === 'ELIMINATED' ? styles.selectionCardOut : s.outcome === 'PENDING' ? styles.selectionCardPending : styles.selectionCardAdvance]}>
        <View style={styles.selectionCardHeader}>
          <Text style={styles.cardName}>{displayName(s)}</Text>
          <StatusPill text={outcomeLabel(s.outcome)} tone={outcomeTone(s.outcome)} />
        </View>
        <View style={styles.detailRow}><Text style={styles.detailLabel}>Picked</Text><Text style={styles.detailValue}>{s.teamShortName}{s.source === 'AUTO' ? ' (auto)' : ''}</Text></View>
        {opponent ? <View style={styles.detailRow}><Text style={styles.detailLabel}>Vs</Text><Text style={styles.detailValue}>{opponent}</Text></View> : null}
        <View style={styles.detailRow}><Text style={styles.detailLabel}>Score</Text><Text style={styles.detailValue}>{fixtureScore(fixture)}</Text></View>
        {stat ? <View style={styles.detailRow}><Text style={styles.detailLabel}>Pick share</Text><Text style={styles.pickPercentChip}>{stat.percentage}% · {stat.pickCount} {stat.pickCount === 1 ? 'player' : 'players'}</Text></View> : null}
        {comp?.lifelineEnabled ? <View style={styles.detailRow}><Text style={styles.detailLabel}>Lifeline</Text><Text style={s.lifelineUsed ? styles.lifelineUsed : styles.lifelineAvailable}>{s.lifelineUsed ? `Used${s.lifelineUsedWeek ? ` · GW${s.lifelineUsedWeek}` : ''}` : 'Available'}</Text></View> : null}
      </View>
    );
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <ScrollView refreshControl={<RefreshControl refreshing={isRefetching || pickStatsQuery.isRefetching || fixturesQuery.isRefetching} onRefresh={() => void Promise.all([refetch(), pickStatsQuery.refetch(), fixturesQuery.refetch()])} tintColor={colors.brand} />}>
        <View style={styles.hero}>
          <MetaText>{comp?.name ?? 'Competition'}</MetaText>
          <ScreenTitle>Gameweek {weekNumber} Results</ScreenTitle>
          <MetaText>{selections.length} pick{selections.length === 1 ? '' : 's'} processed for this round</MetaText>
          {comp?.lifelineEnabled ? <MetaText>Lifeline status: {lifelineRemainingCount} available · {lifelineUsedCount} used</MetaText> : null}
        </View>

        {selections.length > 0 ? (
          <View style={styles.summaryGrid}>
            <ResultStatTile icon="🎯" label="Picked" value={String(selections.length)} active={outcomeFilter === 'ALL'} tone="neutral" onPress={() => setOutcomeFilter('ALL')} />
            <ResultStatTile icon="✓" label="Advanced" value={String(advanced.length)} active={outcomeFilter === 'ADVANCE'} tone="success" onPress={() => setOutcomeFilter(outcomeFilter === 'ADVANCE' ? 'ALL' : 'ADVANCE')} />
            <ResultStatTile icon="✕" label="Eliminated" value={String(eliminated.length)} active={outcomeFilter === 'ELIMINATED'} tone="danger" onPress={() => setOutcomeFilter(outcomeFilter === 'ELIMINATED' ? 'ALL' : 'ELIMINATED')} />
            <ResultStatTile icon="…" label="Pending" value={String(pending.length)} active={outcomeFilter === 'PENDING'} tone="warn" onPress={() => setOutcomeFilter(outcomeFilter === 'PENDING' ? 'ALL' : 'PENDING')} />
          </View>
        ) : null}

        {data?.byeGranted ? (
          <Card>
            <SectionTitle>All Participants Granted Bye</SectionTitle>
            <MetaText>All remaining participants would have been eliminated in this gameweek, so everyone advanced to keep the competition fair.</MetaText>
          </Card>
        ) : null}

        {allEliminated && !data?.byeGranted ? (
          <Card>
            <SectionTitle>All Participants Eliminated</SectionTitle>
            <MetaText>All remaining participants were eliminated in this gameweek.</MetaText>
          </Card>
        ) : null}

        <Card>
          <TextInput value={search} onChangeText={setSearch} placeholder="Search participants" placeholderTextColor={colors.textMuted} style={styles.input} />
          <View style={styles.modeRow}>
            {([
              ['cards', '📇 Cards'],
              ['table', '📊 Table'],
              ['byteam', '👥 By Team'],
              ['compact', '📱 Compact'],
            ] as const).map(([mode, label]) => (
              <TouchableOpacity key={mode} onPress={() => setViewMode(mode)} style={[styles.modeButton, viewMode === mode ? styles.modeButtonActive : null]}>
                <Text style={[styles.modeButtonText, viewMode === mode ? styles.modeButtonTextActive : null]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {outcomeFilter !== 'ALL' || search.trim() ? <MetaText>Showing {filtered.length} of {selections.length} participants</MetaText> : null}
        </Card>

        {isLoading ? <Text style={styles.meta}>Loading...</Text> : null}
        {error ? <Text style={styles.error}>Failed to load results</Text> : null}

        {viewMode === 'cards' ? (
          <Card>
            <SectionTitle>Results</SectionTitle>
            <View style={styles.cardsGrid}>{filtered.map(renderSelectionCard)}</View>
            {filtered.length === 0 ? <MetaText>No participants found.</MetaText> : null}
          </Card>
        ) : null}

        {viewMode === 'table' ? (
          <Card>
            <SectionTitle>Results Table</SectionTitle>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableShell}>
              <View>
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.tableHeaderCell, styles.tableParticipantCell]}>Participant</Text>
                  <Text style={styles.tableHeaderCell}>Pick</Text>
                  <Text style={styles.tableHeaderCell}>Opponent</Text>
                  <Text style={styles.tableHeaderCell}>Score</Text>
                  <Text style={styles.tableHeaderCell}>Type</Text>
                  {comp?.lifelineEnabled ? <Text style={styles.tableHeaderCell}>Lifeline</Text> : null}
                  <Text style={styles.tableHeaderCell}>Outcome</Text>
                </View>
                {filtered.map((s, idx) => {
                  const fixture = fixtureByTeam.get(s.teamId);
                  const isHome = fixture?.homeTeamId === s.teamId;
                  const opponent = isHome ? fixture?.awayTeamShortName : fixture?.homeTeamShortName;
                  return (
                    <View key={`${s.participantId ?? s.userId}-${s.teamId}-${idx}`} style={styles.tableRow}>
                      <Text style={[styles.tableCell, styles.tableParticipantCell]}>{displayName(s)}</Text>
                      <Text style={styles.tableCell}>{s.teamShortName}</Text>
                      <Text style={styles.tableCell}>{opponent || '—'}</Text>
                      <Text style={styles.tableCell}>{fixtureScore(fixture)}</Text>
                      <Text style={styles.tableCell}>{s.source === 'AUTO' ? 'Auto' : 'Self'}{s.useLifeline ? ' · LL' : ''}</Text>
                      {comp?.lifelineEnabled ? <Text style={styles.tableCell}>{s.lifelineUsed ? `Used${s.lifelineUsedWeek ? ` GW${s.lifelineUsedWeek}` : ''}` : 'Available'}</Text> : null}
                      <Text style={[styles.tableCell, s.outcome === 'ELIMINATED' ? styles.outcomeOut : s.outcome === 'PENDING' ? styles.outcomePending : styles.outcomeAdvance]}>{outcomeLabel(s.outcome)}</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
            {filtered.length === 0 ? <MetaText>No participants found.</MetaText> : null}
          </Card>
        ) : null}

        {viewMode === 'byteam' ? (
          <Card>
            <SectionTitle>By Team</SectionTitle>
            {Object.entries(byTeam).sort(([a], [b]) => a.localeCompare(b)).map(([teamName, picks]) => {
              const fixture = fixtures.find((f) => f.homeTeamShortName === teamName || f.awayTeamShortName === teamName);
              const result = fixture?.status === 'FINISHED' ? `${fixture.scoreHome}-${fixture.scoreAway}` : fixture?.status === 'POSTPONED' ? 'POSTPONED' : 'Scheduled';
              const stat = picks[0] ? getPickStat(picks[0].teamId, picks[0].teamShortName, picks[0].teamName) : null;
              return (
                <View key={teamName} style={styles.teamGroup}>
                  <View style={styles.teamGroupHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.teamGroupTitle}>{teamName}</Text>
                      <MetaText>{fixture ? `${fixture.homeTeamShortName} vs ${fixture.awayTeamShortName} · ${result}` : 'Fixture unavailable'}</MetaText>
                    </View>
                    <Text style={styles.teamGroupCount}>{stat?.percentage ?? 0}% · {picks.length} pick{picks.length === 1 ? '' : 's'}</Text>
                  </View>
                  <View style={styles.teamPicksWrap}>
                    {picks.map((sel, idx) => (
                      <Text key={`${sel.participantId ?? sel.userId}-${idx}`} style={[styles.teamPickChip, sel.outcome === 'ELIMINATED' ? styles.teamPickChipOut : sel.outcome === 'PENDING' ? styles.teamPickChipPending : styles.teamPickChipAdvance]}>
                        {displayName(sel)}{sel.source === 'AUTO' ? ' (auto)' : ''}{sel.useLifeline ? ' (lifeline)' : ''}
                      </Text>
                    ))}
                  </View>
                </View>
              );
            })}
            {Object.keys(byTeam).length === 0 ? <MetaText>No participants found.</MetaText> : null}
          </Card>
        ) : null}

        {viewMode === 'compact' ? (
          <Card>
            <SectionTitle>Compact Results</SectionTitle>
            {filtered.map((s, idx) => {
              const rowId = `${s.participantId ?? s.userId}-${s.teamId}-${idx}`;
              const isOpen = expandedCompactRows.has(rowId);
              const fixture = fixtureByTeam.get(s.teamId);
              const isHome = fixture?.homeTeamId === s.teamId;
              const opponent = isHome ? fixture?.awayTeamShortName : fixture?.homeTeamShortName;
              return (
                <View key={rowId} style={styles.compactRow}>
                  <TouchableOpacity style={styles.compactHeader} onPress={() => toggleCompactRow(rowId)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.compactName}>{displayName(s)}</Text>
                      <MetaText>Picked {s.teamShortName}</MetaText>
                    </View>
                    <StatusPill text={outcomeLabel(s.outcome)} tone={outcomeTone(s.outcome)} />
                    <Text style={styles.compactChevron}>{isOpen ? '▲' : '▼'}</Text>
                  </TouchableOpacity>
                  {isOpen ? (
                    <View style={styles.compactBody}>
                      <Text style={styles.compactLine}>Opponent: <Text style={styles.compactValue}>{opponent || '—'}</Text></Text>
                      <Text style={styles.compactLine}>Score: <Text style={styles.compactValue}>{fixtureScore(fixture)}</Text></Text>
                      <Text style={styles.compactLine}>Pick type: <Text style={styles.compactValue}>{s.source === 'AUTO' ? 'Auto' : 'Self'}{s.useLifeline ? ' · Lifeline' : ''}</Text></Text>
                      {comp?.lifelineEnabled ? <Text style={styles.compactLine}>Lifeline: <Text style={s.lifelineUsed ? styles.lifelineUsed : styles.lifelineAvailable}>{s.lifelineUsed ? `Used${s.lifelineUsedWeek ? ` · GW${s.lifelineUsedWeek}` : ''}` : 'Available'}</Text></Text> : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
            {filtered.length === 0 ? <MetaText>No participants found.</MetaText> : null}
          </Card>
        ) : null}

        {fixtures.length > 0 ? (
          <Card>
            <SectionTitle>Fixtures</SectionTitle>
            {fixtures.map((f) => (
              <View key={f.id} style={styles.fixtureRow}>
                <Text style={styles.fixtureTeam}>{f.homeTeamShortName}</Text>
                <Text style={styles.fixtureScore}>{fixtureScore(f)}</Text>
                <Text style={[styles.fixtureTeam, { textAlign: 'right' }]}>{f.awayTeamShortName}</Text>
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}


function ResultStatTile({ icon, label, value, active, tone, onPress, wide }: { icon: string; label: string; value: string; active: boolean; tone: 'neutral' | 'success' | 'danger' | 'warn'; onPress: () => void; wide?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.summaryTile, wide ? styles.summaryTileWide : null, active ? styles.summaryTileActive : null, tone === 'success' ? styles.summaryTileSuccess : tone === 'danger' ? styles.summaryTileDanger : tone === 'warn' ? styles.summaryTileWarn : null]}>
      <Text style={styles.summaryIcon}>{icon}</Text>
      <Text style={[styles.summaryValue, tone === 'success' ? styles.summaryValueSuccess : tone === 'danger' ? styles.summaryValueDanger : tone === 'warn' ? styles.summaryValueWarn : null]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.screen },
  hero: { borderWidth: 1, borderColor: '#ffffff1a', borderRadius: 18, backgroundColor: '#111827', padding: 14, marginBottom: 8 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'nowrap', gap: 3, marginBottom: 8 },
  summaryTile: { flex: 1, flexShrink: 1, minWidth: 0, minHeight: 70, borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#111827', borderRadius: 12, paddingHorizontal: 3, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
  summaryTileWide: {},
  summaryTileActive: { borderColor: '#94a3b8', backgroundColor: '#64748b1a' },
  summaryTileSuccess: { borderColor: '#22c55e33', backgroundColor: '#22c55e0d' },
  summaryTileDanger: { borderColor: '#ef444433', backgroundColor: '#ef44440d' },
  summaryTileWarn: { borderColor: '#f59e0b33', backgroundColor: '#f59e0b0d' },
  summaryIcon: { fontSize: 13, marginBottom: 2 },
  summaryValue: { color: '#e5e7eb', fontSize: 18, fontWeight: '900' },
  summaryValueSuccess: { color: '#4ade80' },
  summaryValueDanger: { color: '#f87171' },
  summaryValueWarn: { color: '#facc15' },
  summaryLabel: { color: '#94a3b8', fontSize: 8, fontWeight: '800', marginTop: 1 },
  input: { backgroundColor: colors.panelSoft, color: colors.text, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10 },
  modeRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: 3, marginTop: 12 },
  modeButton: { flex: 1, flexShrink: 1, minWidth: 0, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a', borderRadius: 9, paddingHorizontal: 3, paddingVertical: 7, alignItems: 'center' },
  modeButtonActive: { borderColor: '#38bdf8', backgroundColor: '#0ea5e933' },
  modeButtonText: { color: '#94a3b8', fontSize: 9, fontWeight: '900' },
  modeButtonTextActive: { color: '#e0f2fe' },
  cardsGrid: { gap: 10, marginTop: 8 },
  selectionCard: { borderWidth: 1, borderRadius: 14, padding: 12 },
  selectionCardAdvance: { borderColor: '#22c55e55', backgroundColor: '#22c55e0d' },
  selectionCardOut: { borderColor: '#ef444455', backgroundColor: '#ef44440d' },
  selectionCardPending: { borderColor: '#f59e0b55', backgroundColor: '#f59e0b0d' },
  selectionCardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', marginBottom: 8 },
  cardName: { color: colors.text, fontSize: 14, fontWeight: '900', flex: 1 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 5 },
  detailLabel: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  detailValue: { color: '#e5e7eb', fontSize: 12, fontWeight: '800' },
  pickPercentChip: { overflow: 'hidden', borderRadius: 999, backgroundColor: '#ffffff14', color: '#d1d5db', fontSize: 10, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 3 },
  lifelineUsed: { color: '#fcd34d', fontSize: 12, fontWeight: '900' },
  lifelineAvailable: { color: '#86efac', fontSize: 12, fontWeight: '900' },
  tableShell: { marginTop: 8, borderWidth: 1, borderColor: '#253247', borderRadius: 12, backgroundColor: '#0f172a' },
  tableHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#334155' },
  tableHeaderCell: { width: 92, color: '#94a3b8', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', padding: 9 },
  tableParticipantCell: { width: 180 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  tableCell: { width: 92, color: '#e5e7eb', fontSize: 12, fontWeight: '700', padding: 9 },
  outcomeAdvance: { color: '#86efac' },
  outcomeOut: { color: '#fca5a5' },
  outcomePending: { color: '#fcd34d' },
  teamGroup: { borderWidth: 1, borderColor: '#253247', backgroundColor: '#0f172a', borderRadius: 14, padding: 12, marginTop: 10 },
  teamGroupHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' },
  teamGroupTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  teamGroupCount: { color: '#94a3b8', fontSize: 12, fontWeight: '800' },
  teamPicksWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  teamPickChip: { overflow: 'hidden', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '800' },
  teamPickChipAdvance: { backgroundColor: '#22c55e22', color: '#86efac' },
  teamPickChipOut: { backgroundColor: '#ef444422', color: '#fca5a5' },
  teamPickChipPending: { backgroundColor: '#f59e0b22', color: '#fcd34d' },
  compactRow: { borderWidth: 1, borderColor: '#253247', backgroundColor: '#0f172a', borderRadius: 12, marginTop: 8, overflow: 'hidden' },
  compactHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  compactName: { color: colors.text, fontSize: 13, fontWeight: '900' },
  compactChevron: { color: '#94a3b8', fontSize: 11, fontWeight: '900' },
  compactBody: { borderTopWidth: 1, borderTopColor: '#253247', padding: 10, gap: 4 },
  compactLine: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  compactValue: { color: '#e5e7eb' },
  fixtureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#253247', backgroundColor: '#0f172a', borderRadius: 12, padding: 10, marginTop: 8 },
  fixtureTeam: { flex: 1, color: '#e5e7eb', fontSize: 13, fontWeight: '900' },
  fixtureScore: { minWidth: 58, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: '900' },
  meta: { color: colors.textMuted, marginTop: 8 },
  error: { color: '#fca5a5', marginTop: 8 },
});
