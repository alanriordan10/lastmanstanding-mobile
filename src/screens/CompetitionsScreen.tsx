import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../api/client';
import type { Competition, MyCompetition } from '../types';
import { FilterPill, MetaText, ScreenTitle, StatusPill } from '../components/ui';
import { DataFreshnessBar } from '../components/DataFreshnessBar';
import { colors, spacing } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import * as SecureStore from 'expo-secure-store';

type StatusFilter = 'ALL' | 'UPCOMING' | 'ACTIVE';
type FeeFilter = 'ALL' | 'FREE' | 'PAID';
type SortBy = 'date' | 'players' | 'name';
type StartWindow = 'ALL' | '7' | '14' | '30';
type LandingMode = 'available' | 'mine';
type MineFilter = 'ALL' | 'NEEDS_ACTION' | 'PICK_DUE' | 'AWAITING_PAYMENT' | 'UPCOMING' | 'ACTIVE' | 'ELIMINATED' | 'FINISHED';
type ActivityTone = 'warn' | 'success' | 'danger' | 'brand' | 'neutral';
type ActivityItem = {
  id: string;
  tone: ActivityTone;
  label: string;
  title: string;
  detail: string;
  competitionId: number;
  priority: number;
  dismissible?: boolean;
};

type CompetitionLike = Competition & {
  visibility?: 'PUBLIC' | 'PRIVATE';
  joinCode?: string | null;
  clubName?: string | null;
  clubLogoUrl?: string | null;
  clubPrimaryColor?: string | null;
  clubSecondaryColor?: string | null;
  prizePool?: number | null;
  paymentMode?: string | null;
  missedPickMode?: string | null;
  winnerUsername?: string | null;
};

function isWithinWindow(dateStr?: string | null, windowDays?: number) {
  if (!dateStr || !windowDays) return true;
  const dt = new Date(dateStr);
  if (Number.isNaN(dt.getTime())) return true;
  const now = new Date();
  const end = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
  return dt >= now && dt <= end;
}

function parseDate(dateStr?: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(dateStr?: string | null) {
  const d = parseDate(dateStr);
  if (!d) return 'TBD';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fixtureSourceLabel(comp: CompetitionLike) {
  return comp.fixtureCompetitionCode === 'WC' ? 'World Cup' : 'Premier League';
}

function money(value?: number | null) {
  return value && value > 0 ? `€${value}` : 'Free';
}

function statusLabel(status: Competition['status']) {
  return status === 'COMPLETED' ? 'FINISHED' : status;
}

function statusTone(status: Competition['status']): 'brand' | 'success' | 'neutral' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'UPCOMING') return 'brand';
  return 'neutral';
}

function paymentLabel(comp: CompetitionLike) {
  if ((comp.entryFee ?? 0) <= 0 || comp.paymentMode === 'FREE') return 'Free';
  if (comp.paymentMode === 'MANUAL') return `€${comp.entryFee} to organiser`;
  if (comp.paymentMode === 'STRIPE') return `€${comp.entryFee} online`;
  return `€${comp.entryFee}`;
}

