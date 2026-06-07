import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api } from '../api/client';
import type { MyCompetition } from '../types';
import { Card, FilterPill, MetaText, ScreenTitle, StatusPill } from '../components/ui';
import { colors, spacing } from '../theme/tokens';

type MineFilter = 'ALL' | 'NEEDS_ACTION' | 'UPCOMING' | 'ACTIVE' | 'ELIMINATED' | 'FINISHED';

function needsAction(mc: MyCompetition): boolean {
  return mc.paymentState === 'AWAITING_PAYMENT' || mc.pickRequired === true;
}

function toneForStatus(status: string) {
  if (status === 'ACTIVE') return 'success' as const;
  if (status === 'WINNER') return 'brand' as const;
  return 'danger' as const;
}

function SectionHeader({ label, count, open, onToggle }: { label: string; count: number; open: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity style={[styles.sectionHeader, open ? styles.sectionHeaderOpen : null]} onPress={onToggle} activeOpacity={0.85}>
      <View style={styles.sectionHeaderCopy}>
        <Text style={styles.sectionKicker}>Section</Text>
        <Text style={styles.sectionTitle}>{label}</Text>
        <Text style={styles.sectionMeta}>{count} entr{count === 1 ? 'y' : 'ies'}</Text>
      </View>
      <View style={[styles.sectionChevronBox, open ? styles.sectionChevronBoxOpen : null]}>
        <Text style={styles.sectionChevron}>{open ? '▲' : '▼'}</Text>
      </View>
    </TouchableOpacity>
  );
}