async function readDismissedActivityIds(storageKey: string): Promise<string[]> {
  try {
    const saved = await SecureStore.getItemAsync(storageKey);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    try {
      const saved = globalThis?.localStorage?.getItem(storageKey);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }
}

async function writeDismissedActivityIds(storageKey: string, ids: string[]): Promise<void> {
  const value = JSON.stringify(ids.slice(-200));
  try {
    await SecureStore.setItemAsync(storageKey, value);
  } catch {
    try {
      globalThis?.localStorage?.setItem(storageKey, value);
    } catch {}
  }
}

export default function CompetitionsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [mode, setMode] = useState<LandingMode>('available');
  const [search, setSearch] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [dismissedActivityIds, setDismissedActivityIds] = useState<Set<string>>(() => new Set());
  const [joinCodeStatus, setJoinCodeStatus] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [pendingInviteCompetition, setPendingInviteCompetition] = useState<Competition | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [feeFilter, setFeeFilter] = useState<FeeFilter>('ALL');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [startWindow, setStartWindow] = useState<StartWindow>('ALL');
  const [showFilters, setShowFilters] = useState(false);
  const [mineFilter, setMineFilter] = useState<MineFilter>('ALL');
  const [openAvailableSections, setOpenAvailableSections] = useState<Record<string, boolean>>({
    open: false,
    live: false,
  });
  const [openMineSections, setOpenMineSections] = useState<Record<string, boolean>>({
    needsAction: false,
    active: false,
    upcoming: false,
    eliminated: false,
    finished: false,
  });

  const competitionsQuery = useQuery({
    queryKey: ['competitions-upcoming'],
    queryFn: async () => (await api.get<Competition[]>('/competitions/upcoming')).data,
    refetchInterval: (query) => {
      const rows = query.state.data as Competition[] | undefined;
      return rows?.some((competition) => competition.status === 'ACTIVE') ? 300000 : false;
    },
  });
  const myDetailsQuery = useQuery({
    queryKey: ['competitions-my-details'],
    queryFn: async () => (await api.get<MyCompetition[]>('/competitions/my/details')).data ?? [],
    refetchInterval: (query) => {
      const rows = query.state.data as MyCompetition[] | undefined;
      return rows?.some((row) => row.competition.status === 'ACTIVE') ? 300000 : false;
    },
  });

  useFocusEffect(
    useCallback(() => {
      void competitionsQuery.refetch();
      void myDetailsQuery.refetch();
    }, [competitionsQuery.refetch, myDetailsQuery.refetch]),
  );

  const activityUserId = user?.id ?? user?.userId ?? null;
  const activityDismissStorageKey = activityUserId ? `lms.mobile.dismissedActivity.${activityUserId}` : null;

  useEffect(() => {
    let cancelled = false;
    if (!activityDismissStorageKey) {
      setDismissedActivityIds(new Set());
      return () => { cancelled = true; };
    }

    void readDismissedActivityIds(activityDismissStorageKey).then((ids) => {
      if (!cancelled) setDismissedActivityIds(new Set(ids));
    });

    return () => { cancelled = true; };
  }, [activityDismissStorageKey]);

  const dismissActivity = useCallback((activityId: string) => {
    if (!activityDismissStorageKey) return;
    setDismissedActivityIds((prev) => {
      const next = new Set(prev);
      next.add(activityId);
      void writeDismissedActivityIds(activityDismissStorageKey, [...next]);
      return next;
    });
  }, [activityDismissStorageKey]);


  const joinCodeMutation = useMutation({
    mutationFn: async (code: string) => (await api.get<Competition>(`/competitions/code/${encodeURIComponent(code)}`)).data,
    onSuccess: (competition) => {
      setPendingInviteCompetition(competition);
      setSearch('');
      setMode('available');
      setJoinCodeStatus({ tone: 'info', message: `${competition.name} found. Review details and confirm below.` });
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      const message = error?.response?.data?.message
        ?? error?.response?.data?.error
        ?? (status === 404 ? 'Invite code not found.' : 'Could not join with that invite code.');
      setPendingInviteCompetition(null);
      setJoinCodeStatus({ tone: 'error', message });
    },
  });

  const confirmInviteJoinMutation = useMutation({
    mutationFn: async (competition: Competition) => {
      const requiresOnlinePayment = competition.paymentMode === 'STRIPE' && (competition.entryFee ?? 0) > 0;
      if (!requiresOnlinePayment) {
        await api.post(`/competitions/${competition.id}/join`);
      }
      return { competition, requiresOnlinePayment };
    },
    onSuccess: async ({ competition, requiresOnlinePayment }) => {
      setJoinCodeInput('');
      setPendingInviteCompetition(null);
      setMode(requiresOnlinePayment ? 'available' : 'mine');
      setJoinCodeStatus({
        tone: requiresOnlinePayment ? 'info' : 'success',
        message: requiresOnlinePayment
          ? `${competition.name} is unlocked. Complete online payment to join.`
          : `Joined ${competition.name}.`,
      });
      await Promise.all([competitionsQuery.refetch(), myDetailsQuery.refetch()]);
      router.push(`/competitions/${competition.id}`);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message ?? error?.response?.data?.error ?? 'Could not join this competition.';
      setJoinCodeStatus({ tone: 'error', message });
    },
  });

  const all = (competitionsQuery.data ?? []) as CompetitionLike[];
  const myRows = myDetailsQuery.data ?? [];
  const isRefreshing = competitionsQuery.isRefetching || myDetailsQuery.isRefetching;
  const lastUpdatedAt = Math.max(competitionsQuery.dataUpdatedAt || 0, myDetailsQuery.dataUpdatedAt || 0);
  const myJoinedIds = useMemo(() => new Set(myRows.map((m) => m.competition.id)), [myRows]);
  const myEntryCountByCompetition = useMemo(() => {
    const counts = new Map<number, number>();
    for (const row of myRows) counts.set(row.competition.id, (counts.get(row.competition.id) ?? 0) + 1);
    return counts;
  }, [myRows]);

  const openCount = all.filter((c) => c.status === 'UPCOMING' && !myJoinedIds.has(c.id)).length;
  const liveCount = all.filter((c) => c.status === 'ACTIVE').length;
  const freeCount = all.filter((c) => (c.entryFee ?? 0) === 0).length;

  const activeFilterCount =
    (statusFilter !== 'ALL' ? 1 : 0) +
    (feeFilter !== 'ALL' ? 1 : 0) +
    (sortBy !== 'date' ? 1 : 0) +
    (startWindow !== 'ALL' ? 1 : 0) +
    (search.trim() ? 1 : 0);

  useEffect(() => {
    setShowFilters(activeFilterCount > 0);
  }, [activeFilterCount]);

  useEffect(() => {
    try {
      const saved = globalThis?.localStorage?.getItem('lms.mobile.competitions.filters');
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed?.mode) setMode(parsed.mode);
      if (parsed?.statusFilter) setStatusFilter(parsed.statusFilter);
      if (parsed?.feeFilter) setFeeFilter(parsed.feeFilter);
      if (parsed?.sortBy) setSortBy(parsed.sortBy);
      if (parsed?.startWindow) setStartWindow(parsed.startWindow);
      if (parsed?.mineFilter) setMineFilter(parsed.mineFilter);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      globalThis?.localStorage?.setItem('lms.mobile.competitions.filters', JSON.stringify({ mode, statusFilter, feeFilter, sortBy, startWindow, mineFilter }));
    } catch {}
  }, [mode, statusFilter, feeFilter, sortBy, startWindow, mineFilter]);

  const filterCompetition = (comp: CompetitionLike) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const haystack = `${comp.name} ${comp.description ?? ''} ${comp.clubName ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (statusFilter !== 'ALL' && comp.status !== statusFilter) return false;
    if (feeFilter !== 'ALL') {
      const isFree = (comp.entryFee ?? 0) === 0;
      if (feeFilter === 'FREE' && !isFree) return false;
      if (feeFilter === 'PAID' && isFree) return false;
    }
    if (startWindow !== 'ALL') {
      const days = Number(startWindow);
      if (!isWithinWindow(comp.firstGameweekDate ?? comp.startDate, days)) return false;
    }
    return true;
  };

  const sortCompetitions = <T,>(list: T[], getComp: (item: T) => CompetitionLike) => {
    const sorted = [...list];
    sorted.sort((a, b) => {
      const ca = getComp(a);
      const cb = getComp(b);
      if (sortBy === 'players') return (cb.participantCount ?? 0) - (ca.participantCount ?? 0);
      if (sortBy === 'name') return ca.name.localeCompare(cb.name);
      const da = (ca.firstGameweekDate ?? ca.startDate ?? '').toString();
      const db = (cb.firstGameweekDate ?? cb.startDate ?? '').toString();
      return da.localeCompare(db);
    });
    return sorted;
  };

  const availableCompetitions = useMemo(() => sortCompetitions(all.filter(filterCompetition), (c) => c), [all, search, statusFilter, feeFilter, sortBy, startWindow]);
  const openToJoin = availableCompetitions.filter((c) => c.status === 'UPCOMING' && !myJoinedIds.has(c.id));
  const liveViewOnly = availableCompetitions.filter((c) => c.status === 'ACTIVE' && !myJoinedIds.has(c.id));

  const filteredMine = useMemo(() => {
    const rows = myRows.filter((row) => filterCompetition(row.competition as CompetitionLike));
    return sortCompetitions(rows, (row) => row.competition as CompetitionLike);
  }, [myRows, search, statusFilter, feeFilter, sortBy, startWindow]);

  const isMineNeedsAction = (row: MyCompetition) => {
    if (row.competition.status === 'COMPLETED' || row.myStatus === 'ELIMINATED' || row.myStatus === 'WINNER') return false;
    return row.paymentState === 'AWAITING_PAYMENT' || row.pickRequired === true;
  };
  const mineNeedsAction = filteredMine.filter(isMineNeedsAction);
  const minePickDue = filteredMine.filter((row) => isMineNeedsAction(row) && row.pickRequired === true);
  const mineAwaitingPayment = filteredMine.filter((row) => isMineNeedsAction(row) && row.paymentState === 'AWAITING_PAYMENT');
  const mineActive = filteredMine.filter((row) => row.myStatus === 'ACTIVE' && row.competition.status === 'ACTIVE' && !isMineNeedsAction(row));
  const mineUpcoming = filteredMine.filter((row) => row.myStatus === 'ACTIVE' && row.competition.status === 'UPCOMING' && !isMineNeedsAction(row));
  const mineEliminated = filteredMine.filter((row) => row.competition.status !== 'COMPLETED' && row.myStatus === 'ELIMINATED');
  const mineFinished = filteredMine.filter((row) => row.myStatus === 'WINNER' || row.competition.status === 'COMPLETED');
  const activityItems = useMemo<ActivityItem[]>(() => {
    const items = myRows.map((row) => {
      const comp = row.competition as CompetitionLike;
      const entrySuffix = (myEntryCountByCompetition.get(comp.id) ?? 0) > 1 && row.entryNumber ? ` · Entry #${row.entryNumber}` : '';
      const baseId = `${row.participantId ?? comp.id}-${row.entryNumber ?? 0}`;
      if (row.paymentState === 'AWAITING_PAYMENT') {
        return {
          id: `payment-${baseId}`,
          tone: 'warn' as const,
          label: comp.paymentMode === 'STRIPE' ? 'Payment required' : 'Awaiting payment',
          title: comp.paymentMode === 'STRIPE' ? `Pay to enter ${comp.name}` : `${comp.name} needs payment confirmation`,
          detail: comp.paymentMode === 'STRIPE' ? `Complete online payment${entrySuffix} before making picks.` : `The organiser still needs to mark this entry as paid${entrySuffix}.`,
          competitionId: comp.id,
          priority: 10,
          dismissible: false,
        };
      }
      if (row.myStatus === 'WINNER') {
        return {
          id: `winner-${baseId}`,
          tone: 'success' as const,
          label: 'Winner',
          title: `You won ${comp.name}`,
          detail: `This entry is the last survivor standing${entrySuffix}.`,
          competitionId: comp.id,
          priority: 30,
          dismissible: true,
        };
      }
      if (row.myStatus === 'ELIMINATED') {
        return {
          id: `eliminated-${baseId}`,
          tone: 'danger' as const,
          label: 'Eliminated',
          title: `${comp.name}: run ended`,
          detail: `Eliminated${row.eliminatedWeek ? ` in Gameweek ${row.eliminatedWeek}` : ''}${entrySuffix}. You can still follow the survivor table.`,
          competitionId: comp.id,
          priority: 40,
          dismissible: true,
        };
      }
      if (row.pickRequired === true) {
        return {
          id: `pick-${baseId}`,
          tone: 'warn' as const,
          label: 'Pick due',
          title: `Pick needed for ${comp.name}`,
          detail: `Choose your team before the next lock${entrySuffix}.`,
          competitionId: comp.id,
          priority: 20,
          dismissible: false,
        };
      }
      if (row.myStatus === 'ACTIVE' && comp.status === 'ACTIVE') {
        return {
          id: `live-${baseId}`,
          tone: 'brand' as const,
          label: 'In play',
          title: `${comp.name} is live`,
          detail: `${comp.activeCount ?? 0} of ${comp.participantCount ?? 0} still standing${entrySuffix}.`,
          competitionId: comp.id,
          priority: 50,
          dismissible: true,
        };
      }
      if (comp.status === 'COMPLETED') {
        return {
          id: `complete-${baseId}`,
          tone: 'neutral' as const,
          label: 'Finished',
          title: `${comp.name} has finished`,
          detail: comp.winnerUsername ? `Winner: ${comp.winnerUsername}${entrySuffix}.` : `Final results are available${entrySuffix}.`,
          competitionId: comp.id,
          priority: 60,
          dismissible: true,
        };
      }
      return {
        id: `joined-${baseId}`,
        tone: 'neutral' as const,
        label: 'Joined',
        title: `${comp.name} is ready`,
        detail: `Your entry is registered${entrySuffix}. First gameweek: ${formatDate(comp.firstGameweekDate ?? comp.startDate)}.`,
        competitionId: comp.id,
        priority: 70,
        dismissible: true,
      };
    });
    return items
      .filter((item) => !item.dismissible || !dismissedActivityIds.has(item.id))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 6);
  }, [dismissedActivityIds, myRows, myEntryCountByCompetition]);

  const visibleMineNeedsAction = mineFilter === 'ALL' || mineFilter === 'NEEDS_ACTION' || mineFilter === 'PICK_DUE' || mineFilter === 'AWAITING_PAYMENT'
    ? mineNeedsAction.filter((row) => {
        if (mineFilter === 'PICK_DUE') return row.myStatus === 'ACTIVE' && row.paymentState !== 'AWAITING_PAYMENT' && row.competition.status === 'UPCOMING';
        if (mineFilter === 'AWAITING_PAYMENT') return row.paymentState === 'AWAITING_PAYMENT';
        return true;
      })
    : [];

  const isAvailableSectionOpen = (key: string) => openAvailableSections[key] ?? true;
  const toggleAvailableSection = (key: string) => setOpenAvailableSections((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  const isMineSectionOpen = (key: string) => openMineSections[key] ?? true;
  const toggleMineSection = (key: string) => setOpenMineSections((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));

  const submitJoinCode = () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) {
      setJoinCodeStatus({ tone: 'error', message: 'Enter an invite code first.' });
      return;
    }
    setPendingInviteCompetition(null);
    setJoinCodeStatus({ tone: 'info', message: `Checking invite code ${code}...` });
    joinCodeMutation.mutate(code);
  };

  const refresh = () => void Promise.all([competitionsQuery.refetch(), myDetailsQuery.refetch()]);

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={colors.brand} />}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.webHero}>
          <View style={styles.webHeroContent}>
            <Text style={styles.webHeroEyebrow}>Matchday hub</Text>
            <Text style={styles.webHeroTitle}>Competitions</Text>
            <Text style={styles.webHeroCopy}>Find public pools, return to your active runs, or jump straight in with an invite code. Every surface here is tuned around the next pick.</Text>
            <View style={styles.webMetricRow}>
              <MetricCard label="Live" value={String(liveCount)} />
              <MetricCard label="Open" value={String(openCount)} />
              <MetricCard label="Yours" value={String(myRows.length)} />
            </View>
          </View>
        </View>

        <DataFreshnessBar label="Competition data" updatedAt={lastUpdatedAt || null} refreshing={isRefreshing} onRefresh={refresh} />

        {activityItems.length > 0 ? (
          <ActivityPanel items={activityItems} onOpen={(competitionId) => router.push(`/competitions/${competitionId}`)} onDismiss={dismissActivity} />
        ) : null}

        <View style={styles.webControlsCard}>
          <View style={styles.webModeTabs}>
            <ModeTab label="Browse" hint="Open + live" count={openToJoin.length + liveViewOnly.length} active={mode === 'available'} onPress={() => setMode('available')} />
            <ModeTab label="My Competitions" hint="Your entries" count={myRows.length} active={mode === 'mine'} onPress={() => setMode('mine')} />
          </View>

          <View style={styles.searchRow}>
            <View style={styles.searchInputWrap}>
              <Text style={styles.searchIcon}>⌕</Text>
              <TextInput value={search} onChangeText={setSearch} placeholder={mode === 'mine' ? 'Search your competitions…' : 'Search competitions…'} placeholderTextColor={colors.textMuted} style={styles.webSearchInput} />
              {search ? <TouchableOpacity onPress={() => setSearch('')}><Text style={styles.searchClear}>×</Text></TouchableOpacity> : null}
            </View>
          </View>

          {mode === 'available' ? (
            <View style={styles.privateJoinCard}>
              <View style={styles.privateJoinHeader}>
                <View style={styles.privateJoinIcon}><Text style={styles.privateJoinIconText}>#</Text></View>
                <View style={styles.privateJoinCopy}>
                  <Text style={styles.privateJoinTitle}>Join a private competition</Text>
                  <Text style={styles.privateJoinHelp}>Enter the invite code from your organiser. If payment is required, you will be taken to the competition payment screen.</Text>
                </View>
              </View>
              <View style={styles.joinCodeBox}>
                <TextInput
                  value={joinCodeInput}
                  onChangeText={(value) => { setJoinCodeInput(value.toUpperCase().replace(/\s/g, '')); setJoinCodeStatus(null); setPendingInviteCompetition(null); }}
                  placeholder="INVITE CODE"
                  placeholderTextColor="#64748b"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.joinCodeInput}
                />
                <TouchableOpacity style={[styles.unlockButton, (!joinCodeInput.trim() || joinCodeMutation.isPending || confirmInviteJoinMutation.isPending) ? styles.unlockButtonDisabled : null]} onPress={submitJoinCode} disabled={!joinCodeInput.trim() || joinCodeMutation.isPending || confirmInviteJoinMutation.isPending}>
                  <Text style={styles.unlockButtonText}>{joinCodeMutation.isPending ? 'Checking...' : 'Preview invite'}</Text>
                </TouchableOpacity>
              </View>
              {joinCodeStatus ? <Text style={[styles.joinCodeStatus, joinCodeStatus.tone === 'error' ? styles.joinCodeStatusError : joinCodeStatus.tone === 'success' ? styles.joinCodeStatusSuccess : null]}>{joinCodeStatus.message}</Text> : null}
              {pendingInviteCompetition ? (
                <View style={styles.invitePreviewCard}>
                  <Text style={styles.invitePreviewEyebrow}>Invite preview</Text>
                  <Text style={styles.invitePreviewTitle}>{pendingInviteCompetition.name}</Text>
                  <Text style={styles.invitePreviewMeta}>
                    {pendingInviteCompetition.status} · {pendingInviteCompetition.participantCount ?? 0} players · {(pendingInviteCompetition.entryFee ?? 0) > 0 ? `€${pendingInviteCompetition.entryFee}` : 'Free'}
                  </Text>
                  <Text style={styles.invitePreviewHelp}>
                    {pendingInviteCompetition.paymentMode === 'STRIPE' && (pendingInviteCompetition.entryFee ?? 0) > 0
                      ? 'Online payment is required before your entry is confirmed.'
                      : pendingInviteCompetition.paymentMode === 'MANUAL' && (pendingInviteCompetition.entryFee ?? 0) > 0
                        ? 'You will be registered and the organiser will confirm payment.'
                        : 'No payment is required for this competition.'}
                  </Text>
                  <View style={styles.invitePreviewActions}>
                    <TouchableOpacity
                      style={[styles.inviteConfirmButton, confirmInviteJoinMutation.isPending ? styles.unlockButtonDisabled : null]}
                      disabled={confirmInviteJoinMutation.isPending}
                      onPress={() => confirmInviteJoinMutation.mutate(pendingInviteCompetition)}
                    >
                      <Text style={styles.inviteConfirmText}>
                        {confirmInviteJoinMutation.isPending
                          ? 'Working...'
                          : pendingInviteCompetition.paymentMode === 'STRIPE' && (pendingInviteCompetition.entryFee ?? 0) > 0
                            ? 'Continue to payment'
                            : 'Join competition'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setPendingInviteCompetition(null); setJoinCodeInput(''); setJoinCodeStatus(null); }}>
                      <Text style={styles.inviteClearText}>Clear invite</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
              <TouchableOpacity style={[styles.refineButton, showFilters || activeFilterCount > 0 ? styles.refineButtonActive : null]} onPress={() => setShowFilters((v) => !v)}>
                <Text style={[styles.refineText, showFilters || activeFilterCount > 0 ? styles.refineTextActive : null]}>
                  Refine public list{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {(showFilters || activeFilterCount > 0) ? (
            <View style={styles.filterStack}>
              <View style={styles.filterRow}>{(['ALL', 'UPCOMING', 'ACTIVE'] as const).map((s) => <FilterPill key={s} label={s === 'ALL' ? 'All status' : s} active={statusFilter === s} onPress={() => setStatusFilter(s)} />)}</View>
              <View style={styles.filterRow}>{(['ALL', 'FREE', 'PAID'] as const).map((f) => <FilterPill key={f} label={f === 'ALL' ? 'Any fee' : f} active={feeFilter === f} onPress={() => setFeeFilter(f)} />)}</View>
              <View style={styles.filterRow}>{(['ALL', '7', '14', '30'] as const).map((w) => <FilterPill key={w} label={w === 'ALL' ? 'Anytime' : `${w} days`} active={startWindow === w} onPress={() => setStartWindow(w)} />)}</View>
              <View style={styles.filterRow}>{(['date', 'players', 'name'] as const).map((s) => <FilterPill key={s} label={s === 'date' ? 'Soonest' : s === 'players' ? 'Players' : 'A-Z'} active={sortBy === s} onPress={() => setSortBy(s)} />)}</View>
              {activeFilterCount > 0 ? (
                <TouchableOpacity
                  onPress={() => {
                    setStatusFilter('ALL');
                    setFeeFilter('ALL');
                    setStartWindow('ALL');
                    setSortBy('date');
                    setSearch('');
                  }}
                >
                  <Text style={styles.resetLink}>Reset filters</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>

        {mode === 'mine' && myRows.length > 0 ? (
          <View style={styles.mineFiltersPanel}>
            <View style={styles.mineStatGrid}>
              <MineFilterStat label="Needs action" value={mineNeedsAction.length} active={mineFilter === 'NEEDS_ACTION'} tone="warn" onPress={() => setMineFilter((current) => current === 'NEEDS_ACTION' ? 'ALL' : 'NEEDS_ACTION')} />
              <MineFilterStat label="Upcoming" value={mineUpcoming.length} active={mineFilter === 'UPCOMING'} tone="brand" onPress={() => setMineFilter((current) => current === 'UPCOMING' ? 'ALL' : 'UPCOMING')} />
              <MineFilterStat label="In play" value={mineActive.length} active={mineFilter === 'ACTIVE'} tone="success" onPress={() => setMineFilter((current) => current === 'ACTIVE' ? 'ALL' : 'ACTIVE')} />
              <MineFilterStat label="Eliminated" value={mineEliminated.length} active={mineFilter === 'ELIMINATED'} tone="danger" onPress={() => setMineFilter((current) => current === 'ELIMINATED' ? 'ALL' : 'ELIMINATED')} />
              <MineFilterStat label="Finished" value={mineFinished.length} active={mineFilter === 'FINISHED'} tone="neutral" onPress={() => setMineFilter((current) => current === 'FINISHED' ? 'ALL' : 'FINISHED')} />
            </View>
            <View style={styles.mineChipRow}>
              {(['ALL', 'PICK_DUE', 'AWAITING_PAYMENT'] as const).map((filter) => (
                <FilterPill
                  key={filter}
                  label={filter === 'ALL' ? 'All' : filter === 'PICK_DUE' ? 'Pick due' : 'Awaiting payment'}
                  active={mineFilter === filter}
                  onPress={() => setMineFilter((current) => current === filter ? 'ALL' : filter)}
                />
              ))}
            </View>
            {(mineFilter !== 'ALL' || search) ? (
              <View style={styles.activeMineFilterRow}>
                {mineFilter !== 'ALL' ? <Text style={styles.activeFilterChip}>Showing: {mineFilter.toLowerCase().replace('_', ' ')}</Text> : null}
                {search ? <Text style={styles.activeFilterChip}>Search: {search}</Text> : null}
                {mineFilter !== 'ALL' ? <TouchableOpacity onPress={() => setMineFilter('ALL')}><Text style={styles.clearFilterText}>Clear filter</Text></TouchableOpacity> : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {competitionsQuery.isLoading || myDetailsQuery.isLoading ? <Text style={styles.meta}>Loading competitions...</Text> : null}
        {competitionsQuery.error || myDetailsQuery.error ? <Text style={styles.error}>Unable to load competitions.</Text> : null}

        {mode === 'available' ? (
          <>
            <SectionBlock title="Joinable Competitions" count={openToJoin.length} collapsible open={isAvailableSectionOpen('open')} onToggle={() => toggleAvailableSection('open')} emptyText="No open competitions match current filters.">
              {openToJoin.map((comp) => (
                <CompetitionCard
                  key={`open-${comp.id}`}
                  comp={comp}
                  joined={false}
                  joinedCount={0}
                  onOpen={() => router.push(`/competitions/${comp.id}`)}
                />
              ))}
            </SectionBlock>
            <SectionBlock title="Live Now · View Only" count={liveViewOnly.length} collapsible open={isAvailableSectionOpen('live')} onToggle={() => toggleAvailableSection('live')} emptyText="No live competitions match current filters." notice="Live competitions are view-only once in progress. Your joined entries are under My Competitions.">
              {liveViewOnly.map((comp) => (
                <CompetitionCard
                  key={`live-${comp.id}`}
                  comp={comp}
                  joined={false}
                  joinedCount={0}
                  onOpen={() => router.push(`/competitions/${comp.id}`)}
                />
              ))}
            </SectionBlock>
          </>
        ) : (
          <>
            {(mineFilter === 'ALL' || mineFilter === 'NEEDS_ACTION' || mineFilter === 'PICK_DUE' || mineFilter === 'AWAITING_PAYMENT') ? (
              <MineSectionBlock title="Needs Action" count={visibleMineNeedsAction.length} open={isMineSectionOpen('needsAction')} onToggle={() => toggleMineSection('needsAction')} emptyText="No payment or pick actions need attention.">
                {visibleMineNeedsAction.map((row) => <MyCompetitionCard key={`action-${row.participantId ?? row.competition.id}-${row.entryNumber ?? 0}`} row={row} onOpen={() => router.push(`/competitions/${row.competition.id}`)} />)}
              </MineSectionBlock>
            ) : null}
            {(mineFilter === 'ALL' || mineFilter === 'ACTIVE') ? (
              <MineSectionBlock title="Active" count={mineActive.length} open={isMineSectionOpen('active')} onToggle={() => toggleMineSection('active')} emptyText="No active entries match current filters.">
                {mineActive.map((row) => <MyCompetitionCard key={`active-${row.participantId ?? row.competition.id}-${row.entryNumber ?? 0}`} row={row} onOpen={() => router.push(`/competitions/${row.competition.id}`)} />)}
              </MineSectionBlock>
            ) : null}
            {(mineFilter === 'ALL' || mineFilter === 'UPCOMING') ? (
              <MineSectionBlock title="Upcoming" count={mineUpcoming.length} open={isMineSectionOpen('upcoming')} onToggle={() => toggleMineSection('upcoming')} emptyText="No upcoming entries match current filters.">
                {mineUpcoming.map((row) => <MyCompetitionCard key={`upcoming-${row.participantId ?? row.competition.id}-${row.entryNumber ?? 0}`} row={row} onOpen={() => router.push(`/competitions/${row.competition.id}`)} />)}
              </MineSectionBlock>
            ) : null}
            {(mineFilter === 'ALL' || mineFilter === 'ELIMINATED') ? (
              <MineSectionBlock title="Eliminated" count={mineEliminated.length} open={isMineSectionOpen('eliminated')} onToggle={() => toggleMineSection('eliminated')} emptyText="No eliminated entries match current filters.">
                {mineEliminated.map((row) => <MyCompetitionCard key={`eliminated-${row.participantId ?? row.competition.id}-${row.entryNumber ?? 0}`} row={row} onOpen={() => router.push(`/competitions/${row.competition.id}`)} />)}
              </MineSectionBlock>
            ) : null}
            {(mineFilter === 'ALL' || mineFilter === 'FINISHED') ? (
              <MineSectionBlock title="Finished" count={mineFinished.length} open={isMineSectionOpen('finished')} onToggle={() => toggleMineSection('finished')} emptyText="No finished entries match current filters.">
                {mineFinished.map((row) => <MyCompetitionCard key={`finished-${row.participantId ?? row.competition.id}-${row.entryNumber ?? 0}`} row={row} onOpen={() => router.push(`/competitions/${row.competition.id}`)} />)}
              </MineSectionBlock>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MineFilterStat({ label, value, active, tone, onPress }: { label: string; value: number; active: boolean; tone: 'warn' | 'brand' | 'success' | 'danger' | 'neutral'; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.mineStatTile, active ? styles.mineStatTileActive : null]} onPress={onPress}>
      <Text style={[styles.mineStatValue, tone === 'warn' ? styles.mineStatWarn : tone === 'brand' ? styles.mineStatBrand : tone === 'success' ? styles.mineStatSuccess : tone === 'danger' ? styles.mineStatDanger : null]}>{value}</Text>
      <Text style={styles.mineStatLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.webMetricCard}>
      <Text style={styles.webMetricLabel}>{label}</Text>
      <Text style={styles.webMetricValue}>{value}</Text>
    </View>
  );
}

function FilterStatTile({ label, value, active, onPress }: { label: string; value: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.statTile, active ? styles.statTileActive : null]} onPress={onPress}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </TouchableOpacity>
  );
}

function ActivityPanel({ items, onOpen, onDismiss }: { items: ActivityItem[]; onOpen: (competitionId: number) => void; onDismiss: (activityId: string) => void }) {
  return (
    <View style={styles.activityPanel}>
      <View style={styles.activityHeaderRow}>
        <View>
          <Text style={styles.activityEyebrow}>Latest</Text>
          <Text style={styles.activityTitle}>Activity / Updates</Text>
        </View>
        <Text style={styles.activityCount}>{items.length}</Text>
      </View>
      <View style={styles.activityList}>
        {items.map((item) => <ActivityRow key={item.id} item={item} onOpen={() => onOpen(item.competitionId)} onDismiss={() => onDismiss(item.id)} />)}
      </View>
    </View>
  );
}

function ActivityRow({ item, onOpen, onDismiss }: { item: ActivityItem; onOpen: () => void; onDismiss: () => void }) {
  return (
    <View style={styles.activityRow}>
      <TouchableOpacity style={styles.activityMainAction} onPress={onOpen} activeOpacity={0.86}>
        <View style={[styles.activityToneDot, item.tone === 'warn' ? styles.activityWarn : item.tone === 'success' ? styles.activitySuccess : item.tone === 'danger' ? styles.activityDanger : item.tone === 'brand' ? styles.activityBrand : styles.activityNeutral]} />
        <View style={styles.activityBody}>
          <View style={styles.activityLabelRow}>
            <Text style={[styles.activityLabel, item.tone === 'warn' ? styles.activityLabelWarn : item.tone === 'success' ? styles.activityLabelSuccess : item.tone === 'danger' ? styles.activityLabelDanger : item.tone === 'brand' ? styles.activityLabelBrand : null]}>{item.label}</Text>
          </View>
          <Text style={styles.activityItemTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.activityDetail} numberOfLines={2}>{item.detail}</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.activityActions}>
        {item.dismissible ? (
          <TouchableOpacity
            style={styles.activityDismissButton}
            onPress={onDismiss}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.activityDismissText}>Dismiss</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={onOpen} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.activityOpen}>Open</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ModeTab({ label, hint, count, active, onPress }: { label: string; hint: string; count: number; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.modeTab, active ? styles.modeTabActive : null]} onPress={onPress}>
      <View style={styles.modeTabTop}>
        <Text style={[styles.modeTabLabel, active ? styles.modeTabLabelActive : null]}>{label}</Text>
        <Text style={[styles.modeTabCount, active ? styles.modeTabCountActive : null]}>{count}</Text>
      </View>
      <Text style={styles.modeTabHint}>{hint}</Text>
    </TouchableOpacity>
  );
}

function SectionBlock({ title, count, emptyText, notice, collapsible, open = true, onToggle, children }: { title: string; count?: number; emptyText?: string; notice?: string; collapsible?: boolean; open?: boolean; onToggle?: () => void; children?: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  const header = (
    <View style={[styles.sectionHeader, collapsible && open ? styles.sectionHeaderOpen : null]}>
      <View style={styles.sectionHeaderLeft}>
        <Text style={styles.sectionKicker}>{collapsible ? 'Section' : 'Group'}</Text>
        <Text style={styles.sectionTitle}>{title}</Text>
        {count != null ? <Text style={styles.sectionMeta}>{count} competition{count === 1 ? '' : 's'}</Text> : null}
      </View>
      {collapsible ? <View style={[styles.sectionChevronBox, open ? styles.sectionChevronBoxOpen : null]}><Text style={styles.sectionChevron}>{open ? '▲' : '▼'}</Text></View> : null}
    </View>
  );
  return (
    <View style={styles.sectionBlock}>
      {collapsible ? <TouchableOpacity onPress={onToggle} activeOpacity={0.85}>{header}</TouchableOpacity> : header}
      {open ? (notice ? <View style={styles.noticeBox}><Text style={styles.noticeText}>{notice}</Text></View> : null) : null}
      {open ? (hasChildren ? children : <Text style={styles.emptyText}>{emptyText}</Text>) : null}
    </View>
  );
}

function MineSectionBlock({ title, count, open, onToggle, emptyText, children }: { title: string; count: number; open: boolean; onToggle: () => void; emptyText: string; children?: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <View style={styles.sectionBlock}>
      <TouchableOpacity style={[styles.mineSectionHeader, open ? styles.mineSectionHeaderOpen : null]} onPress={onToggle} activeOpacity={0.85}>
        <View style={styles.mineSectionTitleRow}>
          <Text style={styles.sectionKicker}>My competitions</Text>
          <Text style={styles.mineSectionTitle}>{title}</Text>
          <Text style={styles.sectionMeta}>{count} entr{count === 1 ? 'y' : 'ies'}</Text>
        </View>
        <View style={[styles.sectionChevronBox, open ? styles.sectionChevronBoxOpen : null]}><Text style={styles.mineSectionChevron}>{open ? '▲' : '▼'}</Text></View>
      </TouchableOpacity>
      {open ? (hasChildren ? children : <Text style={styles.emptyText}>{emptyText}</Text>) : null}
    </View>
  );
}

function CompetitionCard({ comp, joined, joinedCount, onOpen }: { comp: CompetitionLike; joined: boolean; joinedCount: number; onOpen: () => void }) {
  const maxEntries = comp.maxEntriesPerUser ?? 1;
  const canJoin = comp.status === 'UPCOMING';
  const activeCount = comp.activeCount ?? comp.participantCount ?? 0;
  const total = comp.participantCount ?? 0;
  const progress = total > 0 ? Math.max(0, Math.min(100, (activeCount / total) * 100)) : 0;
  const entryFee = comp.entryFee ?? 0;
  const prizePool = comp.prizePool ?? 0;
  const clubAccent = comp.clubPrimaryColor ?? colors.brand;

  return (
    <View style={[styles.compCard, { borderColor: `${clubAccent}55` }]}>
      <View style={styles.cardTopRow}>
        <View style={styles.badgeWrap}>
          <StatusPill text={statusLabel(comp.status)} tone={statusTone(comp.status)} />
          <StatusPill text={comp.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC'} tone={comp.visibility === 'PRIVATE' ? 'warn' : 'neutral'} />
          <View style={styles.sourceBadge}><Text style={styles.sourceBadgeText}>{fixtureSourceLabel(comp)}</Text></View>
        </View>
        {joined ? <View style={styles.joinedBadge}><Text style={styles.joinedBadgeText}>Joined{maxEntries > 1 ? ` ${joinedCount}/${maxEntries}` : ''}</Text></View> : null}
      </View>

      <Text style={styles.compTitle} numberOfLines={2}>{comp.name}</Text>
      <View style={styles.clubRow}>
        {comp.clubLogoUrl ? <Image source={{ uri: comp.clubLogoUrl }} style={styles.clubLogo} /> : null}
        {comp.clubName ? <View style={[styles.clubBadge, { borderColor: `${clubAccent}66`, backgroundColor: `${clubAccent}1f` }]}><Text style={[styles.clubBadgeText, { color: clubAccent }]} numberOfLines={1}>{comp.clubName}</Text></View> : null}
      </View>

      {comp.visibility === 'PRIVATE' && comp.joinCode ? (
        <View style={[styles.inviteBox, { borderColor: `${clubAccent}66`, backgroundColor: `${clubAccent}18` }]}>
          <Text style={[styles.inviteLabel, { color: clubAccent }]}>Invite code</Text>
          <Text style={styles.inviteCode}>{comp.joinCode}</Text>
        </View>
      ) : (
        <View style={styles.publicBox}><Text style={styles.publicText}>Public - no invite code required.</Text></View>
      )}

      <View style={styles.descriptionSlot}>
        {comp.description ? <Text style={styles.description} numberOfLines={2}>{comp.description}</Text> : null}
      </View>

      <View style={styles.metaGrid}>
        <MetaCell label="First Gameweek" value={formatDate(comp.firstGameweekDate ?? comp.startDate)} />
        <MetaCell label="Entry" value={paymentLabel(comp)} tone={entryFee > 0 ? 'brand' : 'green'} />
        <MetaCell label="Missed Pick" value={String(comp.missedPickMode) === 'AUTO_ASSIGN' ? 'Auto-Assign' : 'Eliminate'} />
        <MetaCell label="Survivors" value={comp.winnerUsername ? `Winner: ${comp.winnerUsername}` : comp.status === 'ACTIVE' ? `${activeCount} of ${total}` : `${total} players`} tone={comp.status === 'ACTIVE' ? 'green' : undefined} />
        {prizePool > 0 ? <MetaCell label="Prize Pool" value={`€${prizePool}`} tone="yellow" /> : null}
      </View>

      {comp.status === 'ACTIVE' && total > 0 ? (
        <View style={styles.survivorBarOuter}><View style={[styles.survivorBarInner, { width: `${progress}%` }]} /></View>
      ) : null}

      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.secondaryButton} onPress={onOpen}><Text style={styles.secondaryButtonText}>{joined ? 'Open →' : 'View'}</Text></TouchableOpacity>
        {canJoin ? <TouchableOpacity style={[styles.primaryButton, { backgroundColor: clubAccent }]} onPress={onOpen}><Text style={styles.primaryButtonText}>{joined ? 'Add entry' : entryFee > 0 && comp.paymentMode === 'STRIPE' ? `Pay & Join · €${entryFee}` : entryFee > 0 ? `Join · €${entryFee}` : 'Join Free'}</Text></TouchableOpacity> : null}
        {!joined && comp.status === 'ACTIVE' ? <View style={styles.liveOnly}><Text style={styles.liveOnlyText}>Live now · View only</Text></View> : null}
      </View>
    </View>
  );
}

function MyCompetitionCard({ row, onOpen }: { row: MyCompetition; onOpen: () => void }) {
  const comp = row.competition as CompetitionLike;
  const activeCount = comp.activeCount ?? comp.participantCount ?? 0;
  const isFinished = comp.status === 'COMPLETED';
  const statusText = isFinished ? 'Finished' : row.myStatus === 'WINNER' ? 'Winner' : row.myStatus === 'ELIMINATED' ? 'Eliminated' : 'Active';
  const paymentText = row.paymentState === 'AWAITING_PAYMENT' && comp.paymentMode === 'STRIPE' ? 'Pay online' : row.paymentState === 'AWAITING_PAYMENT' ? 'Awaiting payment' : row.paymentState === 'PAID' ? 'Paid' : 'Not needed';
  const actionRequired = row.paymentState === 'AWAITING_PAYMENT';
  const clubAccent = comp.clubPrimaryColor ?? colors.brand;

  return (
    <TouchableOpacity style={[styles.myCard, { borderColor: `${clubAccent}55` }, actionRequired ? styles.myCardAction : null]} onPress={onOpen}>
      <View style={[styles.myStatusDot, isFinished ? styles.dotNeutral : row.myStatus === 'ELIMINATED' ? styles.dotRed : row.myStatus === 'WINNER' ? styles.dotYellow : styles.dotGreen, !isFinished && row.myStatus === 'ACTIVE' ? { backgroundColor: clubAccent } : null]} />
      <View style={styles.myCardBody}>
        <View style={styles.myTitleRow}>
          {comp.clubLogoUrl ? <Image source={{ uri: comp.clubLogoUrl }} style={styles.myClubLogo} /> : null}
          <Text style={styles.myTitle} numberOfLines={1}>{comp.name}</Text>
          {row.entryNumber ? <Text style={[styles.entryBadge, { borderColor: `${clubAccent}55`, color: clubAccent }]}>{`#${row.entryNumber}`}</Text> : null}
        </View>
        <Text style={[styles.myStatusText, { color: !isFinished && row.myStatus === 'ACTIVE' ? clubAccent : undefined }, actionRequired ? styles.actionText : null]}>{statusText}{actionRequired ? comp.paymentMode === 'STRIPE' ? ' · Pay online' : ' · Awaiting payment' : ''}</Text>
        <View style={styles.myChips}>
          <Text style={styles.myChip}>Players {comp.participantCount ?? 0}</Text>
          <Text style={styles.myChip}>Survivors {comp.status === 'ACTIVE' ? activeCount : '—'}</Text>
          <Text style={styles.myChip}>{money(comp.entryFee)}</Text>
          <Text style={styles.myChip}>{formatDate(comp.firstGameweekDate ?? comp.startDate)}</Text>
        </View>
        <View style={styles.myExpandedMeta}>
          <Text style={styles.myMetaText}>Payment: {paymentText}</Text>
          <Text style={styles.myMetaText}>Status: {statusLabel(comp.status)}</Text>
        </View>
      </View>
      <Text style={[styles.openLink, { color: clubAccent }]}>Open</Text>
    </TouchableOpacity>
  );
}

function MetaCell({ label, value, tone }: { label: string; value: string; tone?: 'brand' | 'green' | 'yellow' }) {
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, tone === 'brand' ? styles.metaBrand : tone === 'green' ? styles.metaGreen : tone === 'yellow' ? styles.metaYellow : null]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 28, gap: 12 },
  webHero: { position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: '#ffffff14', borderRadius: 28, backgroundColor: '#0b1220', padding: 16, shadowColor: '#020617', shadowOpacity: 0.42, shadowRadius: 24, shadowOffset: { width: 0, height: 14 }, elevation: 4 },
  webHeroContent: { position: 'relative' },
  webHeroEyebrow: { alignSelf: 'flex-start', overflow: 'hidden', borderWidth: 1, borderColor: '#38bdf840', backgroundColor: '#0ea5e91a', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, color: '#bae6fd', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.8 },
  webHeroTitle: { marginTop: 12, color: '#ffffff', fontSize: 32, lineHeight: 38, fontWeight: '900', letterSpacing: -0.5 },
  webHeroCopy: { marginTop: 8, color: '#d1d5db', fontSize: 14, lineHeight: 21 },
  webMetricRow: { marginTop: 16, flexDirection: 'row', gap: 8 },
  webMetricCard: { flex: 1, borderWidth: 1, borderColor: '#ffffff14', borderRadius: 14, backgroundColor: '#ffffff0c', paddingHorizontal: 10, paddingVertical: 10, alignItems: 'center' },
  webMetricLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  webMetricValue: { marginTop: 4, color: '#ffffff', fontSize: 20, fontWeight: '900' },
  webControlsCard: { borderWidth: 1, borderColor: '#ffffff1a', borderRadius: 22, backgroundColor: '#111827cc', padding: 12, gap: 12, shadowColor: '#020617', shadowOpacity: 0.32, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 3 },
  activityPanel: { borderWidth: 1, borderColor: '#38bdf833', borderRadius: 22, backgroundColor: '#0f172acc', padding: 12, gap: 10, shadowColor: '#020617', shadowOpacity: 0.26, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
  activityHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  activityEyebrow: { color: '#7dd3fc', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.4 },
  activityTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '900', marginTop: 2 },
  activityCount: { overflow: 'hidden', color: '#bae6fd', borderWidth: 1, borderColor: '#38bdf855', backgroundColor: '#0ea5e91f', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 11, fontWeight: '900' },
  activityList: { gap: 8 },
  activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderColor: '#ffffff12', backgroundColor: '#ffffff08', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 10 },
  activityMainAction: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  activityToneDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  activityWarn: { backgroundColor: '#facc15' },
  activitySuccess: { backgroundColor: '#22c55e' },
  activityDanger: { backgroundColor: '#ef4444' },
  activityBrand: { backgroundColor: '#38bdf8' },
  activityNeutral: { backgroundColor: '#94a3b8' },
  activityBody: { flex: 1, minWidth: 0 },
  activityLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activityLabel: { color: '#cbd5e1', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.1 },
  activityLabelWarn: { color: '#fde68a' },
  activityLabelSuccess: { color: '#86efac' },
  activityLabelDanger: { color: '#fca5a5' },
  activityLabelBrand: { color: '#7dd3fc' },
  activityItemTitle: { marginTop: 3, color: '#ffffff', fontSize: 13, fontWeight: '900' },
  activityDetail: { marginTop: 3, color: '#94a3b8', fontSize: 11.5, lineHeight: 16 },
  activityActions: { alignItems: 'flex-end', gap: 7, marginTop: 1 },
  activityDismissButton: { borderWidth: 1, borderColor: '#ffffff18', backgroundColor: '#ffffff0a', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  activityDismissText: { color: '#cbd5e1', fontSize: 10, fontWeight: '900' },
  activityOpen: { color: '#7dd3fc', fontSize: 11, fontWeight: '900', marginTop: 2 },
  webModeTabs: { flexDirection: 'row', borderWidth: 1, borderColor: '#ffffff14', borderRadius: 18, backgroundColor: '#0f172acc', padding: 6, gap: 6 },
  statGrid: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statTile: { width: '48%', borderWidth: 1, borderColor: '#263244', borderRadius: 16, backgroundColor: '#111827', padding: 12 },
  statTileActive: { borderColor: '#38bdf880', backgroundColor: '#0ea5e926' },
  statLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  statValue: { marginTop: 5, color: '#f8fafc', fontSize: 24, fontWeight: '900' },
  modeTabs: { flexDirection: 'row', gap: 8 },
  modeTab: { flex: 1, borderWidth: 0, borderColor: 'transparent', borderRadius: 14, backgroundColor: 'transparent', paddingHorizontal: 10, paddingVertical: 10 },
  modeTabActive: { borderWidth: 1, borderColor: '#38bdf866', backgroundColor: '#0ea5e933' },
  modeTabTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' },
  modeTabLabel: { color: '#d1d5db', fontSize: 13, fontWeight: '900' },
  modeTabLabelActive: { color: '#ffffff' },
  modeTabCount: { color: '#94a3b8', fontWeight: '900' },
  modeTabCountActive: { color: '#e0f2fe' },
  modeTabHint: { marginTop: 3, color: '#94a3b8', fontSize: 10.5, lineHeight: 15 },
  filterCard: { borderWidth: 1, borderColor: '#263244', borderRadius: 20, backgroundColor: '#111827', padding: 12 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchInputWrap: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a', borderRadius: 12, paddingHorizontal: 10 },
  searchIcon: { color: '#94a3b8', fontSize: 18, marginRight: 6 },
  webSearchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 9 },
  searchClear: { color: '#94a3b8', fontSize: 22, paddingHorizontal: 4 },
  searchInput: { flex: 1, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a', color: colors.text, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  privateJoinCard: { gap: 10, borderWidth: 1, borderColor: '#0ea5e944', backgroundColor: '#0ea5e912', borderRadius: 18, padding: 12 },
  privateJoinHeader: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  privateJoinIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#38bdf826', borderWidth: 1, borderColor: '#38bdf866' },
  privateJoinIconText: { color: '#7dd3fc', fontSize: 16, fontWeight: '900' },
  privateJoinCopy: { flex: 1 },
  privateJoinTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '900' },
  privateJoinHelp: { color: '#94a3b8', fontSize: 11, lineHeight: 16, marginTop: 3, fontWeight: '700' },
  availableControlsRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  joinCodeStack: { flex: 1, gap: 4 },
  joinCodeBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#02061799', borderRadius: 13, padding: 6, gap: 6 },
  joinCodeInput: { flex: 1, color: '#f8fafc', fontSize: 12, paddingHorizontal: 8, paddingVertical: 6 },
  unlockButton: { borderRadius: 10, backgroundColor: '#38bdf8', paddingHorizontal: 12, paddingVertical: 9, minWidth: 106, alignItems: 'center' },
  unlockButtonDisabled: { opacity: 0.6 },
  unlockButtonText: { color: '#082f49', fontSize: 11, fontWeight: '900', textAlign: 'center' },
  joinCodeStatus: { color: '#93c5fd', fontSize: 11, fontWeight: '800', marginTop: 2 },
  joinCodeStatusError: { color: '#fca5a5' },
  joinCodeStatusSuccess: { color: '#86efac' },
  invitePreviewCard: { gap: 6, borderWidth: 1, borderColor: '#38bdf855', backgroundColor: '#0ea5e91a', borderRadius: 14, padding: 12 },
  invitePreviewEyebrow: { color: '#7dd3fc', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.4 },
  invitePreviewTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '900' },
  invitePreviewMeta: { color: '#cbd5e1', fontSize: 12, fontWeight: '800' },
  invitePreviewHelp: { color: '#94a3b8', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  invitePreviewActions: { marginTop: 4, gap: 8 },
  inviteConfirmButton: { borderRadius: 11, backgroundColor: '#38bdf8', paddingHorizontal: 12, paddingVertical: 11, alignItems: 'center' },
  inviteConfirmText: { color: '#082f49', fontSize: 12, fontWeight: '900' },
  inviteClearText: { color: '#94a3b8', fontSize: 11, fontWeight: '800', textAlign: 'center', textDecorationLine: 'underline' },
  refineButton: { borderWidth: 1, borderColor: '#475569', backgroundColor: '#172033', borderRadius: 12, minHeight: 44, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  refineButtonActive: { borderColor: '#38bdf880', backgroundColor: '#0ea5e926' },
  refineText: { color: '#cbd5e1', fontSize: 12, fontWeight: '800' },
  refineTextActive: { color: '#7dd3fc' },
  filterStack: { marginTop: 10, gap: 8 },
  filterRow: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  resetLink: { color: '#7dd3fc', textDecorationLine: 'underline', fontSize: 12, fontWeight: '700' },
  mineFiltersPanel: { gap: 10 },
  mineStatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mineStatTile: { width: '48%', minHeight: 72, borderWidth: 1, borderColor: '#ffffff14', borderRadius: 14, backgroundColor: '#ffffff08', paddingHorizontal: 10, paddingVertical: 10, justifyContent: 'center' },
  mineStatTileActive: { borderColor: '#38bdf866', backgroundColor: '#0ea5e922' },
  mineStatValue: { color: '#cbd5e1', fontSize: 22, fontWeight: '900' },
  mineStatWarn: { color: '#fcd34d' },
  mineStatBrand: { color: '#93c5fd' },
  mineStatSuccess: { color: '#4ade80' },
  mineStatDanger: { color: '#f87171' },
  mineStatLabel: { marginTop: 4, color: '#94a3b8', fontSize: 11, fontWeight: '800' },
  mineChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  activeMineFilterRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  activeFilterChip: { overflow: 'hidden', color: '#d1d5db', backgroundColor: '#1f2937', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, fontSize: 11, fontWeight: '700' },
  clearFilterText: { color: '#94a3b8', textDecorationLine: 'underline', fontSize: 11, fontWeight: '700' },
  meta: { color: colors.textMuted, marginTop: 4 },
  error: { color: '#fca5a5', marginTop: 4 },
  sectionBlock: { gap: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 2, borderWidth: 1, borderColor: '#26354d', backgroundColor: '#0b1324', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12 },
  sectionHeaderOpen: { borderColor: '#0ea5e980', backgroundColor: '#0e1b2f' },
  sectionHeaderLeft: { flex: 1, minWidth: 0 },
  sectionKicker: { color: '#7dd3fc', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 3 },
  sectionMeta: { color: '#64748b', fontSize: 11, fontWeight: '700', marginTop: 3 },
  sectionChevronBox: { width: 32, height: 32, borderRadius: 11, borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  sectionChevronBoxOpen: { borderColor: '#0ea5e966', backgroundColor: '#0ea5e922' },
  sectionChevron: { color: '#bae6fd', fontSize: 10, fontWeight: '900' },
  sectionTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '900' },
  mineSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#26354d', backgroundColor: '#0b1324', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12, gap: 12 },
  mineSectionHeaderOpen: { borderColor: '#0ea5e980', backgroundColor: '#0e1b2f' },
  mineSectionTitleRow: { flex: 1, minWidth: 0 },
  mineSectionChevron: { color: '#bae6fd', fontSize: 10, fontWeight: '900' },
  mineSectionTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '900' },
  noticeBox: { borderWidth: 1, borderColor: '#22c55e55', backgroundColor: '#22c55e1a', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 8 },
  noticeText: { color: '#bbf7d0', fontSize: 12, lineHeight: 17 },
  emptyText: { color: '#94a3b8', borderWidth: 1, borderColor: '#263244', backgroundColor: '#0f172a', borderRadius: 14, padding: 12 },
  compCard: { borderWidth: 1, borderRadius: 22, backgroundColor: '#111827', padding: 14, gap: 10 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' },
  badgeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
  sourceBadge: { borderWidth: 1, borderColor: '#22d3ee55', backgroundColor: '#06b6d41f', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  sourceBadgeText: { color: '#a5f3fc', fontSize: 10, fontWeight: '800' },
  joinedBadge: { borderWidth: 1, borderColor: '#38bdf866', backgroundColor: '#0ea5e91f', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  joinedBadgeText: { color: '#bae6fd', fontSize: 10, fontWeight: '900' },
  compTitle: { color: '#f8fafc', fontSize: 20, lineHeight: 25, fontWeight: '900' },
  clubRow: { minHeight: 22, flexDirection: 'row', alignItems: 'center', gap: 7 },
  clubLogo: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: '#ffffff26' },
  clubBadge: { maxWidth: '90%', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  clubBadgeText: { fontSize: 11, fontWeight: '900' },
  inviteBox: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 7 },
  inviteLabel: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.3 },
  inviteCode: { color: '#ffffff', backgroundColor: '#ffffff14', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  publicBox: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#ffffff1f', backgroundColor: '#ffffff0d', borderRadius: 11, paddingHorizontal: 10, paddingVertical: 7 },
  publicText: { color: '#d1d5db', fontSize: 12, fontWeight: '600' },
  descriptionSlot: { minHeight: 34 },
  description: { color: '#9ca3af', fontSize: 12, lineHeight: 17 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, columnGap: 12 },
  metaCell: { width: '47%', minHeight: 38 },
  metaLabel: { color: '#64748b', fontSize: 11, fontWeight: '700' },
  metaValue: { marginTop: 2, color: '#e5e7eb', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  metaBrand: { color: '#38bdf8', fontSize: 14, fontWeight: '900' },
  metaGreen: { color: '#4ade80', fontSize: 14, fontWeight: '900' },
  metaYellow: { color: '#facc15', fontSize: 14, fontWeight: '900' },
  survivorBarOuter: { height: 8, borderRadius: 999, backgroundColor: '#1f2937', overflow: 'hidden' },
  survivorBarInner: { height: '100%', borderRadius: 999, backgroundColor: '#22c55e' },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a', borderRadius: 12, minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  secondaryButtonText: { color: '#e5e7eb', fontSize: 13, fontWeight: '900' },
  primaryButton: { flex: 1, borderRadius: 12, minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  primaryButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  liveOnly: { flex: 1, borderWidth: 1, borderColor: '#22c55e66', backgroundColor: '#22c55e1f', borderRadius: 12, minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  liveOnlyText: { color: '#bbf7d0', fontSize: 12, fontWeight: '800' },
  myCard: { borderWidth: 1, borderColor: '#263244', borderRadius: 18, backgroundColor: '#111827', padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  myCardAction: { borderColor: '#f59e0b88', backgroundColor: '#f59e0b14' },
  myStatusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  dotGreen: { backgroundColor: '#22c55e' },
  dotRed: { backgroundColor: '#ef4444' },
  dotYellow: { backgroundColor: '#facc15' },
  dotNeutral: { backgroundColor: '#64748b' },
  myCardBody: { flex: 1, minWidth: 0 },
  myTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  myClubLogo: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: '#ffffff26' },
  myTitle: { flex: 1, color: '#f8fafc', fontSize: 15, fontWeight: '900' },
  entryBadge: { color: '#d1d5db', backgroundColor: '#ffffff14', borderRadius: 999, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 2, fontSize: 10, fontWeight: '800' },
  myStatusText: { marginTop: 3, color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  actionText: { color: '#fbbf24' },
  myChips: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  myChip: { color: '#d1d5db', borderWidth: 1, borderColor: '#ffffff17', backgroundColor: '#ffffff0a', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 10, fontWeight: '700' },
  myExpandedMeta: { marginTop: 9, borderTopWidth: 1, borderTopColor: '#ffffff12', paddingTop: 8, flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  myMetaText: { color: '#cbd5e1', fontSize: 11, fontWeight: '700' },
  openLink: { color: '#cbd5e1', fontSize: 12, fontWeight: '800', marginTop: 3 },
});