function Row({ mc, onOpen, showEntryLabel }: { mc: MyCompetition; onOpen: () => void; showEntryLabel: boolean }) {
  const comp = mc.competition;
  return (
    <TouchableOpacity onPress={onOpen}>
      <View style={styles.rowCard}>
        <View style={styles.rowTop}>
          <StatusPill text={mc.myStatus} tone={toneForStatus(mc.myStatus)} />
          {mc.paymentState === 'AWAITING_PAYMENT' ? <StatusPill text="Awaiting Payment" tone="warn" /> : null}
          <StatusPill text={comp.status} tone={comp.status === 'ACTIVE' ? 'success' : comp.status === 'UPCOMING' ? 'brand' : 'neutral'} />
        </View>
        <Text style={styles.rowTitle}>{comp.name}</Text>
        <Text style={styles.rowMeta}>
          {showEntryLabel && mc.entryNumber ? `Entry #${mc.entryNumber}` : ''}
          {showEntryLabel && mc.entryNumber && (mc.eliminatedWeek || comp.paymentMode) ? ' · ' : ''}
          {mc.eliminatedWeek ? `Out GW${mc.eliminatedWeek}` : ''}
          {mc.eliminatedWeek && comp.paymentMode ? ' · ' : ''}
          {comp.paymentMode ? `${comp.paymentMode}` : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function MyCompetitionsScreen() {
  const router = useRouter();
  const [mineFilter, setMineFilter] = useState<MineFilter>('ALL');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    needsAction: false,
    upcoming: false,
    active: false,
    eliminated: false,
    finished: false,
  });


  useEffect(() => {
    const saved = globalThis?.localStorage?.getItem('lms.mobile.myCompetitions.filter');
    if (!saved) return;
    const allowed = new Set(['ALL', 'NEEDS_ACTION', 'UPCOMING', 'ACTIVE', 'ELIMINATED', 'FINISHED']);
    if (allowed.has(saved)) setMineFilter(saved as MineFilter);
    else if (saved === 'PICK_DUE' || saved === 'AWAITING_PAYMENT') setMineFilter('NEEDS_ACTION');
  }, []);

  useEffect(() => {
    try {
      globalThis?.localStorage?.setItem('lms.mobile.myCompetitions.filter', mineFilter);
    } catch {}
  }, [mineFilter]);
  const { data, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: ['competitions-my-details'],
    queryFn: async () => (await api.get<MyCompetition[]>('/competitions/my/details')).data ?? [],
  });

  const all = data ?? [];
  const entriesByCompetition = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of all) {
      map.set(item.competition.id, (map.get(item.competition.id) ?? 0) + 1);
    }
    return map;
  }, [all]);

  const mineNeedsAction = useMemo(() => all.filter((mc) => needsAction(mc)), [all]);
  const mineUpcoming = useMemo(() => all.filter((mc) => mc.competition.status === 'UPCOMING' && mc.myStatus === 'ACTIVE' && !needsAction(mc)), [all]);
  const mineActive = useMemo(() => all.filter((mc) => mc.competition.status === 'ACTIVE' && mc.myStatus === 'ACTIVE'), [all]);
  const mineEliminated = useMemo(() => all.filter((mc) => mc.competition.status !== 'COMPLETED' && mc.myStatus === 'ELIMINATED'), [all]);
  const mineFinished = useMemo(() => all.filter((mc) => mc.competition.status === 'COMPLETED' || mc.myStatus === 'WINNER'), [all]);

  const showNeedsAction = mineFilter === 'ALL' || mineFilter === 'NEEDS_ACTION';
  const showUpcoming = mineFilter === 'ALL' || mineFilter === 'UPCOMING';
  const showActive = mineFilter === 'ALL' || mineFilter === 'ACTIVE';
  const showEliminated = mineFilter === 'ALL' || mineFilter === 'ELIMINATED';
  const showFinished = mineFilter === 'ALL' || mineFilter === 'FINISHED';

  const isSectionOpen = (key: string) => openSections[key] ?? true;
  const toggleSection = (key: string) => setOpenSections((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  const renderSection = (key: string, label: string, rows: MyCompetition[]) => {
    const open = isSectionOpen(key);
    return (
      <View style={styles.sectionBlock}>
        <SectionHeader label={label} count={rows.length} open={open} onToggle={() => toggleSection(key)} />
        {open && rows.length === 0 ? <Text style={styles.emptySectionText}>No entries in this section.</Text> : null}
        {open ? rows.map((mc) => (
          <Row
            key={`${key}-${mc.competition.id}-${mc.participantId ?? mc.entryNumber ?? mc.joinedAt}`}
            mc={mc}
            showEntryLabel={(entriesByCompetition.get(mc.competition.id) ?? 0) > 1}
            onOpen={() => router.push(`/competitions/${mc.competition.id}`)}
          />
        )) : null}
      </View>
    );
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <View style={styles.hero}>
        <MetaText>My Competitions</MetaText>
        <ScreenTitle>My Competitions</ScreenTitle>
        <View style={styles.heroStats}>
          <View style={styles.heroStatCard}><Text style={styles.heroStatValue}>{all.length}</Text><Text style={styles.heroStatLabel}>Total</Text></View>
          <TouchableOpacity style={styles.heroStatCard} onPress={() => setMineFilter((v) => v === 'UPCOMING' ? 'ALL' : 'UPCOMING')}><Text style={styles.heroStatValue}>{mineUpcoming.length}</Text><Text style={styles.heroStatLabel}>Upcoming</Text></TouchableOpacity>
          <View style={styles.heroStatCard}><Text style={styles.heroStatValue}>{mineActive.length}</Text><Text style={styles.heroStatLabel}>Active</Text></View>
          <View style={styles.heroStatCard}><Text style={styles.heroStatValue}>{mineNeedsAction.length}</Text><Text style={styles.heroStatLabel}>Action</Text></View>
        </View>
      </View>

      <Card>
        <View style={styles.filterRow}>
          {(['ALL', 'NEEDS_ACTION', 'UPCOMING', 'ACTIVE', 'ELIMINATED', 'FINISHED'] as const).map((f) => (
            <FilterPill key={f} label={f === 'NEEDS_ACTION' ? 'ACTION REQUIRED' : f} active={mineFilter === f} onPress={() => setMineFilter(f)} />
          ))}
        </View>
      </Card>

      {isLoading ? <Text style={styles.meta}>Loading competitions...</Text> : null}
      {error ? <Text style={styles.error}>Unable to load your competitions</Text> : null}
      {!isLoading && !error && all.length === 0 ? <Text style={styles.meta}>No joined competitions yet.</Text> : null}

      <FlatList
        data={[{ key: 'content' }]}
        keyExtractor={(item) => item.key}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.brand} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={() => (
          <View style={styles.stack}>
            {showNeedsAction ? renderSection('needsAction', 'Needs Action', mineNeedsAction) : null}
            {showUpcoming ? renderSection('upcoming', 'Upcoming', mineUpcoming) : null}
            {showActive ? renderSection('active', 'Active', mineActive) : null}
            {showEliminated ? renderSection('eliminated', 'Eliminated', mineEliminated) : null}
            {showFinished ? renderSection('finished', 'Finished', mineFinished) : null}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.screen },
  hero: { borderWidth: 1, borderColor: '#ffffff1a', borderRadius: 18, backgroundColor: '#111827', padding: 14 },
  heroStats: { flexDirection: 'row', gap: 8, marginTop: 10 },
  heroStatCard: { flex: 1, borderWidth: 1, borderColor: '#ffffff1a', borderRadius: 12, backgroundColor: '#ffffff0a', paddingVertical: 8, alignItems: 'center' },
  heroStatValue: { color: colors.text, fontWeight: '800', fontSize: 14 },
  heroStatLabel: { color: colors.textMuted, fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.6 },
  meta: { color: colors.textMuted, marginTop: 8 },
  error: { color: '#fca5a5', marginTop: 8 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stack: { gap: 12, marginTop: 8 },
  sectionBlock: { gap: 7 },
  sectionHeader: { marginTop: 2, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#26354d', backgroundColor: '#0b1324', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12, gap: 12 },
  sectionHeaderOpen: { borderColor: '#0ea5e980', backgroundColor: '#0e1b2f' },
  sectionHeaderCopy: { flex: 1, minWidth: 0 },
  sectionKicker: { color: '#7dd3fc', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 3 },
  sectionTitle: { color: '#f8fafc', fontWeight: '900', fontSize: 16 },
  sectionMeta: { color: '#64748b', fontSize: 11, fontWeight: '700', marginTop: 3 },
  sectionChevronBox: { width: 32, height: 32, borderRadius: 11, borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  sectionChevronBoxOpen: { borderColor: '#0ea5e966', backgroundColor: '#0ea5e922' },
  sectionChevron: { color: '#bae6fd', fontSize: 10, fontWeight: '900' },
  emptySectionText: { color: '#94a3b8', borderWidth: 1, borderColor: '#253247', backgroundColor: '#111827', borderRadius: 12, padding: 10, fontSize: 12 },
  rowCard: { borderWidth: 1, borderColor: '#253247', borderRadius: 12, backgroundColor: '#1f2937', padding: 10, marginBottom: 6 },
  rowTop: { flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rowMeta: { color: colors.textMuted, marginTop: 5, fontSize: 13 },
});
