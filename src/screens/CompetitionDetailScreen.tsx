import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, AppState, Image, RefreshControl, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import ViewShot from 'react-native-view-shot';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import type { Competition, Fixture, GameweekResponse, GameweekSelectionsData, MyStatusResponse, Participant, PickHistoryItem, PickResponse } from '../types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, MetaText, PrimaryButton, SectionTitle, StatusPill } from '../components/ui';
import { DataFreshnessBar } from '../components/DataFreshnessBar';
import { colors, spacing } from '../theme/tokens';

type PaymentConfigResponse = {
  publishableKey?: string | null;
};

type PaymentIntentResponse = {
  clientSecret: string;
  paymentIntentId: string;
  amountCents: number;
};

type GameweekDisplayMode = 'cards' | 'route';

type PickStat = {
  teamId?: number;
  teamName?: string;
  teamShortName: string;
  pickCount: number;
  percentage?: number;
};

type ConfidenceLabel = 'Safe' | 'Balanced' | 'Bold';

type PickConfidence = {
  label: ConfidenceLabel;
  score: number;
  source: 'odds' | 'crowd' | 'fallback';
  lowConfidence: boolean;
  marketChance?: number | null;
  pickShare?: number | null;
  explanation: string;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function impliedFromDecimalOdds(home?: number | null, draw?: number | null, away?: number | null) {
  if (!home || !draw || !away || home <= 1 || draw <= 1 || away <= 1) return null;
  const h = 1 / home;
  const d = 1 / draw;
  const a = 1 / away;
  const total = h + d + a;
  if (total <= 0) return null;
  return { home: h / total, draw: d / total, away: a / total };
}

function calculatePickConfidence(fixture: Fixture, side: 'home' | 'away', pickStat?: PickStat | null, gameweekStatus?: string): PickConfidence | null {
  if (gameweekStatus !== 'UPCOMING') return null;
  if (fixture.status === 'FINISHED' || fixture.status === 'POSTPONED' || fixture.status === 'CANCELLED') return null;

  const implied = side === 'home' ? fixture.oddsImpliedHome : fixture.oddsImpliedAway;
  const impliedFromOdds = impliedFromDecimalOdds(fixture.oddsHomeWin, fixture.oddsDraw, fixture.oddsAwayWin);
  const pRaw = implied ?? (side === 'home' ? impliedFromOdds?.home ?? NaN : impliedFromOdds?.away ?? NaN);
  const hasOdds = Number.isFinite(pRaw);
  const p = clamp01(hasOdds ? pRaw : NaN);

  if (!Number.isFinite(p) && !pickStat) {
    return null;
  }

  const oddsRisk = Number.isFinite(p) ? (1 - p) * 100 : null;
  const crowdRisk = pickStat ? (100 - (pickStat.percentage ?? 0)) : null;
  const combinedRisk = oddsRisk == null
    ? crowdRisk
    : crowdRisk == null
      ? oddsRisk
      : (oddsRisk * 0.75) + (crowdRisk * 0.25);
  if (combinedRisk == null) return null;

  const score = Math.round(combinedRisk);
  const marketChance = Number.isFinite(p) ? Math.round(p * 100) : null;
  const pickShare = pickStat?.percentage ?? null;
  // Football win probabilities are usually tightly grouped, so use thresholds that create useful pick guidance.
  const label: ConfidenceLabel = score <= 45 ? 'Safe' : score <= 62 ? 'Balanced' : 'Bold';
  const explanation = buildConfidenceExplanation(label, hasOdds, marketChance, pickShare);
  return { label, score, source: hasOdds ? 'odds' : 'crowd', lowConfidence: !hasOdds, marketChance, pickShare, explanation };
}

function buildConfidenceExplanation(label: ConfidenceLabel, hasOdds: boolean, marketChance?: number | null, pickShare?: number | null): string {
  const marketText = marketChance != null ? `Market gives this pick about ${marketChance}% to win.` : null;
  const crowdText = pickShare != null ? `${pickShare}% of players are on this team.` : null;
  const labelText = label === 'Safe'
    ? 'Safer profile: market strength is doing most of the work.'
    : label === 'Balanced'
      ? 'Balanced profile: playable, but not a free pass.'
      : 'Bold profile: higher upside if the crowd avoids it, but more knockout risk.';
  if (marketText && crowdText) return `${labelText} ${marketText} ${crowdText}`;
  if (marketText) return `${labelText} ${marketText}`;
  if (crowdText) return `${labelText} No live odds yet, so this uses pick share. ${crowdText}`;
  return hasOdds ? labelText : 'Limited data: waiting for odds or crowd data.';
}

function confidenceHelpText(confidence?: PickConfidence | null): string {
  if (!confidence) return '';
  if (confidence.source === 'fallback') return 'Limited data';
  if (confidence.lowConfidence) return 'Crowd estimate';
  return 'Odds + crowd';
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const dt = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatDateSafe(value?: string | null): string {
  if (!value) return '—';
  const dt = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString();
}


function formatDateShort(value?: string | null): string {
  const dt = parseDate(value);
  if (!dt) return '—';
  return dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + ', ' +
    dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function isPastDate(value?: string | null): boolean {
  const dt = parseDate(value);
  return !!dt && dt.getTime() < Date.now();
}

function distanceToNow(value?: string | null): string {
  const dt = parseDate(value);
  if (!dt) return 'soon';
  const diff = dt.getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.max(1, Math.round(abs / 60000));
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const unit = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : hours >= 1 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${mins} min${mins === 1 ? '' : 's'}`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

function prizeLabel(competition?: Competition): string {
  if (!competition) return '—';
  if (competition.prizePool && competition.prizePool > 0) return `€${competition.prizePool}`;
  if (competition.entryFee > 0) return `€${competition.entryFee}`;
  return 'Free';
}

function outcomeText(outcome?: string): string {
  switch (outcome) {
    case 'ADVANCE': return '✓ Advanced';
    case 'ELIMINATED': return '✗ Eliminated';
    case 'POSTPONED_ADVANCE': return '↷ Postponed';
    case 'OUT': return '○ Out';
    case 'PENDING': return '⏳ Pending';
    default: return outcome ?? 'PENDING';
  }
}

function statusTone(status?: string) {
  if (status === 'ACTIVE') return 'success' as const;
  if (status === 'UPCOMING') return 'brand' as const;
  if (status === 'COMPLETED') return 'warn' as const;
  return 'neutral' as const;
}


function formatKickoffDate(value?: string | null): string {
  const dt = parseDate(value);
  if (!dt) return '—';
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatKickoffTime(value?: string | null): string {
  const dt = parseDate(value);
  if (!dt) return '—';
  return dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function outcomeTone(outcome?: string) {
  if (outcome === 'WIN' || outcome === 'ADVANCE' || outcome === 'POSTPONED_ADVANCE') return 'success' as const;
  if (outcome === 'LOSS' || outcome === 'ELIMINATED' || outcome === 'OUT') return 'danger' as const;
  if (outcome === 'DRAW') return 'brand' as const;
  if (outcome === 'PENDING') return 'neutral' as const;
  return 'neutral' as const;
}

function pickOutcomeTextStyle(outcome?: string) {
  const normalized = String(outcome ?? '').toUpperCase();
  if (normalized === 'ADVANCE' || normalized === 'WIN') return styles.pickOutcomeAdvanced;
  if (normalized === 'ELIMINATED' || normalized === 'LOSS' || normalized === 'OUT') return styles.pickOutcomeEliminated;
  if (normalized === 'POSTPONED_ADVANCE' || normalized === 'DRAW') return styles.pickOutcomePostponed;
  return styles.pickOutcomePending;
}

function isResolvedPickOutcome(outcome?: string | null) {
  const normalized = String(outcome ?? '').toUpperCase();
  return Boolean(normalized && normalized !== 'PENDING');
}

export default function CompetitionDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<number>>(new Set());
  const [mobileInsightsOpen, setMobileInsightsOpen] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [lifelineForGwId, setLifelineForGwId] = useState<number | null>(null);
  const [lifelineClearedForGwId, setLifelineClearedForGwId] = useState<number | null>(null);
  const [optimisticPick, setOptimisticPick] = useState<{ gwId: number; teamId: number; teamName: string; teamShortName: string; useLifeline: boolean } | null>(null);
  const [mobileRulesOpen, setMobileRulesOpen] = useState(false);
  const [paymentActionError, setPaymentActionError] = useState<string | null>(null);
  const [paymentActionSuccess, setPaymentActionSuccess] = useState<string | null>(null);
  const [paymentInProgress, setPaymentInProgress] = useState(false);
  const [gameweekDisplayMode, setGameweekDisplayMode] = useState<GameweekDisplayMode>('cards');
  const [recapSharing, setRecapSharing] = useState(false);
  const recapCardRef = useRef<React.ElementRef<typeof ViewShot>>(null);

  const competitionQuery = useQuery({
    queryKey: ['competition', id],
    queryFn: async () => (await api.get<Competition>(`/competitions/${id}`)).data,
    enabled: Number.isFinite(id),
    staleTime: (query) => (query.state.data as Competition | undefined)?.status === 'COMPLETED' ? Infinity : 30_000,
    refetchInterval: (query) => {
      const competition = query.state.data as Competition | undefined;
      return competition?.status === 'ACTIVE' ? 300000 : false;
    },
  });

  const myEntriesQuery = useQuery({
    queryKey: ['competition', id, 'my-entries'],
    queryFn: async () => (await api.get<Participant[]>(`/competitions/${id}/my-entries`)).data ?? [],
    enabled: Number.isFinite(id),
    staleTime: competitionQuery.data?.status === 'COMPLETED' ? Infinity : 30_000,
  });

  useEffect(() => {
    if (!myEntriesQuery.data || myEntriesQuery.data.length === 0) {
      setSelectedEntryId(null);
      return;
    }
    if (selectedEntryId && myEntriesQuery.data.some((e) => e.id === selectedEntryId)) return;
    setSelectedEntryId(myEntriesQuery.data[0].id);
  }, [myEntriesQuery.data, selectedEntryId]);

  useEffect(() => {
    setOptimisticPick(null);
  }, [selectedEntryId]);

  const joined = (myEntriesQuery.data?.length ?? 0) > 0;
  const activeCompetition = competitionQuery.data?.status === 'ACTIVE';
  const activeDetailRefetchInterval = activeCompetition ? 300000 : false;
  const cachedCurrentGameweek = queryClient.getQueryData<GameweekResponse>(['competition', id, 'current-gameweek']);
  const liveDetailRefetchInterval = cachedCurrentGameweek?.status === 'IN_PROGRESS' ? 300000 : false;
  const maxEntriesPerUser = Math.max(1, Number(competitionQuery.data?.maxEntriesPerUser ?? 1));
  const canJoinCompetition = Boolean(competitionQuery.data?.status === 'UPCOMING' && !competitionQuery.data?.paused && !joined);
  const canAddAnotherEntry = Boolean(competitionQuery.data?.status === 'UPCOMING' && !competitionQuery.data?.paused && joined && (myEntriesQuery.data?.length ?? 0) < maxEntriesPerUser);

  const myStatusQuery = useQuery({
    queryKey: ['competition', id, 'my-status', selectedEntryId],
    queryFn: async () => (await api.get<MyStatusResponse>(`/competitions/${id}/me`, { params: selectedEntryId ? { entryId: selectedEntryId } : undefined })).data,
    enabled: Number.isFinite(id) && joined,
    staleTime: competitionQuery.data?.status === 'COMPLETED' ? Infinity : 30_000,
    refetchInterval: liveDetailRefetchInterval,
  });

  const joinMutation = useMutation({
    mutationFn: async () => api.post(`/competitions/${id}/join`),
    onSuccess: async () => {
      await Promise.all([
        myEntriesQuery.refetch(),
        competitionQuery.refetch(),
        myStatusQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['competitions-my-details'] }),
        queryClient.invalidateQueries({ queryKey: ['competitions-upcoming'] }),
        queryClient.invalidateQueries({ queryKey: ['survivor-table', id] }),
      ]);
    },
  });


  const pickMutation = useMutation({
    mutationFn: async ({ gwId, teamId, useLifeline }: { gwId: number; teamId: number; teamName: string; teamShortName: string; useLifeline: boolean }) => api.post(`/competitions/${id}/gameweeks/${gwId}/pick`, {
      teamId,
      entryId: selectedEntryId ?? undefined,
      useLifeline,
    }),
    onMutate: ({ gwId, teamId, teamName, teamShortName, useLifeline }) => {
      setOptimisticPick({ gwId, teamId, teamName, teamShortName, useLifeline });
      const queryKey = ['competition', id, 'my-status', selectedEntryId] as const;
      const previous = queryClient.getQueryData<MyStatusResponse>(queryKey);
      queryClient.setQueryData<MyStatusResponse>(queryKey, (current) => {
        if (!current) return current;
        const nextUsed = new Set(current.usedTeamIds ?? []);
        const previousPick = current.picks.find((pick) => pick.gameweekId === gwId);
        if (previousPick) nextUsed.delete(previousPick.teamId);
        nextUsed.add(teamId);
        return {
          ...current,
          usedTeamIds: Array.from(nextUsed),
          picks: current.picks.map((pick) => pick.gameweekId === gwId ? {
            ...pick,
            teamId,
            teamName,
            teamShortName,
            useLifeline,
          } : pick),
        };
      });
      return { queryKey, previous };
    },
    onSuccess: (_response, variables) => {
      if (variables.useLifeline) {
        setLifelineClearedForGwId(null);
        setLifelineForGwId(variables.gwId);
      } else {
        setLifelineForGwId((current) => current === variables.gwId ? null : current);
      }
      queryClient.invalidateQueries({ queryKey: ['competition', id, 'my-status', selectedEntryId] });
      queryClient.invalidateQueries({ queryKey: ['competition', id, 'my-pick'] });
      queryClient.invalidateQueries({ queryKey: ['competition', id, 'pick-stats'] });
      queryClient.invalidateQueries({ queryKey: ['competition', id, 'selections'] });
      queryClient.invalidateQueries({ queryKey: ['competitions-my-details'] });
      queryClient.invalidateQueries({ queryKey: ['competitions-upcoming'] });
      queryClient.invalidateQueries({ queryKey: ['survivor-table', id] });
      queryClient.invalidateQueries({ queryKey: ['gameweek-results', id, variables.gwId] });
      queryClient.invalidateQueries({ queryKey: ['gameweek-results-pick-stats', id, variables.gwId] });
    },
    onError: (_error, _vars, context) => {
      setOptimisticPick(null);
      if (context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
    },
  });

  const currentGameweekQuery = useQuery({
    queryKey: ['competition', id, 'current-gameweek'],
    queryFn: async () => (await api.get<GameweekResponse>(`/competitions/${id}/gameweeks/current`)).data,
    enabled: Number.isFinite(id),
    staleTime: competitionQuery.data?.status === 'COMPLETED' ? Infinity : 30_000,
    refetchInterval: activeDetailRefetchInterval,
  });

  const fixturesQuery = useQuery({
    queryKey: ['competition', id, 'fixtures-all'],
    queryFn: async () => {
      return (await api.get<Fixture[]>(`/competitions/${id}/fixtures?weeks=99`)).data ?? [];
    },
    enabled: Number.isFinite(id),
    staleTime: competitionQuery.data?.status === 'COMPLETED' ? Infinity : 30_000,
    refetchInterval: liveDetailRefetchInterval,
  });

  const myPickQuery = useQuery({
    queryKey: ['competition', id, 'my-pick', currentGameweekQuery.data?.id, selectedEntryId],
    queryFn: async () => {
      const currentGameweek = currentGameweekQuery.data;
      if (!currentGameweek?.id) return null;
      try {
        return (await api.get<PickResponse>(`/competitions/${id}/gameweeks/${currentGameweek.id}/my-pick`, {
          params: selectedEntryId ? { entryId: selectedEntryId } : undefined,
        })).data;
      } catch {
        return null;
      }
    },
    enabled: Number.isFinite(id) && !!currentGameweekQuery.data?.id && joined,
    refetchInterval: liveDetailRefetchInterval,
  });

  const pickStatsQuery = useQuery<PickStat[]>({
    queryKey: ['competition', id, 'pick-stats', currentGameweekQuery.data?.id],
    queryFn: async () => {
      const currentGameweek = currentGameweekQuery.data;
      if (!currentGameweek?.id) return [] as PickStat[];
      return (await api.get<PickStat[]>(`/competitions/${id}/gameweeks/${currentGameweek.id}/pick-stats`)).data ?? [];
    },
    enabled: Number.isFinite(id),
    refetchInterval: liveDetailRefetchInterval,
  });

  const selectionsQuery = useQuery({
    queryKey: ['competition', id, 'selections', currentGameweekQuery.data?.id],
    queryFn: async () => {
      const currentGameweek = currentGameweekQuery.data;
      if (!currentGameweek?.id) return [] as Array<{ outcome?: string; useLifeline?: boolean }>;
      const payload = (await api.get<{ selections?: Array<{ outcome?: string; useLifeline?: boolean }> }>(`/competitions/${id}/gameweeks/${currentGameweek.id}/selections`)).data;
      return payload?.selections ?? [];
    },
    enabled: Number.isFinite(id),
    refetchInterval: liveDetailRefetchInterval,
  });


  const refreshing = competitionQuery.isRefetching || currentGameweekQuery.isRefetching || fixturesQuery.isRefetching || myPickQuery.isRefetching || myEntriesQuery.isRefetching || myStatusQuery.isRefetching || pickStatsQuery.isRefetching || selectionsQuery.isRefetching;

  const refreshCompetitionDetail = useCallback(async () => {
    await Promise.all([
      competitionQuery.refetch(),
      myEntriesQuery.refetch(),
      myStatusQuery.refetch(),
      currentGameweekQuery.refetch(),
      fixturesQuery.refetch(),
      myPickQuery.refetch(),
      pickStatsQuery.refetch(),
      selectionsQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['competition', id, 'pick-stats'] }),
      queryClient.invalidateQueries({ queryKey: ['competition', id, 'selections'] }),
    ]);
  }, [
    competitionQuery.refetch,
    currentGameweekQuery.refetch,
    fixturesQuery.refetch,
    id,
    myEntriesQuery.refetch,
    myPickQuery.refetch,
    myStatusQuery.refetch,
    pickStatsQuery.refetch,
    queryClient,
    selectionsQuery.refetch,
  ]);

  const onRefresh = async () => {
    await refreshCompetitionDetail();
  };

  useFocusEffect(
    useCallback(() => {
      if (!Number.isFinite(id)) return;
      void refreshCompetitionDetail();
    }, [id, refreshCompetitionDetail]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Number.isFinite(id)) {
        void refreshCompetitionDetail();
      }
    });
    return () => subscription.remove();
  }, [id, refreshCompetitionDetail]);

  if (!Number.isFinite(id)) {
    return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}><Text style={styles.error}>Invalid competition id.</Text></SafeAreaView>;
  }

  const competition = competitionQuery.data;
  const currentGameweek = currentGameweekQuery.data;
  const fixtures = fixturesQuery.data;
  const myPick = myPickQuery.data;
  const selectedEntry = useMemo(() => myEntriesQuery.data?.find((e) => e.id === selectedEntryId) ?? null, [myEntriesQuery.data, selectedEntryId]);
  const participant = myStatusQuery.data?.participant;
  const isParticipant = Boolean(participant || joined);
  const isEliminated = selectedEntry?.status === 'ELIMINATED' || participant?.status === 'ELIMINATED';
  const isWinner = selectedEntry?.status === 'WINNER' || participant?.status === 'WINNER';
  const selectedEntryNumber = participant?.entryNumber ?? selectedEntry?.entryNumber ?? null;
  const selectedEntryLabel = (myEntriesQuery.data?.length ?? 0) > 1 && selectedEntryNumber ? `Entry #${selectedEntryNumber}` : null;
  const awaitingPayment = selectedEntry?.paymentState === 'AWAITING_PAYMENT' || participant?.paymentState === 'AWAITING_PAYMENT';
  const onlinePaymentRequired = Boolean(competition?.paymentMode === 'STRIPE' && (competition?.entryFee ?? 0) > 0);
  const awaitingOnlinePayment = Boolean(awaitingPayment && competition?.paymentMode === 'STRIPE');
  const strictManualPayment = competition?.paymentMode === 'MANUAL' && competition?.manualPaymentPolicy !== 'LENIENT';
  const paymentBlocksPicks = awaitingOnlinePayment || (awaitingPayment && strictManualPayment);
  const canPick = Boolean(joined && !competition?.paused && currentGameweek?.status === 'UPCOMING' && !paymentBlocksPicks && selectedEntry?.status === 'ACTIVE');
  const participantCount = competition?.participantCount ?? 0;

  const pickHistory = (myStatusQuery.data?.picks ?? []).slice().sort((a, b) => b.weekNumber - a.weekNumber);
  const myPickByGameweek = useMemo(() => {
    const map = new Map<number, { teamId: number; teamName: string; teamShortName: string; locked: boolean; useLifeline?: boolean; outcome?: string }>();
    for (const pick of myStatusQuery.data?.picks ?? []) map.set(pick.gameweekId, pick);
    return map;
  }, [myStatusQuery.data?.picks]);
  const handlePick = (pick: { gwId: number; teamId: number; teamName: string; teamShortName: string; useLifeline: boolean }) => {
    if (competition?.paused) {
      Alert.alert('Competition paused', competition.pauseReason ?? 'Picks will reopen when the club admin resumes the competition.');
      return;
    }
    if (pickMutation.isPending) return;
    const currentPick = myPickByGameweek.get(pick.gwId);
    if (currentPick?.teamId === pick.teamId && Boolean(currentPick.useLifeline) === pick.useLifeline) return;
    pickMutation.mutate(pick);
  };

  const savedLifelineGameweekId = myStatusQuery.data?.picks.find((pick) => pick.useLifeline)?.gameweekId ?? null;
  const pendingLifelineGameweekId = lifelineForGwId ?? (lifelineClearedForGwId != null ? null : savedLifelineGameweekId);
  const lifelineStatusLabel = !competition?.lifelineEnabled
    ? 'Lifeline disabled'
    : !isParticipant
      ? 'Lifeline enabled'
      : participant?.lifelineUsed
        ? `Lifeline used${participant.lifelineUsedWeek ? ` · GW ${participant.lifelineUsedWeek}` : ''}`
        : pendingLifelineGameweekId
          ? 'Lifeline selected'
          : 'Lifeline available';

  const gameweeks = useMemo(() => {
    const map = new Map<number, { weekNumber: number; gameweekId: number; gameweekStatus: string; gameweekVoided?: boolean; gameweekVoidReason?: string | null; lockAt: string; fixtures: Fixture[] }>();
    for (const fixture of fixtures ?? []) {
      const fx = fixture as Fixture & { gameweekStatus?: string; gameweekLockAt?: string; gameweekVoided?: boolean; gameweekVoidReason?: string | null };
      const existing = map.get(fixture.weekNumber);
      if (existing) {
        existing.fixtures.push(fixture);
        if (!existing.lockAt && fx.gameweekLockAt) existing.lockAt = fx.gameweekLockAt;
        if (existing.gameweekStatus === 'UPCOMING' && fx.gameweekStatus) existing.gameweekStatus = fx.gameweekStatus;
      } else {
        map.set(fixture.weekNumber, {
          weekNumber: fixture.weekNumber,
          gameweekId: fixture.gameweekId,
          gameweekStatus: fx.gameweekStatus ?? 'UPCOMING',
          gameweekVoided: fx.gameweekVoided,
          gameweekVoidReason: fx.gameweekVoidReason,
          lockAt: fx.gameweekLockAt ?? '',
          fixtures: [fixture],
        });
      }
    }

    const ordered = [...map.values()].sort((a, b) => a.weekNumber - b.weekNumber);

    // Match web behavior: fixtures sorted by kickoff ascending within week.
    for (const gw of ordered) {
      gw.fixtures.sort((a, b) => {
        const da = parseDate(a.kickoffAt)?.getTime() ?? 0;
        const db = parseDate(b.kickoffAt)?.getTime() ?? 0;
        return da - db;
      });

      // Fallback derive week status from fixture statuses when backend week status missing.
      if (!gw.gameweekStatus || gw.gameweekStatus === 'UPCOMING') {
        const statuses = gw.fixtures.map((f) => f.status);
        if (statuses.some((st) => st === 'IN_PLAY')) gw.gameweekStatus = 'IN_PROGRESS';
        else if (statuses.every((st) => st === 'FINISHED' || st === 'POSTPONED' || st === 'CANCELLED')) gw.gameweekStatus = 'COMPLETED';
      }
    }

    return ordered;
  }, [fixtures]);

  const openPickGameweeks = useMemo(
    () => competition?.status === 'COMPLETED'
      ? []
      : gameweeks.filter((gw) => gw.gameweekStatus === 'UPCOMING' && !isPastDate(gw.lockAt)),
    [competition?.status, gameweeks],
  );
  const missingPickGameweeks = useMemo(
    () => openPickGameweeks.filter((gw) => !myPickByGameweek.has(gw.gameweekId)),
    [openPickGameweeks, myPickByGameweek],
  );
  const hasMissingOpenPick = missingPickGameweeks.length > 0;
  const nextMissingPickWeek = missingPickGameweeks[0] ?? null;
  const nextFutureLockWeek = openPickGameweeks[0] ?? null;
  const nextFutureLockLabel = nextFutureLockWeek?.lockAt ? `Next lock: ${distanceToNow(nextFutureLockWeek.lockAt)}` : null;

  const gameweekMetaById = useMemo(() => {
    const map = new Map<number, { status: string; lockAt: string }>();
    for (const gw of gameweeks) {
      map.set(gw.gameweekId, { status: gw.gameweekStatus, lockAt: gw.lockAt });
    }
    return map;
  }, [gameweeks]);

  const { consumedTeamIds, reservedTeamIds } = useMemo(() => {
    const consumed = new Set<number>();
    const reserved = new Set<number>();
    const pickTeamIds = new Set<number>();

    for (const pick of myStatusQuery.data?.picks ?? []) {
      pickTeamIds.add(pick.teamId);
      const meta = gameweekMetaById.get(pick.gameweekId);
      const isUpcoming = meta?.status === 'UPCOMING' && !isPastDate(meta.lockAt);
      if (isUpcoming && !pick.locked && pick.outcome === 'PENDING') {
        reserved.add(pick.teamId);
      } else {
        consumed.add(pick.teamId);
      }
    }

    for (const teamId of myStatusQuery.data?.usedTeamIds ?? []) {
      if (!pickTeamIds.has(teamId)) consumed.add(teamId);
    }

    return { consumedTeamIds: consumed, reservedTeamIds: reserved };
  }, [gameweekMetaById, myStatusQuery.data?.picks, myStatusQuery.data?.usedTeamIds]);

  const lockedGameweeks = useMemo(
    () => gameweeks.filter((gw) => gw.gameweekStatus === 'LOCKED' || gw.gameweekStatus === 'IN_PROGRESS' || gw.gameweekStatus === 'COMPLETED' || isPastDate(gw.lockAt)),
    [gameweeks],
  );

  const pickStatsResults = useQueries({
    queries: lockedGameweeks.map((gw) => ({
      queryKey: ['competition', id, 'pick-stats', gw.gameweekId],
      queryFn: async () => (await api.get<PickStat[]>(`/competitions/${id}/gameweeks/${gw.gameweekId}/pick-stats`)).data ?? [],
      enabled: Number.isFinite(id),
      staleTime: 0,
    })),
  });

  const pickStatsByGameweek = useMemo(() => {
    const byGameweek = new Map<number, Map<string, PickStat>>();
    lockedGameweeks.forEach((gw, index) => {
      const rawStats = (pickStatsResults[index]?.data ?? []) as PickStat[];
      const total = rawStats.reduce((sum, stat) => sum + (stat.pickCount ?? 0), 0);
      const teamMap = new Map<string, PickStat>();
      rawStats.forEach((stat) => {
        const normalized = {
          ...stat,
          percentage: typeof stat.percentage === 'number'
            ? stat.percentage
            : total > 0
            ? Math.round(((stat.pickCount ?? 0) / total) * 100)
            : 0,
        };
        if (normalized.teamId != null) teamMap.set(`id:${normalized.teamId}`, normalized);
        teamMap.set(`short:${normalized.teamShortName}`, normalized);
        if (normalized.teamName) teamMap.set(`name:${normalized.teamName}`, normalized);
      });
      byGameweek.set(gw.gameweekId, teamMap);
    });
    return byGameweek;
  }, [lockedGameweeks, pickStatsResults]);

  const resolvedGameweeks = useMemo(
    () => gameweeks.filter((gw) => gw.gameweekStatus === 'IN_PROGRESS' || gw.gameweekStatus === 'COMPLETED'),
    [gameweeks],
  );

  const selectionResults = useQueries({
    queries: resolvedGameweeks.map((gw) => ({
      queryKey: ['competition', id, 'selections', gw.gameweekId],
      queryFn: async () => {
        const res = await api.get<GameweekSelectionsData | GameweekSelectionsData['selections']>(`/competitions/${id}/gameweeks/${gw.gameweekId}/selections`);
        return Array.isArray(res.data) ? { selections: res.data, byeGranted: false, weekNumber: gw.weekNumber } as GameweekSelectionsData : res.data;
      },
      enabled: Number.isFinite(id),
      staleTime: 0,
    })),
  });

  const selectionsByGameweek = useMemo(() => {
    const byGameweek = new Map<number, GameweekSelectionsData>();
    resolvedGameweeks.forEach((gw, index) => {
      const data = selectionResults[index]?.data as GameweekSelectionsData | GameweekSelectionsData['selections'] | undefined;
      if (Array.isArray(data)) {
        byGameweek.set(gw.gameweekId, { selections: data, byeGranted: false, weekNumber: gw.weekNumber });
      } else if (data && Array.isArray(data.selections)) {
        byGameweek.set(gw.gameweekId, data);
      }
    });
    return byGameweek;
  }, [resolvedGameweeks, selectionResults]);

  const liveOutcomeByGameweek = useMemo(() => {
    const outcomes = new Map<number, string>();
    const participantId = selectedEntryId ?? participant?.id ?? null;
    for (const [gameweekId, data] of selectionsByGameweek.entries()) {
      const savedPick = myPickByGameweek.get(gameweekId);
      if (!savedPick) continue;
      const selections = Array.isArray(data.selections) ? data.selections : [];
      const selection = selections.find((item) => {
        const sameParticipant = participantId != null && item.participantId === participantId;
        const sameEntryNumber = participantId == null && selectedEntryNumber != null && item.entryNumber === selectedEntryNumber;
        return (sameParticipant || sameEntryNumber) && item.teamId === savedPick.teamId;
      });
      const liveOutcome = selection?.outcome?.toUpperCase();
      if (liveOutcome && liveOutcome !== 'PENDING') outcomes.set(gameweekId, liveOutcome);
    }
    return outcomes;
  }, [myPickByGameweek, participant?.id, selectedEntryId, selectedEntryNumber, selectionsByGameweek]);

  const displayPickHistory = useMemo(() => pickHistory.map((pick) => {
    const liveOutcome = liveOutcomeByGameweek.get(pick.gameweekId);
    if (!liveOutcome || isResolvedPickOutcome(pick.outcome)) return pick;
    return { ...pick, outcome: liveOutcome };
  }), [liveOutcomeByGameweek, pickHistory]);

  const latestNarrativeWeek = useMemo(() => {
    return [...gameweeks]
      .reverse()
      .find((gw) =>
        (gw.gameweekStatus === 'IN_PROGRESS' || gw.gameweekStatus === 'COMPLETED')
        && gw.fixtures.some((fixture) => fixture.status === 'FINISHED' || fixture.status === 'POSTPONED' || fixture.status === 'CANCELLED')
      ) ?? [...gameweeks].reverse().find((gw) => gw.gameweekStatus === 'COMPLETED') ?? null;
  }, [gameweeks]);

  const latestNarrativeTeamIds = useMemo(() => {
    const ids = new Set<number>();
    latestNarrativeWeek?.fixtures.forEach((fixture) => {
      ids.add(fixture.homeTeamId);
      ids.add(fixture.awayTeamId);
    });
    return ids;
  }, [latestNarrativeWeek]);
  const latestPickStatsIndex = latestNarrativeWeek ? lockedGameweeks.findIndex((gw) => gw.gameweekId === latestNarrativeWeek.gameweekId) : -1;
  const latestSelectionsIndex = latestNarrativeWeek ? resolvedGameweeks.findIndex((gw) => gw.gameweekId === latestNarrativeWeek.gameweekId) : -1;
  const latestPickStatsQuery = latestPickStatsIndex >= 0 ? pickStatsResults[latestPickStatsIndex] : undefined;
  const latestSelectionsQuery = latestSelectionsIndex >= 0 ? selectionResults[latestSelectionsIndex] : undefined;
  const latestNarrativePickStatsLoading = latestPickStatsIndex >= 0
    && (latestPickStatsQuery?.data === undefined || Boolean(latestPickStatsQuery?.isFetching));
  const latestNarrativeSelectionsLoading = latestSelectionsIndex >= 0
    && (latestSelectionsQuery?.data === undefined || Boolean(latestSelectionsQuery?.isFetching));

  const latestNarrativeStatsAll = latestNarrativeWeek && !latestNarrativeWeek.gameweekVoided
    ? [...(pickStatsByGameweek.get(latestNarrativeWeek.gameweekId)?.values() ?? [])]
        .filter((stat, index, arr) => stat.teamId != null && latestNarrativeTeamIds.has(stat.teamId) && arr.findIndex((other) => other.teamId === stat.teamId) === index)
        .sort((a, b) => b.pickCount - a.pickCount)
    : [];

  const latestSelectionsData = latestNarrativeWeek ? selectionsByGameweek.get(latestNarrativeWeek.gameweekId) : undefined;
  const latestSelections = latestSelectionsData?.selections ?? [];
  const resolvedSelections = latestSelections.filter((selection) => String(selection.outcome ?? '').toUpperCase() !== 'PENDING');
  const narrativeTeamResults = useMemo(() => {
    const results = new Map<number, 'WIN' | 'LOSS' | 'DRAW' | 'POSTPONED'>();
    if (!latestNarrativeWeek || latestNarrativeWeek.gameweekVoided) return results;
    latestNarrativeWeek.fixtures.forEach((fixture) => {
      if (fixture.status === 'POSTPONED' || fixture.status === 'CANCELLED') {
        results.set(fixture.homeTeamId, 'POSTPONED');
        results.set(fixture.awayTeamId, 'POSTPONED');
        return;
      }
      if (fixture.status !== 'FINISHED' || fixture.scoreHome == null || fixture.scoreAway == null) return;
      if (fixture.scoreHome > fixture.scoreAway) {
        results.set(fixture.homeTeamId, 'WIN');
        results.set(fixture.awayTeamId, 'LOSS');
      } else if (fixture.scoreHome < fixture.scoreAway) {
        results.set(fixture.homeTeamId, 'LOSS');
        results.set(fixture.awayTeamId, 'WIN');
      } else {
        results.set(fixture.homeTeamId, 'DRAW');
        results.set(fixture.awayTeamId, 'DRAW');
      }
    });
    return results;
  }, [latestNarrativeWeek]);
  const narrativeWeekInProgress = latestNarrativeWeek?.gameweekStatus === 'IN_PROGRESS';
  const narrativeWeekVoided = Boolean(latestNarrativeWeek?.gameweekVoided);
  const latestNarrativeStats = narrativeWeekInProgress
    ? latestNarrativeStatsAll.filter((stat) => stat.teamId != null && narrativeTeamResults.has(stat.teamId))
    : latestNarrativeStatsAll;
  const mostBackedTeam = latestNarrativeStats[0] ?? null;
  const losingPickedTeam = latestNarrativeStats.find((stat) => stat.teamId != null && narrativeTeamResults.get(stat.teamId) === 'LOSS') ?? null;
  const contrarianSurvivor = [...latestNarrativeStats].reverse().find((stat) => {
    if (stat.teamId == null || stat.pickCount <= 0) return false;
    const result = narrativeTeamResults.get(stat.teamId);
    return result === 'WIN' || result === 'POSTPONED';
  }) ?? null;
  const survivingPickedTeams = latestNarrativeStats.filter((stat) => stat.teamId != null && ['WIN', 'POSTPONED'].includes(String(narrativeTeamResults.get(stat.teamId))));
  const losingPickedTeams = latestNarrativeStats.filter((stat) => stat.teamId != null && narrativeTeamResults.get(stat.teamId) === 'LOSS');
  const gwPickedCount = resolvedSelections.length;
  const gwPendingSelectionCount = Math.max(latestSelections.length - resolvedSelections.length, 0);
  const gwAdvancedCount = resolvedSelections.filter((selection) => {
    const outcome = String(selection.outcome ?? '').toUpperCase();
    return outcome === 'ADVANCE' || outcome === 'POSTPONED_ADVANCE';
  }).length;
  const gwEliminatedFromSelections = resolvedSelections.filter((selection) => {
    const outcome = String(selection.outcome ?? '').toUpperCase();
    return outcome === 'ELIMINATED' || outcome === 'LOSS' || outcome === 'OUT';
  }).length;
  const gwSurvivalFromSelections = gwPickedCount > 0 ? Math.round((gwAdvancedCount / gwPickedCount) * 100) : null;
  const gwActiveAtStart = latestSelectionsData?.activeAtStart ?? null;
  const gwAdvancedThisWeek = latestSelectionsData?.advancedThisWeek ?? null;
  const gwEliminatedThisWeek = latestSelectionsData?.eliminatedThisWeek ?? null;
  const gwSurvivalFromBackend = (gwActiveAtStart != null && gwAdvancedThisWeek != null && gwActiveAtStart > 0)
    ? Math.round((gwAdvancedThisWeek / gwActiveAtStart) * 100)
    : null;
  const totalResolvedPicks = latestNarrativeStats.reduce((sum, stat) => sum + (stat.pickCount ?? 0), 0);
  const survivingResolvedPicks = survivingPickedTeams.reduce((sum, stat) => sum + (stat.pickCount ?? 0), 0);
  const computedWeeklySurvivalRate = totalResolvedPicks > 0 ? Math.round((survivingResolvedPicks / totalResolvedPicks) * 100) : null;
  let weeklySurvivalRate = narrativeWeekInProgress
    ? (gwSurvivalFromSelections ?? computedWeeklySurvivalRate)
    : (gwSurvivalFromBackend ?? gwSurvivalFromSelections ?? computedWeeklySurvivalRate);
  let weeklyPickedCount = narrativeWeekInProgress
    ? (gwPickedCount || totalResolvedPicks || 0)
    : (gwActiveAtStart ?? (gwPickedCount || totalResolvedPicks || 0));
  let weeklyAdvancedCount = narrativeWeekInProgress
    ? (gwAdvancedCount || survivingResolvedPicks || 0)
    : (gwAdvancedThisWeek ?? (gwAdvancedCount || survivingResolvedPicks || 0));
  let weeklyEliminatedCount = narrativeWeekInProgress
    ? gwEliminatedFromSelections
    : (gwEliminatedThisWeek ?? (weeklyPickedCount > 0 ? Math.max(weeklyPickedCount - weeklyAdvancedCount, 0) : 0));
  if (narrativeWeekVoided) {
    weeklyPickedCount = gwActiveAtStart ?? (competition?.activeCount ?? 0);
    weeklyAdvancedCount = weeklyPickedCount;
    weeklyEliminatedCount = 0;
    weeklySurvivalRate = weeklyPickedCount > 0 ? 100 : null;
  }
  const biggestCasualty = narrativeWeekVoided ? null : weeklyEliminatedCount > 0 ? losingPickedTeam : null;
  const doomedPickedTeams = narrativeWeekVoided ? [] : weeklyEliminatedCount > 0 ? losingPickedTeams : [];
  const baseEliminatedCount = Math.max(participantCount - (competition?.activeCount ?? 0), 0);
  const liveWeekExtraEliminations = narrativeWeekInProgress ? gwEliminatedFromSelections : 0;
  const effectiveEliminatedCount = Math.min(baseEliminatedCount + liveWeekExtraEliminations, participantCount);
  const effectiveActiveCount = Math.max(participantCount - effectiveEliminatedCount, 0);
  const eliminatedCount = effectiveEliminatedCount;
  const survivalRate = participantCount > 0 ? Math.max(Math.round((effectiveActiveCount / participantCount) * 100), effectiveActiveCount > 0 ? 1 : 0) : 0;
  const lifelinesPlayedThisWeek = narrativeWeekVoided ? 0 : latestSelections.filter((selection) => Boolean(selection.useLifeline)).length;
  const narrativeFixtureCount = latestNarrativeWeek?.fixtures.length ?? 0;
  const narrativeResolvedFixtureCount = latestNarrativeWeek?.fixtures.filter((fixture) =>
    fixture.status === 'FINISHED' || fixture.status === 'POSTPONED' || fixture.status === 'CANCELLED'
  ).length ?? 0;
  const narrativePendingFixtureCount = Math.max(narrativeFixtureCount - narrativeResolvedFixtureCount, 0);
  const narrativeWeekLabel = latestNarrativeWeek ? `Gameweek ${latestNarrativeWeek.weekNumber}` : null;
  const hasWinner = Boolean(competition?.status === 'COMPLETED' || ((competition?.activeCount ?? 0) === 1 && (competition?.participantCount ?? 0) > 1));
  const latestResolvedPick = pickHistory.filter((pick) => pick.outcome && pick.outcome !== 'PENDING').sort((a, b) => b.weekNumber - a.weekNumber)[0] ?? null;

  const pulseVariantSeed = Number(competition?.id ?? 0)
    + ((latestNarrativeWeek?.weekNumber ?? currentGameweek?.weekNumber ?? 0) * 17)
    + (weeklyEliminatedCount * 7)
    + (biggestCasualty?.pickCount ?? mostBackedTeam?.pickCount ?? 0);
  const pickPulseVariant = (options: string[], offset: number) => options[Math.abs(pulseVariantSeed + offset) % options.length];

  let pulseTitle = pickPulseVariant([
    'Competition pressure is building',
    'The margins are tightening',
    'Every round is starting to matter more',
    'The field is entering pressure time',
  ], 101);
  let pulseBody = competition?.status === 'UPCOMING'
    ? pickPulseVariant([
        'Registration is open and the first real pressure point is the next lock.',
        'Entries are still open, but urgency begins at the next lock deadline.',
        'The competition is open; the first true decision point is the upcoming lock.',
      ], 102)
    : pickPulseVariant([
        'The next pick window is where this competition starts to separate cautious players from survivors.',
        'The next lock is where this field starts splitting into survivors and exits.',
        'From the next pick onward, small calls start creating real separation.',
      ], 103);

  if (narrativeWeekVoided && latestNarrativeWeek) {
    pulseTitle = `Gameweek ${latestNarrativeWeek.weekNumber} was voided`;
    pulseBody = latestNarrativeWeek.gameweekVoidReason
      ?? 'The competition was paused when this gameweek locked. No results were applied, nobody was eliminated, and all active entries move on.';
  } else if (hasWinner) {
    const winnerName = competition?.winnerUsername ?? (isWinner ? 'You' : 'One player');
    pulseTitle = isWinner ? 'You won this competition' : 'We have a winner';
    pulseBody = `${winnerName} is the last survivor standing${latestNarrativeWeek ? ` after Gameweek ${latestNarrativeWeek.weekNumber}` : ''}. Every round survived, every pick paid off.`;
  } else if (latestNarrativeWeek && biggestCasualty) {
    const wn = latestNarrativeWeek.weekNumber;
    const bigLoss = biggestCasualty.pickCount >= 3;
    const titleOptions = bigLoss
      ? [
          narrativeWeekInProgress ? `Gameweek ${wn} is shaking the field` : `Gameweek ${wn} shook the field`,
          narrativeWeekInProgress ? `Gameweek ${wn} has a costly upset` : `Gameweek ${wn} had a costly upset`,
          narrativeWeekInProgress ? `Gameweek ${wn} is catching the crowd out` : `Gameweek ${wn} caught the crowd out`,
          narrativeWeekInProgress ? `Gameweek ${wn} is making its mark` : `Gameweek ${wn} made its mark`,
          narrativeWeekInProgress ? `Gameweek ${wn} is punishing the popular pick` : `Gameweek ${wn} punished the popular pick`,
          narrativeWeekInProgress ? `Gameweek ${wn} is exposing the bandwagon` : `Gameweek ${wn} exposed the bandwagon`,
          narrativeWeekInProgress ? `Gameweek ${wn} is turning safe picks risky` : `Gameweek ${wn} turned safe picks risky`,
          narrativeWeekInProgress ? `Gameweek ${wn} is hitting the favourites hard` : `Gameweek ${wn} hit the favourites hard`,
          narrativeWeekInProgress ? `Gameweek ${wn} is opening the trap door` : `Gameweek ${wn} opened the trap door`,
          narrativeWeekInProgress ? `Gameweek ${wn} is rewriting the table` : `Gameweek ${wn} rewrote the table`,
          narrativeWeekInProgress ? `Gameweek ${wn} is testing the crowd` : `Gameweek ${wn} tested the crowd`,
          narrativeWeekInProgress ? `Gameweek ${wn} is turning popular picks sour` : `Gameweek ${wn} turned popular picks sour`,
          narrativeWeekInProgress ? `Gameweek ${wn} is delivering a heavy blow` : `Gameweek ${wn} delivered a heavy blow`,
          narrativeWeekInProgress ? `Gameweek ${wn} is cutting deep` : `Gameweek ${wn} cut deep`,
          narrativeWeekInProgress ? `Gameweek ${wn} is punishing confidence` : `Gameweek ${wn} punished confidence`,
          narrativeWeekInProgress ? `Gameweek ${wn} is creating damage` : `Gameweek ${wn} created damage`,
          narrativeWeekInProgress ? `Gameweek ${wn} is breaking the pack` : `Gameweek ${wn} broke the pack`,
          narrativeWeekInProgress ? `Gameweek ${wn} is making survival expensive` : `Gameweek ${wn} made survival expensive`,
          narrativeWeekInProgress ? `Gameweek ${wn} is catching the obvious pick` : `Gameweek ${wn} caught the obvious pick`,
          narrativeWeekInProgress ? `Gameweek ${wn} is changing the mood` : `Gameweek ${wn} changed the mood`,
        ]
      : [
          narrativeWeekInProgress ? `Gameweek ${wn} has an early casualty` : `Gameweek ${wn} had a casualty`,
          narrativeWeekInProgress ? `Gameweek ${wn} is claiming victims` : `Gameweek ${wn} claimed a victim`,
          narrativeWeekInProgress ? `Gameweek ${wn} is stinging a few` : `Gameweek ${wn} stung a few`,
          narrativeWeekInProgress ? `Gameweek ${wn} is taking its toll` : `Gameweek ${wn} took its toll`,
          narrativeWeekInProgress ? `Gameweek ${wn} is trimming the field` : `Gameweek ${wn} trimmed the field`,
          narrativeWeekInProgress ? `Gameweek ${wn} is catching out a small group` : `Gameweek ${wn} caught out a small group`,
          narrativeWeekInProgress ? `Gameweek ${wn} is costing a few entries` : `Gameweek ${wn} cost a few entries`,
          narrativeWeekInProgress ? `Gameweek ${wn} is nudging players out` : `Gameweek ${wn} nudged players out`,
          narrativeWeekInProgress ? `Gameweek ${wn} is making quiet damage` : `Gameweek ${wn} made quiet damage`,
          narrativeWeekInProgress ? `Gameweek ${wn} is thinning the edges` : `Gameweek ${wn} thinned the edges`,
          narrativeWeekInProgress ? `Gameweek ${wn} is punishing the wrong call` : `Gameweek ${wn} punished the wrong call`,
          narrativeWeekInProgress ? `Gameweek ${wn} is proving awkward` : `Gameweek ${wn} proved awkward`,
          narrativeWeekInProgress ? `Gameweek ${wn} is taking names` : `Gameweek ${wn} took names`,
          narrativeWeekInProgress ? `Gameweek ${wn} is making every pick count` : `Gameweek ${wn} made every pick count`,
          narrativeWeekInProgress ? `Gameweek ${wn} is showing no free passes` : `Gameweek ${wn} showed no free passes`,
          narrativeWeekInProgress ? `Gameweek ${wn} is catching loose picks` : `Gameweek ${wn} caught loose picks`,
          narrativeWeekInProgress ? `Gameweek ${wn} is removing the unlucky` : `Gameweek ${wn} removed the unlucky`,
          narrativeWeekInProgress ? `Gameweek ${wn} is adding pressure` : `Gameweek ${wn} added pressure`,
          narrativeWeekInProgress ? `Gameweek ${wn} is creating small cracks` : `Gameweek ${wn} created small cracks`,
          narrativeWeekInProgress ? `Gameweek ${wn} is keeping everyone honest` : `Gameweek ${wn} kept everyone honest`,
        ];
    pulseTitle = pickPulseVariant(titleOptions, 104);
    pulseBody = pickPulseVariant([
      `${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'player' : 'players'} trusted ${biggestCasualty.teamShortName} and paid for it. ${effectiveActiveCount} ${effectiveActiveCount === 1 ? 'survivor remains' : 'survivors remain'}.`,
      `${biggestCasualty.teamShortName} caught ${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'entry' : 'entries'} out, leaving ${effectiveActiveCount} ${effectiveActiveCount === 1 ? 'survivor' : 'survivors'} in contention.`,
      `${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'pick' : 'picks'} on ${biggestCasualty.teamShortName} turned into exits. The field is now down to ${effectiveActiveCount}.`,
      `${biggestCasualty.teamShortName} became the danger pick for ${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'entry' : 'entries'}. ${effectiveActiveCount} still stand.`,
      `${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'entry went' : 'entries went'} with ${biggestCasualty.teamShortName}; the survivor count is now ${effectiveActiveCount}.`,
      `The biggest damage came from ${biggestCasualty.teamShortName}, where ${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'pick failed' : 'picks failed'} to hold.`,
      `${biggestCasualty.teamShortName} carried the biggest risk this week, taking ${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'entry' : 'entries'} with them.`,
      `${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'player was' : 'players were'} on the wrong side of ${biggestCasualty.teamShortName}. ${effectiveActiveCount} remain alive.`,
      `${biggestCasualty.teamShortName} was the costly call, cutting the field to ${effectiveActiveCount} ${effectiveActiveCount === 1 ? 'survivor' : 'survivors'}.`,
      `${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'pick backed' : 'picks backed'} ${biggestCasualty.teamShortName}; that choice changed the shape of the table.`,
      `${biggestCasualty.teamShortName} caused the main swing, with ${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'entry' : 'entries'} falling away.`,
      `${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'player trusted' : 'players trusted'} the same route through. ${biggestCasualty.teamShortName} did not deliver.`,
      `The crowd pressure landed on ${biggestCasualty.teamShortName}; ${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'entry paid' : 'entries paid'} the price.`,
      `${biggestCasualty.teamShortName} was the round's trap door, leaving ${effectiveActiveCount} ${effectiveActiveCount === 1 ? 'survivor' : 'survivors'} still in play.`,
      `${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'entry was' : 'entries were'} exposed by ${biggestCasualty.teamShortName}, and the field tightened again.`,
      `${biggestCasualty.teamShortName} turned confidence into exits for ${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'player' : 'players'}.`,
      `${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'pick' : 'picks'} on ${biggestCasualty.teamShortName} failed, leaving ${effectiveActiveCount} to fight on.`,
      `${biggestCasualty.teamShortName} delivered the week's biggest setback, removing ${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'entry' : 'entries'}.`,
      `${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'player followed' : 'players followed'} ${biggestCasualty.teamShortName}; the competition now has ${effectiveActiveCount} ${effectiveActiveCount === 1 ? 'survivor' : 'survivors'}.`,
      `${biggestCasualty.teamShortName} was the pick that hurt most, and ${effectiveActiveCount} ${effectiveActiveCount === 1 ? 'entry is' : 'entries are'} still alive.`,
    ], 105);
  } else if (latestNarrativeWeek && weeklySurvivalRate != null && weeklySurvivalRate < 50) {
    pulseTitle = `${narrativeWeekLabel} ${narrativeWeekInProgress ? 'has early damage' : 'was chaos'}`;
    pulseBody = narrativeWeekInProgress
      ? `${weeklyEliminatedCount} ${weeklyEliminatedCount === 1 ? 'entry has' : 'entries have'} been eliminated from resolved picks so far. ${narrativePendingFixtureCount} fixture${narrativePendingFixtureCount === 1 ? '' : 's'} and ${gwPendingSelectionCount} pick${gwPendingSelectionCount === 1 ? '' : 's'} remain unresolved.`
      : `${weeklyEliminatedCount} ${weeklyEliminatedCount === 1 ? 'player went' : 'players went'} out in the latest week. Only ${weeklySurvivalRate}% survived the round.`;
  } else if (latestNarrativeWeek && weeklySurvivalRate != null && weeklySurvivalRate >= 50 && weeklySurvivalRate <= 70) {
    pulseTitle = `${narrativeWeekLabel} ${narrativeWeekInProgress ? 'is taking shape' : 'tightened the race'}`;
    pulseBody = narrativeWeekInProgress
      ? `${weeklyAdvancedCount} advanced and ${weeklyEliminatedCount} went out from the picks resolved so far. The remaining fixtures can still change the round.`
      : `${weeklySurvivalRate}% survived the round, and the middle of the pack is starting to thin out.`;
  } else if (latestNarrativeWeek && weeklySurvivalRate != null && weeklySurvivalRate >= 85) {
    pulseTitle = `${narrativeWeekLabel} ${narrativeWeekInProgress ? 'is steady so far' : 'was steady'}`;
    pulseBody = narrativeWeekInProgress
      ? `${weeklyAdvancedCount} of ${weeklyPickedCount} resolved picks have advanced so far. ${narrativePendingFixtureCount} fixture${narrativePendingFixtureCount === 1 ? '' : 's'} remain unresolved.`
      : `${weeklySurvivalRate}% made it through. The real shakeups may still be ahead.`;
  } else if (latestNarrativeWeek && doomedPickedTeams.length === 0 && survivingPickedTeams.length > 0) {
    pulseTitle = `${narrativeWeekLabel} ${narrativeWeekInProgress ? 'is sparing the field' : 'spared the field'}`;
    pulseBody = `No picked teams lost in the latest week. The standings stayed tight with ${effectiveActiveCount} still alive.`;
  } else if (latestNarrativeWeek && contrarianSurvivor) {
    pulseTitle = `${narrativeWeekLabel} ${narrativeWeekInProgress ? 'is rewarding nerve' : 'rewarded nerve'}`;
    pulseBody = `${contrarianSurvivor.pickCount} ${contrarianSurvivor.pickCount === 1 ? 'player' : 'players'} backed ${contrarianSurvivor.teamShortName} and came through when the crowd did not.`;
  } else if (latestNarrativeWeek && mostBackedTeam) {
    pulseTitle = `${narrativeWeekLabel} ${narrativeWeekInProgress ? 'is following the crowd' : 'followed the crowd'}`;
    pulseBody = `${mostBackedTeam.pickCount} players backed ${mostBackedTeam.teamShortName}. The table is still tightening with ${effectiveActiveCount} left standing.`;
  } else if (isEliminated) {
    pulseTitle = `Your run ended in Gameweek ${participant?.eliminatedWeek ?? selectedEntry?.eliminatedWeek ?? '—'}`;
    pulseBody = 'You are out of this competition now, but you can still follow every remaining fixture, upset, and survivor.';
  }

  const crowdReadTeamName = mostBackedTeam?.teamName ?? mostBackedTeam?.teamShortName ?? 'the crowd pick';
  const crowdReadTitle = mostBackedTeam
    ? pickPulseVariant([
        `${mostBackedTeam.teamShortName} carried the weight`,
        `${mostBackedTeam.teamShortName} drew the crowd`,
        `${mostBackedTeam.teamShortName} became the safe lane`,
        `${mostBackedTeam.teamShortName} pulled most of the picks`,
        `${mostBackedTeam.teamShortName} was the crowd play`,
        `${mostBackedTeam.teamShortName} led the pick board`,
        `${mostBackedTeam.teamShortName} became the popular route`,
        `${mostBackedTeam.teamShortName} took the spotlight`,
        `${mostBackedTeam.teamShortName} attracted the pack`,
        `${mostBackedTeam.teamShortName} was the main lean`,
        `${mostBackedTeam.teamShortName} became the obvious call`,
        `${mostBackedTeam.teamShortName} shaped the round`,
        `${mostBackedTeam.teamShortName} owned the crowd share`,
        `${mostBackedTeam.teamShortName} was where players gathered`,
        `${mostBackedTeam.teamShortName} became the common path`,
        `${mostBackedTeam.teamShortName} carried the room`,
        `${mostBackedTeam.teamShortName} drew the heaviest backing`,
        `${mostBackedTeam.teamShortName} was the table's favourite`,
        `${mostBackedTeam.teamShortName} became the consensus pick`,
        `${mostBackedTeam.teamShortName} set the weekly tone`,
      ], 201)
    : pickPulseVariant([
        'Waiting for the first crowd signal',
        'Crowd pattern will appear after lock',
        'No crowd trend yet',
        'Waiting for picks to settle',
        'The crowd has not converged yet',
        'No main pick has formed yet',
        'The pick board is still quiet',
        'No shared direction yet',
        'Crowd movement is still pending',
        'Waiting for a popular route',
        'No dominant pick to read yet',
        'The field has not shown its hand',
        'Pick pressure has not formed yet',
        'No crowd lean available yet',
        'The main trend is still hidden',
        'Waiting for the first big lean',
        'No team has taken the crowd yet',
        'The weekly pattern is still open',
        'No consensus choice yet',
        'The crowd read is still loading',
      ], 202);
  const crowdReadDetail = mostBackedTeam
    ? pickPulseVariant([
        `${mostBackedTeam.pickCount} players backed ${crowdReadTeamName} in ${narrativeWeekLabel ?? 'the latest resolved week'}${mostBackedTeam.percentage != null ? `, accounting for ${mostBackedTeam.percentage}% of tracked picks` : ''}.`,
        `${crowdReadTeamName} led the week with ${mostBackedTeam.pickCount} tracked pick${mostBackedTeam.pickCount === 1 ? '' : 's'}${mostBackedTeam.percentage != null ? ` (${mostBackedTeam.percentage}%)` : ''}.`,
        `${mostBackedTeam.pickCount} entr${mostBackedTeam.pickCount === 1 ? 'y' : 'ies'} lined up behind ${crowdReadTeamName}, making it the clearest crowd move.`,
        `The biggest cluster formed around ${crowdReadTeamName}, with ${mostBackedTeam.pickCount} pick${mostBackedTeam.pickCount === 1 ? '' : 's'} recorded.`,
        `${crowdReadTeamName} absorbed the most pressure this week with ${mostBackedTeam.pickCount} selection${mostBackedTeam.pickCount === 1 ? '' : 's'}.`,
        `The room leaned toward ${crowdReadTeamName}; ${mostBackedTeam.pickCount} player${mostBackedTeam.pickCount === 1 ? '' : 's'} made that call.`,
        `${crowdReadTeamName} was the shared answer for ${mostBackedTeam.pickCount} entr${mostBackedTeam.pickCount === 1 ? 'y' : 'ies'}.`,
        `A clear crowd lane formed on ${crowdReadTeamName}, drawing ${mostBackedTeam.pickCount} tracked pick${mostBackedTeam.pickCount === 1 ? '' : 's'}.`,
        `${mostBackedTeam.pickCount} player${mostBackedTeam.pickCount === 1 ? '' : 's'} chose ${crowdReadTeamName}, setting the main pressure point.`,
        `${crowdReadTeamName} became the pick to watch after taking ${mostBackedTeam.pickCount} selection${mostBackedTeam.pickCount === 1 ? '' : 's'}.`,
        `The field's strongest lean was ${crowdReadTeamName}, backed by ${mostBackedTeam.pickCount}.`,
        `${crowdReadTeamName} carried the largest share of picks and now defines the round's crowd story.`,
        `${mostBackedTeam.pickCount} pick${mostBackedTeam.pickCount === 1 ? '' : 's'} made ${crowdReadTeamName} the weekly benchmark.`,
        `The crowd's main position landed on ${crowdReadTeamName}, with ${mostBackedTeam.pickCount} entr${mostBackedTeam.pickCount === 1 ? 'y' : 'ies'} committed.`,
        `${crowdReadTeamName} was the biggest collective call, pulling ${mostBackedTeam.pickCount} player${mostBackedTeam.pickCount === 1 ? '' : 's'} into the same lane.`,
        `No other team drew more attention than ${crowdReadTeamName}, which had ${mostBackedTeam.pickCount} pick${mostBackedTeam.pickCount === 1 ? '' : 's'}.`,
        `${crowdReadTeamName} became the round's common ground for ${mostBackedTeam.pickCount} entr${mostBackedTeam.pickCount === 1 ? 'y' : 'ies'}.`,
        `The highest concentration of picks sat with ${crowdReadTeamName}: ${mostBackedTeam.pickCount} tracked selection${mostBackedTeam.pickCount === 1 ? '' : 's'}.`,
        `${crowdReadTeamName} drew the heaviest backing and became the result everyone was watching.`,
        `${mostBackedTeam.pickCount} player${mostBackedTeam.pickCount === 1 ? '' : 's'} made ${crowdReadTeamName} the crowd's headline pick.`,
      ], 203)
    : pickPulseVariant([
        'Once a gameweek locks, this area highlights where the crowd moved together.',
        'After lock, this tracks which team absorbed the largest share of picks.',
        "As soon as picks finalize, this card will show the crowd's main position.",
        'When entries commit, the strongest pick trend will appear here.',
        'This card waits for a locked gameweek before reading the field.',
        'The first clear crowd movement will be summarized here.',
        'Once selections are visible, the main team lean will be shown.',
        'This insight needs locked picks before it can identify the crowd route.',
        'After the deadline, the most popular selection will surface here.',
        'The field has not produced a readable trend yet.',
        'When the round settles, this will show where the largest group went.',
        'This panel will highlight the team carrying the most pick pressure.',
        'No pick cluster is available yet, but the trend will appear after lock.',
        'The crowd read starts once enough selections are locked in.',
        'This is where the weekly consensus pick will be tracked.',
        'The app is waiting for a meaningful pick pattern.',
        'No crowd lane can be measured until the week locks.',
        'Once picks are revealed, this card will show the dominant route.',
        'The first major backing pattern will appear here.',
        'This panel turns active when the field starts moving together.',
      ], 204);
  const knockoutTeamName = biggestCasualty?.teamName ?? biggestCasualty?.teamShortName ?? 'the danger team';
  const knockoutTitle = biggestCasualty
    ? pickPulseVariant([
        `${biggestCasualty.teamShortName} was the trapdoor`,
        `${biggestCasualty.teamShortName} triggered the biggest hit`,
        `${biggestCasualty.teamShortName} turned costly`,
        `${biggestCasualty.teamShortName} caused the key wipeout`,
        `${biggestCasualty.teamShortName} punished the field`,
        `${biggestCasualty.teamShortName} delivered the damage`,
        `${biggestCasualty.teamShortName} became the exit route`,
        `${biggestCasualty.teamShortName} created the biggest swing`,
        `${biggestCasualty.teamShortName} hurt the most entries`,
        `${biggestCasualty.teamShortName} broke the pack`,
        `${biggestCasualty.teamShortName} caused the sharpest drop`,
        `${biggestCasualty.teamShortName} was the costly mistake`,
        `${biggestCasualty.teamShortName} changed the table`,
        `${biggestCasualty.teamShortName} exposed the risk`,
        `${biggestCasualty.teamShortName} became the week's blow`,
        `${biggestCasualty.teamShortName} cut into the field`,
        `${biggestCasualty.teamShortName} made the biggest dent`,
        `${biggestCasualty.teamShortName} caught players out`,
        `${biggestCasualty.teamShortName} caused the main exit wave`,
        `${biggestCasualty.teamShortName} was the knockout point`,
      ], 205)
    : weeklyEliminatedCount > 0
      ? pickPulseVariant([
          `${weeklyEliminatedCount} new exits`,
          `${weeklyEliminatedCount} players fell`,
          `${weeklyEliminatedCount} entries dropped`,
          `${weeklyEliminatedCount} survivors were lost`,
          `${weeklyEliminatedCount} runs ended`,
          `${weeklyEliminatedCount} exits confirmed`,
          `${weeklyEliminatedCount} players left the race`,
          `${weeklyEliminatedCount} entries are out`,
          `${weeklyEliminatedCount} knockout hits`,
          `${weeklyEliminatedCount} players were removed`,
          `${weeklyEliminatedCount} fewer standing`,
          `${weeklyEliminatedCount} places cleared`,
          `${weeklyEliminatedCount} eliminations landed`,
          `${weeklyEliminatedCount} entries failed to advance`,
          `${weeklyEliminatedCount} players missed survival`,
          `${weeklyEliminatedCount} fell this week`,
          `${weeklyEliminatedCount} exits shaped the week`,
          `${weeklyEliminatedCount} players lost ground`,
          `${weeklyEliminatedCount} entries were cut`,
          `${weeklyEliminatedCount} knockout decisions landed`,
        ], 206)
      : pickPulseVariant([
          'No major casualty yet',
          'No clear knockout swing yet',
          'No mass exit team yet',
          'No major trapdoor so far',
          'No big wipeout yet',
          'No knockout wave yet',
          'No team has broken the field',
          'No damaging pick yet',
          'No heavy exit source yet',
          'No single blow has landed',
          'No major field cut yet',
          'No sharp elimination trend',
          'No costly team stands out',
          'No clear danger pick yet',
          'No decisive setback yet',
          'No elimination cluster yet',
          'No big table shift yet',
          'No trapdoor has opened yet',
          'No knockout headline yet',
          'No heavy damage recorded',
        ], 207);
  const knockoutDetail = biggestCasualty
    ? pickPulseVariant([
        `${biggestCasualty.pickCount} ${biggestCasualty.pickCount === 1 ? 'entry went' : 'entries went'} out backing ${knockoutTeamName}.`,
        `${knockoutTeamName} eliminated ${biggestCasualty.pickCount} entr${biggestCasualty.pickCount === 1 ? 'y' : 'ies'} in the sharpest swing.`,
        `${biggestCasualty.pickCount} player${biggestCasualty.pickCount === 1 ? '' : 's'} were knocked out on ${knockoutTeamName}.`,
        `${knockoutTeamName} created the round's biggest damage with ${biggestCasualty.pickCount} exit${biggestCasualty.pickCount === 1 ? '' : 's'}.`,
        `${biggestCasualty.pickCount} entr${biggestCasualty.pickCount === 1 ? 'y' : 'ies'} trusted ${knockoutTeamName} and left the race.`,
        `${knockoutTeamName} was the pick that hurt most, removing ${biggestCasualty.pickCount}.`,
        `${biggestCasualty.pickCount} selection${biggestCasualty.pickCount === 1 ? '' : 's'} on ${knockoutTeamName} became eliminations.`,
        `The biggest knockout source was ${knockoutTeamName}, with ${biggestCasualty.pickCount} exit${biggestCasualty.pickCount === 1 ? '' : 's'}.`,
        `${knockoutTeamName} turned into the danger result for ${biggestCasualty.pickCount} player${biggestCasualty.pickCount === 1 ? '' : 's'}.`,
        `${biggestCasualty.pickCount} run${biggestCasualty.pickCount === 1 ? '' : 's'} ended because ${knockoutTeamName} did not deliver.`,
        `${knockoutTeamName} caused the clearest table shift, taking out ${biggestCasualty.pickCount}.`,
        `${biggestCasualty.pickCount} entr${biggestCasualty.pickCount === 1 ? 'y was' : 'ies were'} exposed by the ${knockoutTeamName} pick.`,
        `${knockoutTeamName} became the week's knockout marker with ${biggestCasualty.pickCount} failed pick${biggestCasualty.pickCount === 1 ? '' : 's'}.`,
        `${biggestCasualty.pickCount} player${biggestCasualty.pickCount === 1 ? '' : 's'} went down on the same call: ${knockoutTeamName}.`,
        `${knockoutTeamName} produced the main elimination cluster of the round.`,
        `${biggestCasualty.pickCount} pick${biggestCasualty.pickCount === 1 ? '' : 's'} on ${knockoutTeamName} changed the survivor picture.`,
        `${knockoutTeamName} delivered the blow that removed ${biggestCasualty.pickCount} entr${biggestCasualty.pickCount === 1 ? 'y' : 'ies'}.`,
        `${biggestCasualty.pickCount} player${biggestCasualty.pickCount === 1 ? '' : 's'} backed ${knockoutTeamName}; none of those picks survived.`,
        `${knockoutTeamName} was the round's hardest lesson for ${biggestCasualty.pickCount} entr${biggestCasualty.pickCount === 1 ? 'y' : 'ies'}.`,
        `${biggestCasualty.pickCount} exit${biggestCasualty.pickCount === 1 ? '' : 's'} came through ${knockoutTeamName}, the biggest hit on the board.`,
      ], 208)
    : weeklyEliminatedCount > 0
      ? pickPulseVariant([
          `${narrativeWeekLabel ?? 'The latest week'} removed ${weeklyEliminatedCount} ${weeklyEliminatedCount === 1 ? 'entry' : 'entries'} from the field.`,
          `${weeklyEliminatedCount} elimination${weeklyEliminatedCount === 1 ? '' : 's'} landed, but no single team carried the full damage.`,
          `The field lost ${weeklyEliminatedCount}, spread across the week's resolved picks.`,
          `${weeklyEliminatedCount} player${weeklyEliminatedCount === 1 ? '' : 's'} left the race in the latest snapshot.`,
          `The round created ${weeklyEliminatedCount} exit${weeklyEliminatedCount === 1 ? '' : 's'} without one obvious trapdoor.`,
          `${weeklyEliminatedCount} run${weeklyEliminatedCount === 1 ? '' : 's'} ended as the table tightened.`,
          `There were ${weeklyEliminatedCount} knockout result${weeklyEliminatedCount === 1 ? '' : 's'} to account for this week.`,
          `${weeklyEliminatedCount} fewer entries are standing after the latest update.`,
          `The latest round trimmed ${weeklyEliminatedCount} from the survivor count.`,
          `${weeklyEliminatedCount} player${weeklyEliminatedCount === 1 ? '' : 's'} failed to advance in the current snapshot.`,
          `${weeklyEliminatedCount} exit${weeklyEliminatedCount === 1 ? '' : 's'} shifted the table, even without a single mass casualty.`,
          `The knockout pressure removed ${weeklyEliminatedCount} entr${weeklyEliminatedCount === 1 ? 'y' : 'ies'} this week.`,
          `${weeklyEliminatedCount} selection${weeklyEliminatedCount === 1 ? '' : 's'} ended in elimination across the week.`,
          `${weeklyEliminatedCount} player${weeklyEliminatedCount === 1 ? '' : 's'} were cut from the field.`,
          `${weeklyEliminatedCount} entr${weeklyEliminatedCount === 1 ? 'y' : 'ies'} failed the survival check.`,
          `The survivor table got ${weeklyEliminatedCount} spot${weeklyEliminatedCount === 1 ? '' : 's'} lighter.`,
          `${weeklyEliminatedCount} result-driven exit${weeklyEliminatedCount === 1 ? '' : 's'} came through this round.`,
          `${weeklyEliminatedCount} player${weeklyEliminatedCount === 1 ? '' : 's'} are now out after the latest week.`,
          `The latest resolved picture shows ${weeklyEliminatedCount} new elimination${weeklyEliminatedCount === 1 ? '' : 's'}.`,
          `${weeklyEliminatedCount} entr${weeklyEliminatedCount === 1 ? 'y has' : 'ies have'} dropped from contention.`,
        ], 209)
      : pickPulseVariant([
          'When fixtures resolve, this card highlights the biggest elimination source.',
          'Once results land, this surfaces the team that took the most players down.',
          "As results come in, this will track the round's biggest elimination source.",
          'The first clear knockout blow will be shown here.',
          'This card waits for a result strong enough to move the field.',
          'No knockout detail is available until selections resolve.',
          'The biggest elimination source will appear here after the week settles.',
          'This panel tracks where the damage comes from.',
          'When a team causes exits, the details will show here.',
          'The main trapdoor is still waiting to be identified.',
          'This card turns active once eliminations can be attributed.',
          'The next major casualty will be summarized here.',
          'No exit source has separated from the pack yet.',
          'The round has not produced a clear knockout story yet.',
          'This insight will name the team behind the biggest hit.',
          'Once picks fail, the main source of damage will appear.',
          'The elimination pattern is not readable yet.',
          'This is where the biggest failed pick gets called out.',
          'No knockout wave has formed yet.',
          'The field has not produced a clear danger team yet.',
        ], 210);
  const contrarianTeamName = contrarianSurvivor?.teamName ?? contrarianSurvivor?.teamShortName ?? 'the low-owned pick';
  const contrarianTitle = contrarianSurvivor
    ? pickPulseVariant([
        `${contrarianSurvivor.teamShortName} rewarded nerve`,
        `${contrarianSurvivor.teamShortName} paid off for the brave`,
        `${contrarianSurvivor.teamShortName} delivered a contrarian win`,
        `${contrarianSurvivor.teamShortName} proved the sharp play`,
        `${contrarianSurvivor.teamShortName} gave outsiders an edge`,
        `${contrarianSurvivor.teamShortName} backed the bold`,
        `${contrarianSurvivor.teamShortName} rewarded the minority`,
        `${contrarianSurvivor.teamShortName} created separation`,
        `${contrarianSurvivor.teamShortName} helped the brave survive`,
        `${contrarianSurvivor.teamShortName} made the unpopular pick pay`,
        `${contrarianSurvivor.teamShortName} became the smart outsider`,
        `${contrarianSurvivor.teamShortName} gave a small group daylight`,
        `${contrarianSurvivor.teamShortName} beat the crowd path`,
        `${contrarianSurvivor.teamShortName} gave low ownership value`,
        `${contrarianSurvivor.teamShortName} rewarded the risk takers`,
        `${contrarianSurvivor.teamShortName} broke from the pack`,
        `${contrarianSurvivor.teamShortName} delivered against the trend`,
        `${contrarianSurvivor.teamShortName} made the brave look sharp`,
        `${contrarianSurvivor.teamShortName} gave outsiders a lift`,
        `${contrarianSurvivor.teamShortName} proved the quiet route`,
      ], 211)
    : pickPulseVariant([
        'No contrarian hero yet',
        'No low-owned breakout yet',
        'No outsider pick has separated yet',
        'No clear contrarian edge yet',
        'Waiting for a bold low-owned win',
        'No brave pick has paid off yet',
        'No minority route has broken through',
        'No low-owned survivor story yet',
        'No unpopular pick has created value',
        'No sharp outsider call yet',
        'Waiting for someone to beat the crowd',
        'No quiet route has worked yet',
        'No bold pick has separated the field',
        'No low-owned team has rewarded trust',
        'No contrarian move to report yet',
        'No outsider edge is visible yet',
        'No small-group pick has landed yet',
        'No anti-crowd win yet',
        'No hidden value pick yet',
        'Waiting for the brave call',
      ], 212);
  const contrarianDetail = contrarianSurvivor
    ? pickPulseVariant([
        `Only ${contrarianSurvivor.pickCount} ${contrarianSurvivor.pickCount === 1 ? 'player' : 'players'} trusted ${contrarianTeamName}, and they stayed alive.`,
        `${contrarianTeamName} was backed by just ${contrarianSurvivor.pickCount}, and that minority call survived.`,
        `A small group of ${contrarianSurvivor.pickCount} went with ${contrarianTeamName} and gained ground by staying in.`,
        `${contrarianTeamName} kept ${contrarianSurvivor.pickCount} low-owned entr${contrarianSurvivor.pickCount === 1 ? 'y' : 'ies'} alive.`,
        `${contrarianSurvivor.pickCount} player${contrarianSurvivor.pickCount === 1 ? '' : 's'} avoided the crowd and got rewarded by ${contrarianTeamName}.`,
        `The unpopular route through ${contrarianTeamName} worked for ${contrarianSurvivor.pickCount}.`,
        `${contrarianTeamName} gave a small group survival while the wider field looked elsewhere.`,
        `Only ${contrarianSurvivor.pickCount} backed ${contrarianTeamName}, making it the sharpest low-owned success.`,
        `${contrarianTeamName} became the quiet edge for ${contrarianSurvivor.pickCount} survivor${contrarianSurvivor.pickCount === 1 ? '' : 's'}.`,
        `${contrarianSurvivor.pickCount} player${contrarianSurvivor.pickCount === 1 ? '' : 's'} took the less crowded path and survived.`,
        `${contrarianTeamName} rewarded the players willing to step away from the main trend.`,
        `The low-owned play was ${contrarianTeamName}, and ${contrarianSurvivor.pickCount} entr${contrarianSurvivor.pickCount === 1 ? 'y' : 'ies'} benefited.`,
        `${contrarianTeamName} created a small but useful separation point.`,
        `${contrarianSurvivor.pickCount} player${contrarianSurvivor.pickCount === 1 ? '' : 's'} found value away from the crowd with ${contrarianTeamName}.`,
        `The bold call on ${contrarianTeamName} kept ${contrarianSurvivor.pickCount} survivor${contrarianSurvivor.pickCount === 1 ? '' : 's'} moving.`,
        `${contrarianTeamName} turned a quiet pick into a meaningful edge.`,
        `A minority pick on ${contrarianTeamName} gave ${contrarianSurvivor.pickCount} entr${contrarianSurvivor.pickCount === 1 ? 'y' : 'ies'} breathing room.`,
        `${contrarianTeamName} proved that the least crowded route can still be the right one.`,
        `${contrarianSurvivor.pickCount} player${contrarianSurvivor.pickCount === 1 ? '' : 's'} survived by trusting ${contrarianTeamName} when few others did.`,
        `${contrarianTeamName} delivered the round's best low-owned survival story.`,
      ], 213)
    : pickPulseVariant([
        'If a low-owned choice breaks right, this is where that edge appears.',
        'When a low-owned team gets players through, it shows up here as the smartest unpopular move.',
        'This card lights up when a minority pick survives and creates separation.',
        'The first successful anti-crowd call will be shown here.',
        'No low-owned pick has produced a clear edge yet.',
        'This waits for a small group to beat the main trend.',
        'When a brave selection survives, the detail will appear here.',
        "The next unpopular pick that works will become this card's story.",
        'This panel tracks the value of avoiding the crowd.',
        'A low-owned survivor route has not appeared yet.',
        'Once a minority pick advances, this insight will call it out.',
        'No bold pick has created separation so far.',
        'This is where the smartest unpopular move gets highlighted.',
        'The field has not produced a contrarian winner yet.',
        'A brave low-owned choice will show here if it lands.',
        'This panel waits for an outsider pick to survive.',
        'No minority call has moved the leaderboard yet.',
        'When the quiet route works, this card will surface it.',
        'No anti-crowd advantage is visible at the moment.',
        'The first brave pick that pays off will be tracked here.',
      ], 214);


  useEffect(() => {
    try {
      const saved = globalThis?.localStorage?.getItem('lms.mobile.gameweekDisplayMode');
      if (saved === 'cards' || saved === 'route') setGameweekDisplayMode(saved);
      if (saved === 'compact') setGameweekDisplayMode('route');
    } catch {}
  }, []);

  const updateGameweekDisplayMode = (mode: GameweekDisplayMode) => {
    setGameweekDisplayMode(mode);
    try {
      globalThis?.localStorage?.setItem('lms.mobile.gameweekDisplayMode', mode);
    } catch {}
    if (mode === 'route') {
      setCollapsedWeeks(() => {
        const next = new Set<number>();
        const currentWeekNumber = currentGameweek?.weekNumber ?? gameweeks[gameweeks.length - 1]?.weekNumber;
        for (const gw of gameweeks) {
          if (gw.weekNumber !== currentWeekNumber) next.add(gw.weekNumber);
        }
        return next;
      });
    }
  };

  const getTeamPickStat = (gameweekId: number, teamId: number, teamShortName: string, teamName: string) => {
    const teamMap = pickStatsByGameweek.get(gameweekId);
    return teamMap?.get(`id:${teamId}`) ?? teamMap?.get(`short:${teamShortName}`) ?? teamMap?.get(`name:${teamName}`) ?? null;
  };

  useEffect(() => {
    if (gameweeks.length === 0) return;
    setCollapsedWeeks((prev) => {
      if (prev.size > 0) return prev;
      const next = new Set<number>();
      const currentWeekNumber = currentGameweek?.weekNumber ?? gameweeks[gameweeks.length - 1].weekNumber;
      for (const gw of gameweeks) {
        if (gw.weekNumber !== currentWeekNumber) next.add(gw.weekNumber);
      }
      return next;
    });
  }, [gameweeks, currentGameweek?.weekNumber]);


  const actionSummary = (() => {
    if (competition?.paused) return { title: 'Competition paused', detail: competition.pauseReason ?? 'Joining, payments, and picks will reopen when the club admin resumes the competition.', tone: 'warn' as const };
    if (!joined) {
      if (competition?.status === 'UPCOMING' && onlinePaymentRequired) return { title: 'Online payment required', detail: `Pay securely online to enter this competition. Entry fee: €${competition.entryFee}.`, tone: 'brand' as const };
      if (competition?.status === 'UPCOMING') return { title: 'Join this competition', detail: 'Create your entry to start making picks.', tone: 'brand' as const };
      return { title: 'Viewing only', detail: 'This competition has already started or finished. You can follow fixtures, selections, and results, but new entries are closed.', tone: 'warn' as const };
    }
    if (isWinner) return { title: 'You won this competition', detail: latestResolvedPick ? `The title is secured. Latest resolved pick: ${latestResolvedPick.teamShortName} in Gameweek ${latestResolvedPick.weekNumber}.` : 'The title is secured. Review the full path and final standings anytime.', tone: 'success' as const };
    if (isEliminated) return { title: `Eliminated in Gameweek ${participant?.eliminatedWeek ?? selectedEntry?.eliminatedWeek ?? '—'}`, detail: latestResolvedPick ? `Picking is finished for this entry. Latest resolved pick: ${latestResolvedPick.teamShortName} in Gameweek ${latestResolvedPick.weekNumber}.` : 'Picking is finished for this entry, but you can still track every fixture, pick trend, and remaining survivor.', tone: 'danger' as const };
    if (hasWinner || competition?.status === 'COMPLETED') return { title: 'Competition complete', detail: competition?.winnerUsername ? `${competition.winnerUsername} is the last survivor standing. Review the final standings and gameweek history below.` : 'This competition is complete. Review the final standings and gameweek history below.', tone: 'success' as const };
    if (awaitingOnlinePayment) return { title: 'Complete online payment', detail: 'Your entry is waiting for Stripe payment confirmation. Picks are disabled until payment completes.', tone: 'warn' as const };
    if (awaitingPayment && strictManualPayment) return { title: 'Awaiting payment confirmation', detail: 'Picks are disabled until club admin marks this entry as paid.', tone: 'warn' as const };
    if (canAddAnotherEntry && onlinePaymentRequired) return { title: 'Add another paid entry', detail: `Pay €${competition?.entryFee ?? 0} online to add another entry.`, tone: 'brand' as const };
    if (canPick && hasMissingOpenPick) return { title: nextMissingPickWeek ? `Pick required for Gameweek ${nextMissingPickWeek.weekNumber}` : 'Pick required', detail: nextMissingPickWeek?.lockAt ? `Your entry is active. Make this pick before lock ${distanceToNow(nextMissingPickWeek.lockAt)}.` : 'Your entry is active and has an open gameweek pick still to make.', tone: 'brand' as const };
    if (canPick && openPickGameweeks.length > 0) return { title: 'Picks submitted', detail: openPickGameweeks.length === 1 ? 'Your pick is in for the open gameweek. Track fixtures and survivor movement below.' : `Your picks are in for all ${openPickGameweeks.length} open gameweeks. Track fixtures and survivor movement below.`, tone: 'success' as const };
    return { title: 'Monitoring competition state', detail: 'Review gameweek status and fixture progress below.', tone: 'neutral' as const };
  })();

  const onShareInvite = async () => {
    if (!competition) return;
    const inviteText = competition.joinCode
      ? `Join ${competition.name} on Last Man Standing with code: ${competition.joinCode}`
      : `Join ${competition.name} on Last Man Standing.`;
    try {
      await Share.share({ message: inviteText });
    } catch {}
  };

  const shareMode = latestNarrativeWeek?.gameweekStatus === 'COMPLETED'
    ? 'recap'
    : latestNarrativeWeek?.gameweekStatus === 'IN_PROGRESS' && latestNarrativeWeek.fixtures.some((fixture) => fixture.status === 'FINISHED' || fixture.status === 'POSTPONED' || fixture.status === 'CANCELLED')
      ? 'live'
      : null;
  const shareTitle = shareMode === 'live' ? 'Live Update' : 'Recap';
  const shareButtonLabel = shareMode === 'live' ? 'Share Live Update' : 'Share Gameweek Recap';
  const shareEyebrow = shareMode === 'live' ? 'Shareable live update' : 'Shareable recap';

  const buildGameweekRecapMessage = () => {
    if (!competition) return '';
    const weekLabel = narrativeWeekLabel ?? (currentGameweek?.weekNumber ? `Gameweek ${currentGameweek.weekNumber}` : 'Competition');
    const mostPicked = mostBackedTeam ? `${mostBackedTeam.teamShortName} (${mostBackedTeam.pickCount})` : 'No picks yet';
    const weeklySurvival = weeklySurvivalRate != null ? `${weeklySurvivalRate}%` : `${survivalRate}%`;
    const message = [
      `${competition.name} - ${weekLabel} ${shareTitle}`,
      '',
      pulseTitle,
      pulseBody,
      '',
      `This week: ${weeklyEliminatedCount} out, ${weeklyAdvancedCount} advanced`,
      `Still alive: ${effectiveActiveCount}/${participantCount}`,
      `Survival rate: ${weeklySurvival}`,
      `Most picked: ${mostPicked}`,
      competition?.winnerUsername ? `Winner: ${competition.winnerUsername}` : null,
      '',
      'Shared from Last Man Standing',
    ].filter(Boolean).join('\n');

    return message;
  };

  const onShareGameweekRecap = async () => {
    if (!competition || !shareMode || detailFirstLoad || recapSharing) return;
    const message = buildGameweekRecapMessage();
    setRecapSharing(true);
    try {
      const uri = await recapCardRef.current?.capture?.();
      const canShareFile = uri ? await Sharing.isAvailableAsync() : false;
      if (uri && canShareFile) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: `${competition.name} ${shareTitle.toLowerCase()}`,
          UTI: 'public.png',
        });
        return;
      }
      await Share.share({ title: `${competition.name} ${shareTitle.toLowerCase()}`, message });
    } catch {
      try {
        await Share.share({ title: `${competition.name} ${shareTitle.toLowerCase()}`, message });
      } catch {}
    } finally {
      setRecapSharing(false);
    }
  };

  const openOnlinePayment = async () => {
    if (!competition) return;
    setPaymentActionError(null);
    setPaymentActionSuccess(null);
    setPaymentInProgress(true);
    try {
      const stripe = await import('@stripe/stripe-react-native');
      const [{ data: config }, { data: intent }] = await Promise.all([
        api.get<PaymentConfigResponse>('/payments/config'),
        api.post<PaymentIntentResponse>(`/payments/competitions/${competition.id}/intent`),
      ]);

      const publishableKey = config.publishableKey;
      if (!publishableKey || publishableKey.startsWith('pk_test_your')) {
        throw new Error('Stripe is not configured for mobile payments.');
      }

      await stripe.initStripe({
        publishableKey,
        merchantIdentifier: 'merchant.com.lastmanstanding.app',
        urlScheme: 'lastmanstanding',
      });

      const googlePaySupported = await stripe.isPlatformPaySupported({
        googlePay: {
          testEnv: publishableKey.startsWith('pk_test'),
        },
      });

      const initResult = await stripe.initPaymentSheet({
        merchantDisplayName: 'Last Man Standing',
        paymentIntentClientSecret: intent.clientSecret,
        returnURL: 'lastmanstanding://stripe-redirect',
        style: 'alwaysDark',
        primaryButtonLabel: `Pay €${((intent.amountCents ?? 0) / 100).toFixed(2)} & join`,
        appearance: {
          colors: {
            primary: '#38bdf8',
            background: '#020617',
            componentBackground: '#0f172a',
            componentBorder: '#334155',
            componentDivider: '#1e293b',
            primaryText: '#f8fafc',
            secondaryText: '#94a3b8',
            componentText: '#f8fafc',
            placeholderText: '#64748b',
            icon: '#bae6fd',
            error: '#fb7185',
          },
          shapes: {
            borderRadius: 14,
            borderWidth: 1,
          },
          primaryButton: {
            colors: {
              background: '#38bdf8',
              text: '#020617',
              border: '#7dd3fc',
            },
            shapes: {
              borderRadius: 14,
              borderWidth: 1,
              height: 52,
            },
          },
        },
        applePay: {
          merchantCountryCode: 'IE',
          buttonType: stripe.PlatformPay.ButtonType.Checkout,
        },
        googlePay: {
          merchantCountryCode: 'IE',
          currencyCode: 'EUR',
          testEnv: publishableKey.startsWith('pk_test'),
        },
        paymentMethodOrder: ['google_pay', 'card', 'revolut_pay', 'klarna'],
        allowsDelayedPaymentMethods: false,
      });

      if (initResult.error) {
        throw new Error(initResult.error.message ?? 'Could not initialise the payment form.');
      }

      if (!googlePaySupported) {
        setPaymentActionSuccess('Google Pay is not available on this device/build, so Stripe will show the other payment options.');
      }

      const paymentResult = await stripe.presentPaymentSheet();
      if (paymentResult.error) {
        if (paymentResult.error.code === 'Canceled') return;
        throw new Error(paymentResult.error.message ?? 'Payment was not completed.');
      }

      await api.post(`/payments/competitions/${competition.id}/confirm`, {
        paymentIntentId: intent.paymentIntentId,
      });

      setPaymentActionSuccess('Payment complete. Your entry is confirmed.');
      await Promise.all([
        myEntriesQuery.refetch(),
        competitionQuery.refetch(),
        myStatusQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['competitions-my-details'] }),
        queryClient.invalidateQueries({ queryKey: ['competitions-upcoming'] }),
        queryClient.invalidateQueries({ queryKey: ['survivor-table', id] }),
      ]);
    } catch (error: any) {
      const message = error?.response?.data?.message
        ?? error?.response?.data?.error
        ?? error?.message
        ?? 'Payment could not be completed. Please try again.';
      setPaymentActionError(message);
    } finally {
      setPaymentInProgress(false);
    }
  };

  const handleEntryAction = () => {
    if (onlinePaymentRequired) {
      void openOnlinePayment();
      return;
    }
    joinMutation.mutate();
  };

  const brandedCompetition = competition as Competition & { clubLogoUrl?: string | null; clubName?: string | null; clubPrimaryColor?: string | null; clubSecondaryColor?: string | null };
  const clubLogoUrl = brandedCompetition?.clubLogoUrl;
  const clubName = brandedCompetition?.clubName;
  const clubPrimaryColor = brandedCompetition?.clubPrimaryColor ?? colors.brand;
  const clubSecondaryColor = brandedCompetition?.clubSecondaryColor ?? clubPrimaryColor;
  const actionBanner = actionSummary;
  const detailLastUpdatedAt = Math.max(
    competitionQuery.dataUpdatedAt || 0,
    fixturesQuery.dataUpdatedAt || 0,
    myStatusQuery.dataUpdatedAt || 0,
    myEntriesQuery.dataUpdatedAt || 0,
    pickStatsQuery.dataUpdatedAt || 0,
    selectionsQuery.dataUpdatedAt || 0,
  );
  const detailRefreshing = refreshing || competitionQuery.isRefetching || fixturesQuery.isRefetching || myStatusQuery.isRefetching || myEntriesQuery.isRefetching || pickStatsQuery.isRefetching || selectionsQuery.isRefetching;
  // Keep provisional pulse text off-screen until the latest narrative week has the stats
  // and selections that drive the wording. Other queries can still fill in later.
  const detailFirstLoad = competitionQuery.isLoading
    || fixturesQuery.isLoading
    || latestNarrativePickStatsLoading
    || latestNarrativeSelectionsLoading;

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={clubPrimaryColor} />}>
        <DataFreshnessBar label="Competition data" updatedAt={detailLastUpdatedAt || null} refreshing={detailRefreshing} onRefresh={() => void onRefresh()} />

        <View style={[styles.heroWeb, { borderTopColor: clubPrimaryColor, backgroundColor: '#0f172a' }]}>
          {clubLogoUrl ? <Image source={{ uri: clubLogoUrl }} style={styles.clubLogoMobile} /> : null}
          <TouchableOpacity onPress={() => router.push('/competitions')} style={styles.lobbyLink}>
            <Text style={[styles.lobbyLinkText, { color: clubPrimaryColor }]}>← Competition lobby</Text>
          </TouchableOpacity>

          <View style={styles.heroPillsRow}>
            <StatusPill text={competition?.status ?? '—'} tone={statusTone(competition?.status)} />
            {competition?.paused ? <StatusPill text="Paused" tone="warn" /> : null}
            {selectedEntryLabel ? <StatusPill text={selectedEntryLabel} tone="neutral" /> : null}
            {isEliminated ? <StatusPill text="Eliminated" tone="danger" /> : null}
            {isWinner ? <StatusPill text="Winner" tone="warn" /> : null}
          </View>

          <Text style={styles.webHeroTitle}>{competitionQuery.isLoading ? 'Loading competition...' : competition?.name ?? 'Competition'}</Text>
          {competition?.description ? <Text style={styles.webHeroDescription}>{competition.description}</Text> : null}

          <View style={styles.webMetricGrid}>
            <View style={styles.webMetricCard}><Text style={styles.webMetricLabel}>Players</Text><Text style={styles.webMetricValue}>{competition?.participantCount ?? 0}</Text></View>
            <View style={styles.webMetricCard}><Text style={styles.webMetricLabel}>Active</Text><Text style={styles.webMetricValue}>{effectiveActiveCount}</Text></View>
            <View style={styles.webMetricCard}><Text style={styles.webMetricLabel}>Prize</Text><Text style={styles.webMetricValue}>{prizeLabel(competition)}</Text></View>
          </View>

          <View style={styles.heroMetaChips}>
            <Text style={styles.heroMetaChip}>{actionSummary.title}</Text>
            {nextFutureLockLabel ? <Text style={styles.heroMetaChip}>{nextFutureLockLabel}</Text> : null}
            <Text style={[styles.heroMetaChip, competition?.lifelineEnabled ? styles.lifelineChipOn : null]}>{lifelineStatusLabel}</Text>
          </View>

          <View style={styles.heroActionsRow}>
            {competition?.status === 'UPCOMING' ? (
              <TouchableOpacity style={[styles.inviteBtn, { borderColor: `${clubPrimaryColor}55`, backgroundColor: `${clubPrimaryColor}18` }]} onPress={() => void onShareInvite()}>
                <Text style={[styles.inviteBtnText, { color: clubPrimaryColor }]}>Invite</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={[styles.survivorBtn, { borderColor: `${clubPrimaryColor}55`, backgroundColor: `${clubPrimaryColor}18` }]} onPress={() => router.push(`/competitions/${id}/survivor-table`)}>
              <Text style={[styles.survivorBtnText, { color: clubPrimaryColor }]}>Survivor Table</Text>
            </TouchableOpacity>
          </View>

          {competition?.paused ? (
            <View style={styles.pauseBanner}>
              <Text style={styles.pauseBannerTitle}>Competition paused</Text>
              <Text style={styles.pauseBannerBody}>{competition.pauseReason ?? 'The club admin has temporarily paused this competition.'}</Text>
              <Text style={styles.pauseBannerMeta}>Joining, payments, picks, reminders, and automatic processing are paused. Fixture kickoff and gameweek lock times remain unchanged.</Text>
            </View>
          ) : null}

          <View style={[styles.pulsePanel, { borderLeftColor: clubPrimaryColor, backgroundColor: `${clubSecondaryColor}10` }]}>
            {detailFirstLoad ? (
              <CompetitionPulseSkeleton />
            ) : (
              <>
            <View style={styles.pulseEyebrowRow}>
              {clubLogoUrl ? <Image source={{ uri: clubLogoUrl }} style={styles.pulseLogo} /> : null}
              <Text style={[styles.pulseEyebrow, { color: clubPrimaryColor }]}>{clubName ?? competition?.name ?? 'Competition'} Pulse</Text>
              {latestNarrativeWeek?.weekNumber ? <Text style={styles.pulseLatest}>Latest: GW{latestNarrativeWeek.weekNumber}</Text> : currentGameweek?.weekNumber ? <Text style={styles.pulseLatest}>Latest: GW{currentGameweek.weekNumber}</Text> : null}
            </View>
            <Text style={styles.pulseHeadline}>{pulseTitle}</Text>
            <Text style={styles.pulseCopy}>{pulseBody}</Text>
            {hasWinner && competition?.winnerUsername ? (
              <View style={styles.winnerCallout}>
                <Text style={styles.winnerIcon}>🏆</Text>
                <Text style={styles.winnerText}>{isWinner ? 'You are the winner!' : `Winner: ${competition.winnerUsername}`}</Text>
              </View>
            ) : null}
            <View style={styles.webPulseChips}>
              <Text style={styles.webPulseChip}>{effectiveEliminatedCount} eliminated</Text>
              <Text style={styles.webPulseChip}>{survivalRate}% survival rate</Text>
              {weeklySurvivalRate != null ? (
                <Text style={styles.webPulseChip}>
                  {narrativeWeekInProgress
                    ? `Resolved picks: ${weeklySurvivalRate}% advanced · ${weeklyAdvancedCount} adv · ${weeklyEliminatedCount} out${gwPendingSelectionCount > 0 ? ` · ${gwPendingSelectionCount} pending` : ''} · ${narrativePendingFixtureCount} fixtures to play`
                    : `GW survival ${weeklySurvivalRate}% · ${weeklyAdvancedCount} adv · ${weeklyEliminatedCount} out`}
                </Text>
              ) : null}
              {mostBackedTeam ? <Text style={styles.webPulseChip}>Crowd pick: {mostBackedTeam.teamShortName} ({mostBackedTeam.pickCount})</Text> : null}
            </View>
              </>
            )}
          </View>

          <View style={styles.spotlightGrid}>
            {detailFirstLoad ? (
              <CompetitionSpotlightSkeleton />
            ) : (
              <>
                <NarrativeTile eyebrow="Knockout pressure" title={competition?.status === 'UPCOMING' ? `${competition?.participantCount ?? 0} entered` : `${eliminatedCount} out, ${effectiveActiveCount} alive`} detail={competition?.status === 'UPCOMING' ? 'No eliminations yet. Knockout pressure begins when the first fixtures lock.' : `${survivalRate}% of the field is still standing.`} accent="warn" />
                <NarrativeTile eyebrow={isEliminated ? 'Your run' : 'Your runway'} title={isEliminated ? `Eliminated in GW${participant?.eliminatedWeek ?? selectedEntry?.eliminatedWeek ?? '—'}` : `${Math.max(new Set((fixtures ?? []).flatMap((f) => [f.homeTeamId, f.awayTeamId])).size - consumedTeamIds.size, 0)} teams left to use`} detail={isEliminated ? 'There is no next pick for this entry, but you can still track the remaining survivors.' : `${consumedTeamIds.size} team${consumedTeamIds.size === 1 ? '' : 's'} already burned from your pool.`} accent="brand" />
              </>
            )}
          </View>
        </View>

        <TouchableOpacity style={[styles.mobileToggle, mobileInsightsOpen ? styles.mobileToggleOpen : null, mobileInsightsOpen ? { borderColor: `${clubPrimaryColor}80`, backgroundColor: `${clubPrimaryColor}12` } : null]} onPress={() => setMobileInsightsOpen((v) => !v)}>
          <View style={styles.mobileToggleCopy}>
            <Text style={[styles.mobileToggleKicker, { color: clubPrimaryColor }]}>Panel</Text>
            <Text style={styles.mobileToggleText}>Competition insights</Text>
            <Text style={styles.mobileToggleMeta}>{mobileInsightsOpen ? 'Expanded' : 'Tap to show trend cards'}</Text>
          </View>
          <View style={[styles.mobileToggleChevronBox, mobileInsightsOpen ? styles.mobileToggleChevronBoxOpen : null, mobileInsightsOpen ? { borderColor: `${clubPrimaryColor}66`, backgroundColor: `${clubPrimaryColor}22` } : null]}><Text style={[styles.mobileToggleState, { color: clubPrimaryColor }]}>{mobileInsightsOpen ? '▲' : '▼'}</Text></View>
        </TouchableOpacity>
        {mobileInsightsOpen ? (
          <View style={styles.insightStack}>
            {detailFirstLoad ? (
              <CompetitionInsightSkeleton />
            ) : (
              <>
                <InsightTile tone="brand" eyebrow="Crowd read" title={crowdReadTitle} detail={crowdReadDetail} />
                <InsightTile tone="danger" eyebrow="Knockout blow" title={knockoutTitle} detail={knockoutDetail} />
                <InsightTile tone="success" eyebrow="Contrarian edge" title={contrarianTitle} detail={contrarianDetail} />
              </>
            )}
          </View>
        ) : null}

        {!detailFirstLoad && shareMode ? (
          <View style={styles.recapShareOuter}>
            <ViewShot ref={recapCardRef} options={{ format: 'png', quality: 0.96, result: 'tmpfile' }}>
              <View style={[styles.recapShareCard, { borderColor: `${clubPrimaryColor}55`, backgroundColor: `${clubSecondaryColor}12` }]}>
                <View style={styles.recapShareHeader}>
                  <View style={styles.recapShareTitleBlock}>
                    <Text style={[styles.recapShareEyebrow, { color: clubPrimaryColor }]}>{shareEyebrow}</Text>
                    <Text style={styles.recapShareTitle}>{latestNarrativeWeek?.weekNumber || currentGameweek?.weekNumber ? `Gameweek ${latestNarrativeWeek?.weekNumber ?? currentGameweek?.weekNumber} ${shareTitle.toLowerCase()}` : `Competition ${shareTitle.toLowerCase()}`}</Text>
                  </View>
                  {clubLogoUrl ? <Image source={{ uri: clubLogoUrl }} style={styles.recapShareLogo} /> : null}
                </View>
                <Text style={styles.recapShareHeadline}>{pulseTitle}</Text>
                <Text style={styles.recapShareCopy}>{pulseBody}</Text>
                <View style={styles.recapStatGrid}>
                  <View style={styles.recapStatBox}><Text style={styles.recapStatValue}>{weeklyEliminatedCount}</Text><Text style={styles.recapStatLabel}>Out this week</Text></View>
                  <View style={styles.recapStatBox}><Text style={styles.recapStatValue}>{effectiveActiveCount}</Text><Text style={styles.recapStatLabel}>Still alive</Text></View>
                  <View style={styles.recapStatBox}><Text style={styles.recapStatValue}>{weeklySurvivalRate != null ? `${weeklySurvivalRate}%` : `${survivalRate}%`}</Text><Text style={styles.recapStatLabel}>Survival</Text></View>
                  <View style={styles.recapStatBox}><Text style={styles.recapStatValue}>{mostBackedTeam?.teamShortName ?? '—'}</Text><Text style={styles.recapStatLabel}>Most picked</Text></View>
                </View>
                <Text style={styles.recapShareFooter}>Last Man Standing</Text>
              </View>
            </ViewShot>
            <TouchableOpacity style={[styles.recapShareButton, recapSharing ? styles.recapShareButtonDisabled : null, { borderColor: `${clubPrimaryColor}66`, backgroundColor: `${clubPrimaryColor}24` }]} onPress={() => void onShareGameweekRecap()} disabled={recapSharing}>
              <Text style={[styles.recapShareButtonText, { color: clubPrimaryColor }]}>{recapSharing ? 'Preparing image...' : shareButtonLabel}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {joined && (myEntriesQuery.data?.length ?? 0) > 1 ? (
          <Card>
            <SectionTitle>My Entries</SectionTitle>
            <View style={styles.entryRow}>
              {(myEntriesQuery.data ?? []).map((entry) => {
                const active = selectedEntryId === entry.id;
                return (
                  <TouchableOpacity key={entry.id} style={[styles.entryChip, active ? styles.entryChipActive : null]} onPress={() => setSelectedEntryId(entry.id)}>
                    <Text style={[styles.entryChipText, active ? styles.entryChipTextActive : null]}>Entry #{entry.entryNumber ?? 1}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Card>
        ) : null}

        <StatusActionsPanel
          title={actionSummary.title}
          statusLabel={actionSummary.title}
          body={actionSummary.detail}
          meta={nextFutureLockLabel}
          tone={actionSummary.tone}
          onOpenSurvivor={() => router.push(`/competitions/${id}/survivor-table`)}
          actionLabel={paymentInProgress || joinMutation.isPending
            ? 'Working...'
            : onlinePaymentRequired
            ? joined
              ? `Pay €${competition?.entryFee ?? 0} online`
              : `Pay €${competition?.entryFee ?? 0} & join`
            : joined
            ? 'Add another entry'
            : 'Join competition'}
          showAction={!competition?.paused && (canJoinCompetition || canAddAnotherEntry || awaitingOnlinePayment)}
          actionDisabled={Boolean(competition?.paused) || paymentInProgress || joinMutation.isPending}
          onAction={handleEntryAction}
          actionError={paymentActionError}
          actionSuccess={paymentActionSuccess}
        />

        <TouchableOpacity style={[styles.mobileToggle, mobileRulesOpen ? styles.mobileToggleOpen : null]} onPress={() => setMobileRulesOpen((v) => !v)}>
          <View style={styles.mobileToggleCopy}>
            <Text style={[styles.mobileToggleKicker, { color: clubPrimaryColor }]}>Panel</Text>
            <Text style={styles.mobileToggleText}>Rules & Status</Text>
            <Text style={styles.mobileToggleMeta}>{mobileRulesOpen ? 'Expanded' : 'Tap to show rules and payment state'}</Text>
          </View>
          <View style={[styles.mobileToggleChevronBox, mobileRulesOpen ? styles.mobileToggleChevronBoxOpen : null]}><Text style={styles.mobileToggleState}>{mobileRulesOpen ? '▲' : '▼'}</Text></View>
        </TouchableOpacity>
        {mobileRulesOpen ? (
          <View style={styles.rulesStatusCard}>
            <View style={styles.rulesStatusHeader}>
              <Text style={styles.rulesStatusTitle}>Rules & Status</Text>
              <Text style={styles.rulesStatusSubtitle}>The competition contract, payment state, and team-pool picture in one panel.</Text>
            </View>
            <View style={styles.summaryGrid}>
              <SummaryTile label="Entry" value={competition?.entryFee && competition.entryFee > 0 ? `€${competition.entryFee}` : 'Free'} detail={awaitingOnlinePayment ? 'Online payment still required' : awaitingPayment && competition?.paymentMode === 'MANUAL' ? 'Awaiting organiser confirmation' : competition?.paymentMode === 'MANUAL' ? 'Pay organiser directly' : competition?.paymentMode === 'STRIPE' ? (joined ? 'Paid online' : 'Pay online to enter') : 'No payment required'} accent="brand" />
              <SummaryTile label="Prize Pool" value={competition?.prizePool && competition.prizePool > 0 ? `€${competition.prizePool}` : 'TBD'} detail={competition?.prizePool && competition.prizePool > 0 ? 'Visible to all players' : 'No fixed amount set'} accent="warn" />
              <SummaryTile label="Missed Pick" value={competition?.missedPickMode === 'ALLOW' ? 'Allowed' : 'Eliminate'} detail={competition?.missedPickMode === 'ALLOW' ? 'Competition allows misses' : 'No pick means you are out'} />
              <SummaryTile label="Postponed Match" value={competition?.postponedConsumesTeam ? 'Counts as used' : 'Can be reused'} detail={competition?.postponedConsumesTeam ? 'That team is still burned' : 'The pick does not consume the team'} />
              <SummaryTile label="Players" value={String(competition?.participantCount ?? 0)} detail={competition?.status === 'ACTIVE' ? `${effectiveActiveCount} still active` : competition?.winnerUsername ? `Winner: ${competition.winnerUsername}` : 'Registration overview'} />
              <SummaryTile label="Lifeline" value={competition?.lifelineEnabled ? (participant?.lifelineUsed ? 'Used' : 'Available') : 'Disabled'} detail={competition?.lifelineEnabled ? 'Draw protection can be used once' : 'Standard rules apply'} accent={competition?.lifelineEnabled ? 'success' : undefined} />
            </View>
          </View>
        ) : null}

        {competition?.status !== 'COMPLETED' && currentGameweek?.lockAt && !isPastDate(currentGameweek.lockAt) ? (
          <View style={styles.lockPanel}>
            <View>
              <Text style={styles.lockTitle}>Next gameweek lock</Text>
              <Text style={styles.lockSub}>{formatDateShort(currentGameweek.lockAt)}</Text>
            </View>
            <Text style={styles.lockCountdown}>{distanceToNow(currentGameweek.lockAt)}</Text>
          </View>
        ) : null}

        <View style={styles.gameweekDisplayPanel}>
          <View style={styles.gameweekDisplayCopy}>
            <Text style={styles.gameweekDisplayEyebrow}>Preference</Text>
            <Text style={styles.gameweekDisplayTitle}>Gameweek display</Text>
          </View>
          <View style={styles.gameweekDisplaySwitch}>
            {(['cards', 'route'] as const).map((mode) => (
              <TouchableOpacity key={mode} style={[styles.gameweekDisplayOption, gameweekDisplayMode === mode ? styles.gameweekDisplayOptionActive : null]} onPress={() => updateGameweekDisplayMode(mode)}>
                <Text style={[styles.gameweekDisplayOptionText, gameweekDisplayMode === mode ? styles.gameweekDisplayOptionTextActive : null]}>{mode === 'cards' ? 'Cards' : 'My Route'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.gameweeksSection}>
          {fixturesQuery.isLoading ? <MetaText>Loading fixtures...</MetaText> : null}
          {gameweeks.map((gw) => {
            const collapsed = collapsedWeeks.has(gw.weekNumber);
            const isLocked = gw.gameweekStatus === 'LOCKED' || gw.gameweekStatus === 'IN_PROGRESS' || gw.gameweekStatus === 'COMPLETED' || isPastDate(gw.lockAt);
            const isCompleted = gw.gameweekStatus === 'COMPLETED' || gw.fixtures.every((f) => f.status === 'FINISHED' || f.status === 'POSTPONED' || f.status === 'CANCELLED');
            const savedPickForGw = myPickByGameweek.get(gw.gameweekId);
            const liveOutcomeForGw = savedPickForGw ? liveOutcomeByGameweek.get(gw.gameweekId) : undefined;
            const displaySavedPickForGw = savedPickForGw && liveOutcomeForGw && !isResolvedPickOutcome(savedPickForGw.outcome)
              ? { ...savedPickForGw, outcome: liveOutcomeForGw }
              : savedPickForGw;
            const optimisticPickForGw = optimisticPick?.gwId === gw.gameweekId
              ? { teamId: optimisticPick.teamId, teamName: optimisticPick.teamName, teamShortName: optimisticPick.teamShortName, locked: false, useLifeline: optimisticPick.useLifeline, outcome: 'PENDING' }
              : null;
            const myPickForGw = optimisticPickForGw ?? displaySavedPickForGw;
            const lifelineChecked = pendingLifelineGameweekId === gw.gameweekId;
            const lifelineSelectedElsewhere = Boolean(pendingLifelineGameweekId && pendingLifelineGameweekId !== gw.gameweekId);
            const lifelineDisabled = Boolean(competition?.paused) || Boolean(gw.gameweekVoided) || isCompleted || isEliminated || isLocked || gw.gameweekStatus !== 'UPCOMING' || Boolean(participant?.lifelineUsed) || lifelineSelectedElsewhere;
            const fixtureCount = gw.fixtures.length;
            const resolvedFixtureCount = gw.fixtures.filter((f) => f.status === 'FINISHED' || f.status === 'POSTPONED' || f.status === 'CANCELLED').length;
            const routeMode = gameweekDisplayMode === 'route';
            return (
              <View key={gw.weekNumber} style={[styles.webGameweekCard, gameweekDisplayMode === 'route' ? styles.webGameweekCardRoute : null, myPickForGw && !isCompleted ? styles.webGameweekPicked : null, isCompleted ? styles.webGameweekCompleted : null]}>
                <TouchableOpacity
                  style={styles.webGameweekHeader}
                  onPress={() => setCollapsedWeeks((prev) => {
                    const next = new Set(prev);
                    if (next.has(gw.weekNumber)) next.delete(gw.weekNumber);
                    else next.add(gw.weekNumber);
                    return next;
                  })}
                >
                  <View style={styles.webGameweekHeaderText}>
                    <View style={styles.webGwTitleRow}>
                      <Text style={[styles.webGameweekTitle, gameweekDisplayMode === 'route' ? styles.webGameweekTitleRoute : null]}>Gameweek {gw.weekNumber}</Text>
                      <Text style={[styles.webGwBadge, isCompleted ? styles.webGwBadgeGray : isLocked ? styles.webGwBadgeRed : styles.webGwBadgeYellow]}>{gw.gameweekVoided ? 'Voided' : isCompleted ? 'Completed' : isLocked ? 'Locked' : `Locks ${distanceToNow(gw.lockAt)}`}</Text>
                    </View>
                    {collapsed && myPickForGw ? <Text style={styles.webCollapsedPick}>Selected: <Text style={[styles.webCollapsedPickTeam, pickOutcomeTextStyle(myPickForGw.outcome)]}>{myPickForGw.teamShortName}</Text></Text> : null}
                    {collapsed && !myPickForGw && isParticipant && !isEliminated && !isWinner && !isLocked ? <Text style={styles.noPickText}>No pick yet</Text> : null}
                  </View>
                  <View style={[styles.chevronBox, !collapsed ? styles.chevronBoxOpen : null]}><Text style={styles.chevron}>{collapsed ? '▼' : '▲'}</Text></View>
                </TouchableOpacity>

                {routeMode ? (
                  <View style={styles.routeGwSummary}>
                    <Text style={styles.routeGwSummaryText}>{fixtureCount} fixtures</Text>
                    <Text style={styles.routeGwSummaryText}>{resolvedFixtureCount}/{fixtureCount} resolved</Text>
                    {myPickForGw ? <Text style={styles.routeGwSummaryPick}>Pick: {myPickForGw.teamShortName}</Text> : <Text style={styles.routeGwSummaryMissing}>No pick</Text>}
                    {lifelineChecked ? <Text style={styles.routeGwSummaryLifeline}>Lifeline</Text> : null}
                  </View>
                ) : null}

                {!collapsed && myPickForGw ? (
                  <Text style={styles.webExpandedPick}>Your pick: <Text style={[styles.webExpandedPickTeam, pickOutcomeTextStyle(myPickForGw.outcome)]}>{myPickForGw.teamShortName}</Text>{myPickForGw.outcome && myPickForGw.outcome !== 'PENDING' ? ` · ${outcomeText(myPickForGw.outcome)}` : ''}</Text>
                ) : null}

                {!collapsed && isLocked ? (
                  <View style={styles.mobileGameweekLinks}>
                    <TouchableOpacity onPress={() => router.push(`/competitions/${id}/gameweeks/${gw.gameweekId}/selections`)}><Text style={styles.selectionLink}>View all selections →</Text></TouchableOpacity>
                    {isCompleted ? <TouchableOpacity onPress={() => router.push(`/competitions/${id}/gameweeks/${gw.gameweekId}/results`)}><Text style={styles.resultsLink}>Results →</Text></TouchableOpacity> : null}
                  </View>
                ) : null}

                {!collapsed ? (
                  <View style={styles.fixturesStack}>
                    {competition?.lifelineEnabled && isParticipant && !isWinner ? (
                      <TouchableOpacity
                        disabled={lifelineDisabled}
                        onPress={() => {
                          if (lifelineChecked) {
                            setLifelineForGwId(null);
                            setLifelineClearedForGwId(gw.gameweekId);
                          } else {
                            setLifelineClearedForGwId(null);
                            setLifelineForGwId(gw.gameweekId);
                          }
                        }}
                        style={[styles.lifelineBox, lifelineChecked ? styles.lifelineBoxSelected : null, lifelineDisabled && !lifelineChecked ? styles.lifelineBoxDisabled : null]}
                      >
                        <View style={styles.lifelineCheckboxRow}>
                          <View style={[styles.lifelineCheckbox, lifelineChecked ? styles.lifelineCheckboxChecked : null, lifelineDisabled && !lifelineChecked ? styles.lifelineCheckboxDisabled : null]}>
                            {lifelineChecked ? <Text style={styles.lifelineCheckboxTick}>✓</Text> : null}
                          </View>
                          <View style={styles.lifelineTextCol}>
                            <Text style={styles.lifelineBoxText}>{competition?.paused ? 'Lifeline unavailable while the competition is paused' : isEliminated ? 'Lifeline unavailable because this entry is eliminated' : participant?.lifelineUsed ? `Lifeline already used${participant.lifelineUsedWeek ? ` in Gameweek ${participant.lifelineUsedWeek}` : ''}.` : lifelineSelectedElsewhere ? 'Lifeline already selected for another gameweek' : 'Use lifeline for this gameweek'}</Text>
                            {!participant?.lifelineUsed && !isEliminated && !routeMode ? <Text style={styles.lifelineBoxHelp}>Spent once selected. A draw advances; a loss still eliminates.</Text> : null}
                          </View>
                        </View>
                      </TouchableOpacity>
                    ) : null}
                    {isEliminated && participant?.eliminatedWeek != null && gw.weekNumber > participant.eliminatedWeek && gw.gameweekStatus !== 'COMPLETED' ? (
                      <View style={styles.eliminatedBox}><Text style={styles.eliminatedBoxText}>{selectedEntryLabel ?? 'This entry'} was eliminated in Gameweek {participant.eliminatedWeek} and cannot make picks for this gameweek.</Text></View>
                    ) : null}
                    {routeMode ? (
                      <MyRoutePanel
                        teams={uniqueTeamsForFixtures(gw.fixtures, gw.gameweekId, gw.gameweekStatus, (teamId, shortName, name) => getTeamPickStat(gw.gameweekId, teamId, shortName, name))}
                        currentPick={myPickForGw ?? null}
                        currentGameweekId={gw.gameweekId}
                        consumedTeamIds={consumedTeamIds}
                        reservedTeamIds={reservedTeamIds}
                        pickHistory={pickHistory}
                        showReserved={gw.gameweekStatus === 'UPCOMING' && !isPastDate(gw.lockAt)}
                        canPick={isParticipant && !competition?.paused && !gw.gameweekVoided && !isCompleted && !isEliminated && !isWinner && !paymentBlocksPicks && !isLocked && !(isEliminated && participant?.eliminatedWeek != null && gw.weekNumber > participant.eliminatedWeek) && selectedEntry?.status === 'ACTIVE'}
                        saving={pickMutation.isPending}
                        lifelineChecked={lifelineChecked}
                        onPick={(team) => handlePick({ gwId: gw.gameweekId, teamId: team.teamId, teamName: team.teamName, teamShortName: team.teamShortName, useLifeline: lifelineChecked })}
                      />
                    ) : gw.fixtures.map((f) => {
                      const eliminatedBeforeThisGw = isEliminated && participant?.eliminatedWeek != null && gw.weekNumber > participant.eliminatedWeek;
                      const canPickThisGw = isParticipant && !competition?.paused && !gw.gameweekVoided && !isCompleted && !isEliminated && !isWinner && !paymentBlocksPicks && !isLocked && !eliminatedBeforeThisGw && selectedEntry?.status === 'ACTIVE';
                      const homeIsMyPick = myPickForGw?.teamId === f.homeTeamId;
                      const awayIsMyPick = myPickForGw?.teamId === f.awayTeamId;
                      const homeUsed = consumedTeamIds.has(f.homeTeamId) && !homeIsMyPick;
                      const awayUsed = consumedTeamIds.has(f.awayTeamId) && !awayIsMyPick;
                      const showReservedForThisGw = gw.gameweekStatus === 'UPCOMING' && !isPastDate(gw.lockAt);
                      const homeReserved = showReservedForThisGw && reservedTeamIds.has(f.homeTeamId) && !homeIsMyPick && !homeUsed;
                      const awayReserved = showReservedForThisGw && reservedTeamIds.has(f.awayTeamId) && !awayIsMyPick && !awayUsed;
                      const homePickStat = getTeamPickStat(gw.gameweekId, f.homeTeamId, f.homeTeamShortName, f.homeTeamName);
                      const awayPickStat = getTeamPickStat(gw.gameweekId, f.awayTeamId, f.awayTeamShortName, f.awayTeamName);
                      const homeConfidence = calculatePickConfidence(f, 'home', homePickStat, gw.gameweekStatus);
                      const awayConfidence = calculatePickConfidence(f, 'away', awayPickStat, gw.gameweekStatus);
                      const pickedConfidence = homeIsMyPick ? homeConfidence : awayIsMyPick ? awayConfidence : null;
                      const pickedStat = homeIsMyPick ? homePickStat : awayIsMyPick ? awayPickStat : null;
                      const pickedTeamName = homeIsMyPick ? f.homeTeamName : awayIsMyPick ? f.awayTeamName : null;
                      return (
                        <View key={f.id} style={styles.fixtureCardWithInsight}>
                          <View style={styles.webFixtureRow}>
                            <TeamPickSide align="right" name={f.homeTeamName} shortName={f.homeTeamShortName} picked={homeIsMyPick} used={homeUsed} reserved={homeReserved} pickStat={homePickStat} confidence={homeConfidence} clickable={canPickThisGw && !homeUsed && !homeReserved && !pickMutation.isPending} onPress={() => handlePick({ gwId: gw.gameweekId, teamId: f.homeTeamId, teamName: f.homeTeamName, teamShortName: f.homeTeamShortName, useLifeline: lifelineChecked })} />
                            <FixtureCenter fixture={f} />
                            <TeamPickSide align="left" name={f.awayTeamName} shortName={f.awayTeamShortName} picked={awayIsMyPick} used={awayUsed} reserved={awayReserved} pickStat={awayPickStat} confidence={awayConfidence} clickable={canPickThisGw && !awayUsed && !awayReserved && !pickMutation.isPending} onPress={() => handlePick({ gwId: gw.gameweekId, teamId: f.awayTeamId, teamName: f.awayTeamName, teamShortName: f.awayTeamShortName, useLifeline: lifelineChecked })} />
                          </View>
                          {pickedConfidence && pickedTeamName ? <PickInsightPanel teamName={pickedTeamName} confidence={pickedConfidence} pickStat={pickedStat} /> : null}
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
          {gameweeks.length === 0 && !fixturesQuery.isLoading ? <MetaText>No fixtures available yet.</MetaText> : null}
        </View>

        {pickHistory.length > 0 ? (
          <View style={styles.pickHistoryCard}>
            <TouchableOpacity style={styles.historyHeader} onPress={() => setHistoryCollapsed((v) => !v)}>
              <View>
                <Text style={styles.historyHeading}>My Pick History</Text>
                {selectedEntryLabel ? <Text style={styles.historyEntryLabel}>{selectedEntryLabel}</Text> : null}
              </View>
              <View style={[styles.chevronBox, !historyCollapsed ? styles.chevronBoxOpen : null]}><Text style={styles.chevron}>{historyCollapsed ? '▼' : '▲'}</Text></View>
            </TouchableOpacity>
            {!historyCollapsed ? (
              <View style={styles.webPickHistoryList}>
                {[...displayPickHistory].sort((a, b) => a.weekNumber - b.weekNumber).map((pick) => (
                  <View key={pick.pickId} style={styles.webPickHistoryItem}>
                    <View style={styles.webPickHistoryTopRow}>
                      <View style={styles.webPickHistoryTeamBlock}>
                        <Text style={styles.webPickGwLabel}>Gameweek {pick.weekNumber}</Text>
                        <Text style={styles.webPickTeamShort}>{pick.teamShortName}</Text>
                        <Text style={styles.webPickTeamName} numberOfLines={1}>{pick.teamName}</Text>
                      </View>
                      <StatusPill text={outcomeText(pick.outcome)} tone={outcomeTone(pick.outcome)} />
                    </View>
                    <View style={styles.webPickHistoryMetaRow}>
                      <Text style={styles.webPickSourceText}>{pick.source === 'AUTO' ? 'Auto-picked' : 'Self-picked'}</Text>
                      <View style={styles.webPickChipRow}>
                        {pick.useLifeline ? <Text style={styles.lifelineHistoryChip}>Lifeline</Text> : null}
                        <Text style={[styles.pickTypeChip, pick.source === 'AUTO' ? styles.pickTypeAuto : styles.pickTypeSelf]}>{pick.source === 'AUTO' ? 'Auto' : 'Self'}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}


function StatusActionsPanel({
  title,
  statusLabel,
  body,
  meta,
  tone,
  onOpenSurvivor,
  showAction,
  actionLabel,
  actionDisabled,
  onAction,
  actionError,
  actionSuccess,
}: {
  title: string;
  statusLabel: string;
  body: string;
  meta?: string | null;
  tone: 'neutral' | 'brand' | 'success' | 'danger' | 'warn';
  onOpenSurvivor: () => void;
  showAction?: boolean;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
  actionError?: string | null;
  actionSuccess?: string | null;
}) {
  return (
    <View style={styles.statusActionsCard}>
      <View style={styles.statusActionsHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.statusActionsEyebrow}>Next Action</Text>
          <Text style={styles.statusActionsTitle}>Status & Actions</Text>
          <Text style={styles.statusActionsStatus}>{statusLabel}</Text>
        </View>
        <Text style={[styles.statusActionsTone, tone === 'danger' ? styles.statusToneDanger : tone === 'warn' ? styles.statusToneWarn : tone === 'success' ? styles.statusToneSuccess : styles.statusToneBrand]}>{tone === 'danger' ? 'Urgent' : tone === 'warn' ? 'Attention' : tone === 'success' ? 'Ready' : 'Live'}</Text>
      </View>
      <Text style={styles.statusActionsBody}>{body}</Text>
      {meta ? <Text style={styles.statusActionsMeta}>{meta}</Text> : null}
      {showAction && onAction ? (
        <PrimaryButton label={actionLabel ?? 'Continue'} onPress={onAction} disabled={actionDisabled} />
      ) : null}
      {actionError ? <Text style={styles.paymentActionError}>{actionError}</Text> : null}
      {actionSuccess ? <Text style={styles.paymentActionSuccess}>{actionSuccess}</Text> : null}
      <TouchableOpacity onPress={onOpenSurvivor} style={styles.statusSecondaryButton}>
        <Text style={styles.statusSecondaryButtonText}>Open survivor table</Text>
      </TouchableOpacity>
    </View>
  );
}

function SummaryTile({ label, value, detail, accent }: { label: string; value: string; detail: string; accent?: 'brand' | 'warn' | 'success' }) {
  return (
    <View style={styles.summaryTile}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, accent === 'brand' ? styles.textBrand : accent === 'warn' ? styles.textWarn : accent === 'success' ? styles.textSuccess : null]}>{value}</Text>
      <Text style={styles.summaryDetail}>{detail}</Text>
    </View>
  );
}


function SkeletonBlock({ width = '100%', height = 12, radius = 8, style }: { width?: number | `${number}%`; height?: number; radius?: number; style?: object }) {
  return <View style={[styles.skeletonBlock, { width, height, borderRadius: radius }, style]} />;
}

function CompetitionPulseSkeleton() {
  return (
    <View>
      <View style={styles.skeletonRow}>
        <SkeletonBlock width={22} height={22} radius={7} />
        <SkeletonBlock width="45%" height={10} />
        <SkeletonBlock width="22%" height={10} />
      </View>
      <SkeletonBlock width="82%" height={28} style={styles.skeletonGapLarge} />
      <SkeletonBlock width="100%" height={14} style={styles.skeletonGap} />
      <SkeletonBlock width="72%" height={14} style={styles.skeletonGapSmall} />
      <View style={[styles.skeletonRow, styles.skeletonGapLarge]}>
        <SkeletonBlock width={112} height={30} radius={999} />
        <SkeletonBlock width={132} height={30} radius={999} />
      </View>
    </View>
  );
}

function CompetitionSpotlightSkeleton() {
  return <>{[0, 1].map((item) => (
    <View key={item} style={styles.narrativeTile}>
      <SkeletonBlock width="42%" height={10} />
      <SkeletonBlock width="65%" height={18} style={styles.skeletonGap} />
      <SkeletonBlock width="100%" height={12} style={styles.skeletonGap} />
      <SkeletonBlock width="70%" height={12} style={styles.skeletonGapSmall} />
    </View>
  ))}</>;
}

function CompetitionInsightSkeleton() {
  return <>{[0, 1, 2].map((item) => (
    <View key={item} style={styles.insightTile}>
      <SkeletonBlock width="35%" height={10} />
      <SkeletonBlock width="68%" height={18} style={styles.skeletonGap} />
      <SkeletonBlock width="100%" height={12} style={styles.skeletonGap} />
    </View>
  ))}</>;
}

function CompetitionSnapshotSkeleton() {
  return (
    <View>
      <SkeletonBlock width="52%" height={10} />
      <SkeletonBlock width="68%" height={20} style={styles.skeletonGap} />
      <View style={[styles.snapshotTilesWeb, styles.skeletonGap]}>
        {[0, 1, 2, 3].map((item) => (
          <View key={item} style={styles.snapshotTileWeb}>
            <SkeletonBlock width="55%" height={10} />
            <SkeletonBlock width="38%" height={16} style={styles.skeletonGapSmall} />
          </View>
        ))}
      </View>
    </View>
  );
}

function NarrativeTile({ eyebrow, title, detail, accent }: { eyebrow: string; title: string; detail: string; accent: 'brand' | 'warn' }) {
  return (
    <View style={styles.narrativeTile}>
      <Text style={styles.narrativeEyebrow}>{eyebrow}</Text>
      <Text style={[styles.narrativeTitle, accent === 'warn' ? styles.narrativeWarn : styles.narrativeBrand]}>{title}</Text>
      <Text style={styles.narrativeDetail}>{detail}</Text>
    </View>
  );
}

function InsightTile({ eyebrow, title, detail, tone }: { eyebrow: string; title: string; detail: string; tone: 'brand' | 'danger' | 'success' }) {
  return (
    <View style={[styles.insightTile, tone === 'danger' ? styles.insightDanger : tone === 'success' ? styles.insightSuccess : styles.insightBrand]}>
      <Text style={styles.insightEyebrow}>{eyebrow}</Text>
      <Text style={styles.insightTitle}>{title}</Text>
      <Text style={styles.insightDetail}>{detail}</Text>
    </View>
  );
}

function SnapshotTile({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'warn' | 'success' }) {
  return (
    <View style={styles.snapshotTileWeb}>
      <Text style={styles.snapshotLabelWeb}>{label}</Text>
      <Text style={[styles.snapshotValueWeb, tone === 'danger' ? styles.textDanger : tone === 'warn' ? styles.textWarn : tone === 'success' ? styles.textSuccess : null]}>{value}</Text>
    </View>
  );
}

function FixtureCenter({ fixture, compact }: { fixture: Fixture; compact?: boolean }) {
  if (fixture.status === 'FINISHED') return <View style={[styles.webCenterCol, compact ? styles.webCenterColCompact : null]}><Text style={[styles.scoreText, compact ? styles.scoreTextCompact : null]}>{fixture.scoreHome} - {fixture.scoreAway}</Text></View>;
  if (fixture.status === 'POSTPONED') return <View style={[styles.webCenterCol, compact ? styles.webCenterColCompact : null]}><Text style={styles.postponedText}>PP</Text></View>;
  if (fixture.status === 'IN_PLAY') {
    return <View style={[styles.webCenterCol, compact ? styles.webCenterColCompact : null]}><Text style={[styles.scoreText, compact ? styles.scoreTextCompact : null]}>{fixture.scoreHome != null && fixture.scoreAway != null ? `${fixture.scoreHome} - ${fixture.scoreAway}` : 'LIVE'}</Text><Text style={styles.liveText}>Live</Text></View>;
  }
  return <View style={[styles.webCenterCol, compact ? styles.webCenterColCompact : null]}><Text style={[styles.kickDate, compact ? styles.kickDateCompact : null]}>{formatKickoffDate(fixture.kickoffAt)}</Text><Text style={[styles.kickTime, compact ? styles.kickTimeCompact : null]}>{formatKickoffTime(fixture.kickoffAt)}</Text></View>;
}

function TeamPickSide({ align, name, shortName, picked, used, reserved, pickStat, confidence, clickable, compact, onPress }: { align: 'left' | 'right'; name: string; shortName: string; picked: boolean; used: boolean; reserved?: boolean; pickStat?: PickStat | null; confidence?: PickConfidence | null; clickable: boolean; compact?: boolean; onPress: () => void }) {
  const showStatus = picked || used || reserved;
  return (
    <TouchableOpacity disabled={!clickable && !picked} onPress={onPress} style={[styles.webTeamSide, compact ? styles.webTeamSideCompact : null, align === 'right' ? styles.webTeamRight : styles.webTeamLeft, picked ? styles.webTeamPicked : null, used && !picked ? styles.webTeamUsed : null, reserved && !picked && !used ? styles.webTeamReserved : null, clickable && !picked ? styles.webTeamClickable : null]}>
      <View style={[styles.webTeamLine, align === 'right' ? styles.webTeamLineRight : null]}>
        <Text style={[styles.webTeamShort, compact ? styles.webTeamShortCompact : null, picked ? styles.webTeamPickedText : used ? styles.webTeamUsedText : reserved ? styles.webTeamReservedText : null]}>{shortName}</Text>
        {showStatus ? <Text style={[styles.webTeamStatus, picked ? styles.webTeamPickedText : used ? styles.webTeamUsedText : styles.webTeamReservedText]}>{picked ? 'Picked' : used ? 'Used' : 'Resvd'}</Text> : null}
      </View>
      {!compact ? <Text style={[styles.webTeamName, align === 'right' ? styles.webTeamNameRight : null]} numberOfLines={1}>{name}</Text> : null}
      {(pickStat || confidence) && !compact ? (
        <View style={[styles.webPickMetaRow, align === 'right' ? styles.webPickMetaRowRight : null]}>
          {confidence ? <ConfidenceBadge confidence={confidence} picked={picked} /> : null}
          {pickStat ? (
            <View style={[styles.webPickStatBadge, picked ? styles.webPickStatBadgePicked : null]}>
              <Text style={[styles.webPickStatText, picked ? styles.webPickStatTextPicked : null]}>{pickStat.percentage ?? 0}%</Text>
              <Text style={[styles.webPickStatSubText, picked ? styles.webPickStatSubTextPicked : null]}>· {pickStat.pickCount} {pickStat.pickCount === 1 ? 'player' : 'players'}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function PickInsightPanel({ teamName, confidence, pickStat }: { teamName: string; confidence: PickConfidence; pickStat?: PickStat | null }) {
  return (
    <View style={styles.pickInsightPanel}>
      <View style={styles.pickInsightHeader}>
        <Text style={styles.pickInsightKicker}>Why this pick?</Text>
        <ConfidenceBadge confidence={confidence} picked showDetail />
      </View>
      <Text style={styles.pickInsightTitle} numberOfLines={1}>{teamName}</Text>
      <Text style={styles.pickInsightText}>{confidence.explanation}</Text>
      <View style={styles.pickInsightMetrics}>
        {confidence.marketChance != null ? (
          <View style={styles.pickInsightMetric}>
            <Text style={styles.pickInsightMetricValue}>{confidence.marketChance}%</Text>
            <Text style={styles.pickInsightMetricLabel}>market win</Text>
          </View>
        ) : null}
        {pickStat ? (
          <View style={styles.pickInsightMetric}>
            <Text style={styles.pickInsightMetricValue}>{pickStat.percentage ?? 0}%</Text>
            <Text style={styles.pickInsightMetricLabel}>{pickStat.pickCount} picked</Text>
          </View>
        ) : null}
        <View style={styles.pickInsightMetric}>
          <Text style={styles.pickInsightMetricValue}>{confidence.score}</Text>
          <Text style={styles.pickInsightMetricLabel}>risk score</Text>
        </View>
      </View>
    </View>
  );
}

function ConfidenceBadge({ confidence, picked, showDetail = false }: { confidence: PickConfidence; picked?: boolean; showDetail?: boolean }) {
  return (
    <View style={[
      styles.confidenceBadge,
      confidence.label === 'Safe' ? styles.confidenceSafe : confidence.label === 'Balanced' ? styles.confidenceBalanced : styles.confidenceBold,
      picked ? styles.confidencePicked : null,
    ]}>
      <Text style={[styles.confidenceBadgeText, picked ? styles.confidenceBadgeTextPicked : null]} numberOfLines={1}>{confidence.label}</Text>
      {showDetail ? <Text style={[styles.confidenceBadgeSubText, picked ? styles.confidenceBadgeTextPicked : null]} numberOfLines={1}>{confidenceHelpText(confidence)}</Text> : null}
    </View>
  );
}

type RouteTeam = {
  teamId: number;
  teamName: string;
  teamShortName: string;
  opponentShortName: string;
  opponentName: string;
  venueLabel: string;
  confidence?: PickConfidence | null;
};

function uniqueTeamsForFixtures(fixtures: Fixture[], gameweekId: number, gameweekStatus: string, getPickStat: (teamId: number, teamShortName: string, teamName: string) => PickStat | null): RouteTeam[] {
  const map = new Map<number, RouteTeam>();
  for (const fixture of fixtures) {
    const homeStat = getPickStat(fixture.homeTeamId, fixture.homeTeamShortName, fixture.homeTeamName);
    const awayStat = getPickStat(fixture.awayTeamId, fixture.awayTeamShortName, fixture.awayTeamName);
    map.set(fixture.homeTeamId, {
      teamId: fixture.homeTeamId,
      teamName: fixture.homeTeamName,
      teamShortName: fixture.homeTeamShortName,
      opponentShortName: fixture.awayTeamShortName,
      opponentName: fixture.awayTeamName,
      venueLabel: 'vs',
      confidence: calculatePickConfidence(fixture, 'home', homeStat, gameweekStatus),
    });
    map.set(fixture.awayTeamId, {
      teamId: fixture.awayTeamId,
      teamName: fixture.awayTeamName,
      teamShortName: fixture.awayTeamShortName,
      opponentShortName: fixture.homeTeamShortName,
      opponentName: fixture.homeTeamName,
      venueLabel: '@',
      confidence: calculatePickConfidence(fixture, 'away', awayStat, gameweekStatus),
    });
  }
  return Array.from(map.values()).sort((a, b) => a.teamShortName.localeCompare(b.teamShortName));
}

function MyRoutePanel({
  teams,
  currentPick,
  currentGameweekId,
  consumedTeamIds,
  reservedTeamIds,
  pickHistory,
  showReserved,
  canPick,
  saving,
  lifelineChecked,
  onPick,
}: {
  teams: RouteTeam[];
  currentPick: { teamId: number; teamName: string; teamShortName: string; outcome?: string; useLifeline?: boolean } | null;
  currentGameweekId: number;
  consumedTeamIds: Set<number>;
  reservedTeamIds: Set<number>;
  pickHistory: PickHistoryItem[];
  showReserved: boolean;
  canPick: boolean;
  saving: boolean;
  lifelineChecked: boolean;
  onPick: (team: RouteTeam) => void;
}) {
  const currentPickFixture = currentPick ? teams.find((team) => team.teamId === currentPick.teamId) : null;
  const routeTeamById = new Map(teams.map((team) => [team.teamId, team]));
  const historyTeam = (pick: PickHistoryItem): RouteTeam => routeTeamById.get(pick.teamId) ?? {
    teamId: pick.teamId,
    teamName: pick.teamName,
    teamShortName: pick.teamShortName,
    opponentShortName: '—',
    opponentName: 'Not in this gameweek',
    venueLabel: '',
  };
  const usedInThisGameweek = pickHistory
    .filter((pick) => consumedTeamIds.has(pick.teamId) && pick.gameweekId !== currentGameweekId)
    .map(historyTeam)
    .filter((team, index, all) => all.findIndex((candidate) => candidate.teamId === team.teamId) === index);
  const reservedInOtherGameweeks = pickHistory
    .filter((pick) => reservedTeamIds.has(pick.teamId) && pick.gameweekId !== currentGameweekId)
    .map(historyTeam)
    .filter((team, index, all) => all.findIndex((candidate) => candidate.teamId === team.teamId) === index);
  const availableTeams = teams.filter((team) => {
    const picked = currentPick?.teamId === team.teamId;
    const used = consumedTeamIds.has(team.teamId) && !picked;
    const reserved = showReserved && reservedTeamIds.has(team.teamId) && !picked;
    return picked || (!used && !reserved);
  });

  return (
    <View style={styles.routePanel}>
      <View style={styles.routeCurrentCard}>
        <Text style={styles.routeEyebrow}>Your route</Text>
        {currentPick ? (
          <>
            <Text style={styles.routeCurrentPick}>{currentPick.teamShortName}</Text>
            <Text style={styles.routeCurrentMeta}>{currentPick.teamName}{currentPick.outcome && currentPick.outcome !== 'PENDING' ? ` · ${outcomeText(currentPick.outcome)}` : ''}</Text>
            {currentPickFixture ? <Text style={styles.routeOpponentMeta}>{currentPickFixture.venueLabel} {currentPickFixture.opponentShortName} · {currentPickFixture.opponentName}</Text> : null}
            {currentPickFixture?.confidence ? <View style={styles.routeCurrentConfidence}><ConfidenceBadge confidence={currentPickFixture.confidence} picked showDetail /></View> : null}
          </>
        ) : (
          <>
            <Text style={styles.routeCurrentPickMissing}>No pick yet</Text>
            <Text style={styles.routeCurrentMeta}>{canPick ? 'Choose from the available teams below.' : 'No pick can be made for this gameweek.'}</Text>
          </>
        )}
        {lifelineChecked ? <Text style={styles.routeLifelineTag}>Lifeline selected</Text> : null}
      </View>

      <View style={styles.routeStatsRow}>
        <View style={styles.routeStatBox}><Text style={styles.routeStatValue}>{availableTeams.length}</Text><Text style={styles.routeStatLabel}>Available here</Text></View>
        <View style={styles.routeStatBox}><Text style={styles.routeStatValue}>{usedInThisGameweek.length}</Text><Text style={styles.routeStatLabel}>Already used</Text></View>
        <View style={styles.routeStatBox}><Text style={styles.routeStatValue}>{reservedInOtherGameweeks.length}</Text><Text style={styles.routeStatLabel}>Reserved</Text></View>
      </View>

      {usedInThisGameweek.length > 0 ? (
        <View style={styles.routeSection}>
          <Text style={styles.routeSectionTitle}>Used before</Text>
          <View style={styles.routeChipWrap}>
            {usedInThisGameweek.map((team) => <Text key={team.teamId} style={styles.routeUsedChip}>{team.teamShortName}</Text>)}
          </View>
        </View>
      ) : null}

      {reservedInOtherGameweeks.length > 0 ? (
        <View style={styles.routeSection}>
          <Text style={styles.routeSectionTitle}>Reserved in another gameweek</Text>
          <View style={styles.routeChipWrap}>
            {reservedInOtherGameweeks.map((team) => <Text key={team.teamId} style={styles.routeReservedChip}>{team.teamShortName}</Text>)}
          </View>
        </View>
      ) : null}

      <View style={styles.routeSection}>
        <Text style={styles.routeSectionTitle}>Available teams this gameweek</Text>
        <View style={styles.routeChipWrap}>
          {availableTeams.map((team) => {
            const picked = currentPick?.teamId === team.teamId;
            return (
              <TouchableOpacity
                key={team.teamId}
                disabled={!canPick || saving || picked}
                onPress={() => onPick(team)}
                style={[styles.routeTeamChip, picked ? styles.routeTeamChipPicked : null, (!canPick || saving) && !picked ? styles.routeTeamChipDisabled : null]}
              >
                <Text style={[styles.routeTeamChipText, picked ? styles.routeTeamChipTextPicked : null]}>{team.teamShortName}</Text>
                <Text style={[styles.routeTeamChipSub, picked ? styles.routeTeamChipTextPicked : null]} numberOfLines={1}>{picked ? 'Picked' : `${team.venueLabel} ${team.opponentShortName}`}</Text>
                {team.confidence ? <Text style={[styles.routeTeamChipConfidence, picked ? styles.routeTeamChipTextPicked : null]}>{team.confidence.label}</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 12 },
  scrollContent: { paddingTop: 8, paddingBottom: 32, gap: 12 },
  error: { color: '#fca5a5', marginTop: 8 },

  heroWeb: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderTopWidth: 3,
    borderColor: '#ffffff14',
    borderTopColor: '#0ea5e966',
    borderRadius: 30,
    backgroundColor: '#0f172a',
    padding: 18,
    shadowColor: '#020617',
    shadowOpacity: 0.48,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 5,
  },
  clubLogoMobile: { position: 'absolute', right: 18, top: 18, width: 58, height: 58, borderRadius: 18, borderWidth: 1, borderColor: '#ffffff33' },
  lobbyLink: { alignSelf: 'flex-start', marginBottom: 12 },
  lobbyLinkText: { color: '#7dd3fc', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 },
  heroPillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingRight: 68 },
  webHeroTitle: { color: '#fff', fontSize: 32, lineHeight: 37, fontWeight: '900', letterSpacing: -0.6, marginTop: 12 },
  webHeroDescription: { color: '#cbd5e1', fontSize: 14, lineHeight: 22, marginTop: 8 },
  webMetricGrid: { flexDirection: 'row', gap: 8, marginTop: 16 },
  webMetricCard: { flex: 1, minHeight: 68, borderRadius: 18, borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#ffffff0a', padding: 10, justifyContent: 'center' },
  webMetricLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2 },
  webMetricValue: { color: '#f8fafc', fontSize: 21, fontWeight: '900', marginTop: 5 },
  heroMetaChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 },
  heroMetaChip: { overflow: 'hidden', borderRadius: 999, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#00000033', color: '#d1d5db', fontSize: 11, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 6 },
  lifelineChipOn: { borderColor: '#22c55e55', backgroundColor: '#22c55e18', color: '#bbf7d0' },
  heroActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  pauseBanner: { marginTop: 16, borderWidth: 1, borderColor: '#f59e0b66', backgroundColor: '#f59e0b14', borderRadius: 18, padding: 14 },
  pauseBannerTitle: { color: '#fde68a', fontSize: 16, fontWeight: '900' },
  pauseBannerBody: { color: '#fef3c7', fontSize: 13, lineHeight: 19, fontWeight: '700', marginTop: 5 },
  pauseBannerMeta: { color: '#cbd5e1', fontSize: 11, lineHeight: 17, marginTop: 7 },
  inviteBtn: { borderWidth: 1, borderColor: '#ffffff33', backgroundColor: '#ffffff12', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  inviteBtnText: { color: '#f8fafc', fontSize: 12, fontWeight: '800' },
  survivorBtn: { borderWidth: 1, borderColor: '#38bdf855', backgroundColor: '#38bdf818', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  survivorBtnText: { color: '#7dd3fc', fontSize: 12, fontWeight: '800' },

  skeletonBlock: { backgroundColor: '#ffffff12' },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skeletonGapLarge: { marginTop: 16 },
  skeletonGap: { marginTop: 10 },
  skeletonGapSmall: { marginTop: 7 },

  pulsePanel: { marginTop: 20, borderWidth: 1, borderLeftWidth: 3, borderLeftColor: '#0ea5e9', borderColor: '#ffffff1a', backgroundColor: '#ffffff0a', borderRadius: 24, padding: 15 },
  pulseEyebrowRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  pulseLogo: { width: 22, height: 22, borderRadius: 7, borderWidth: 1, borderColor: '#ffffff33' },
  pulseEyebrow: { color: '#7dd3fc', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 },
  pulseLatest: { color: '#fde68a', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.1 },
  pulseHeadline: { color: '#fff', fontSize: 24, lineHeight: 29, fontWeight: '900', letterSpacing: -0.3, marginTop: 12 },
  pulseCopy: { color: '#cbd5e1', fontSize: 14, lineHeight: 22, marginTop: 8 },
  winnerCallout: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#facc154d', backgroundColor: '#facc151a', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, marginTop: 12 },
  winnerIcon: { fontSize: 15 },
  winnerText: { color: '#fde68a', fontSize: 12, fontWeight: '900' },
  webPulseChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 13 },
  webPulseChip: { overflow: 'hidden', borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#00000026', borderRadius: 999, color: '#e5e7eb', fontSize: 11, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 6 },

  spotlightGrid: { gap: 10, marginTop: 12 },
  narrativeTile: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#ffffff0b', borderRadius: 22, padding: 14 },
  narrativeEyebrow: { color: '#6b7280', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 },
  narrativeTitle: { fontSize: 17, fontWeight: '900', marginTop: 7 },
  narrativeWarn: { color: '#fde68a' },
  narrativeBrand: { color: '#a5f3fc' },
  narrativeDetail: { color: '#94a3b8', fontSize: 13, lineHeight: 20, marginTop: 7 },

  mobileToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#26354d', backgroundColor: '#0b1324', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12, gap: 12 },
  mobileToggleOpen: { borderColor: '#0ea5e980', backgroundColor: '#0e1b2f' },
  mobileToggleCopy: { flex: 1, minWidth: 0 },
  mobileToggleKicker: { color: '#7dd3fc', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 3 },
  mobileToggleText: { color: '#f8fafc', fontSize: 16, fontWeight: '900' },
  mobileToggleMeta: { color: '#64748b', fontSize: 11, fontWeight: '700', marginTop: 3 },
  mobileToggleChevronBox: { width: 32, height: 32, borderRadius: 11, borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  mobileToggleChevronBoxOpen: { borderColor: '#0ea5e966', backgroundColor: '#0ea5e922' },
  mobileToggleState: { color: '#bae6fd', fontSize: 10, fontWeight: '900' },
  insightStack: { gap: 10 },
  insightTile: { borderWidth: 1, borderRadius: 22, padding: 15 },
  insightBrand: { borderColor: '#0ea5e933', backgroundColor: '#0ea5e914' },
  insightDanger: { borderColor: '#ef444433', backgroundColor: '#ef444414' },
  insightSuccess: { borderColor: '#22c55e33', backgroundColor: '#22c55e14' },
  insightEyebrow: { color: '#ffffff99', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 },
  insightTitle: { color: '#fff', fontSize: 17, fontWeight: '900', marginTop: 8 },
  insightDetail: { color: '#cbd5e1', fontSize: 13, lineHeight: 21, marginTop: 7 },

  changedPanel: { borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 22, padding: 15 },
  sectionEyebrow: { color: '#7dd3fc', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 },
  changedTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 5 },
  snapshotTilesWeb: { gap: 8, marginTop: 12 },
  snapshotTileWeb: { borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#00000026', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  snapshotLabelWeb: { color: '#94a3b8', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  snapshotValueWeb: { color: '#fff', fontSize: 16, fontWeight: '900', marginTop: 5 },
  textDanger: { color: '#fca5a5' },
  textWarn: { color: '#fcd34d' },
  textSuccess: { color: '#86efac' },
  textBrand: { color: '#38bdf8' },

  recapShareOuter: { gap: 10 },
  recapShareCard: { borderWidth: 1, borderRadius: 24, padding: 15, gap: 12, backgroundColor: '#0f172a' },
  recapShareHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  recapShareTitleBlock: { flex: 1, minWidth: 0 },
  recapShareEyebrow: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 },
  recapShareTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '900', marginTop: 4 },
  recapShareLogo: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, borderColor: '#ffffff33' },
  recapShareHeadline: { color: '#ffffff', fontSize: 21, lineHeight: 27, fontWeight: '900', letterSpacing: -0.2 },
  recapShareCopy: { color: '#cbd5e1', fontSize: 13, lineHeight: 20 },
  recapStatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recapStatBox: { flexGrow: 1, flexBasis: '47%', borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#02061766', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 },
  recapStatValue: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  recapStatLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.1, marginTop: 4 },
  recapShareFooter: { color: '#64748b', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.4, textAlign: 'right' },
  recapShareButton: { borderWidth: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  recapShareButtonDisabled: { opacity: 0.6 },
  recapShareButtonText: { fontSize: 13, fontWeight: '900' },

  stateBanner: { borderWidth: 1, borderRadius: 22, padding: 15 },
  stateBannerBrand: { borderColor: '#0ea5e955', backgroundColor: '#0ea5e918' },
  stateBannerWarn: { borderColor: '#f59e0b66', backgroundColor: '#f59e0b18' },
  stateBannerDanger: { borderColor: '#ef444466', backgroundColor: '#ef444418' },
  stateBannerSuccess: { borderColor: '#22c55e66', backgroundColor: '#22c55e18' },
  stateEyebrow: { color: '#7dd3fc', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 },
  stateTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 5 },
  stateCopy: { color: '#d1d5db', fontSize: 13, lineHeight: 21, marginTop: 5 },
  paymentActionError: { color: '#fca5a5', fontSize: 12, fontWeight: '800', marginTop: 10 },
  paymentActionSuccess: { color: '#86efac', fontSize: 12, fontWeight: '800', marginTop: 10 },

  entryRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  entryChip: { borderRadius: 999, borderWidth: 1, borderColor: '#334155', backgroundColor: colors.panelSoft, paddingVertical: 6, paddingHorizontal: 10 },
  entryChipActive: { borderColor: '#0ea5e9', backgroundColor: '#0ea5e922' },
  entryChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  entryChipTextActive: { color: '#7dd3fc' },

  statusActionsCard: { borderWidth: 1, borderColor: '#253247', backgroundColor: '#111827', borderRadius: 18, padding: 15 },
  statusActionsHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  statusActionsEyebrow: { color: '#6b7280', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 },
  statusActionsTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 7 },
  statusActionsStatus: { color: '#94a3b8', fontSize: 12, fontWeight: '700', marginTop: 4 },
  statusActionsTone: { overflow: 'hidden', borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.1 },
  statusToneBrand: { borderColor: '#0ea5e955', backgroundColor: '#0ea5e922', color: '#7dd3fc' },
  statusToneWarn: { borderColor: '#f59e0b55', backgroundColor: '#f59e0b22', color: '#fcd34d' },
  statusToneDanger: { borderColor: '#ef444455', backgroundColor: '#ef444422', color: '#fca5a5' },
  statusToneSuccess: { borderColor: '#22c55e55', backgroundColor: '#22c55e22', color: '#86efac' },
  statusActionsBody: { color: '#d1d5db', fontSize: 13, lineHeight: 21, marginTop: 12 },
  statusActionsMeta: { overflow: 'hidden', borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#00000022', borderRadius: 12, color: '#94a3b8', fontSize: 12, fontWeight: '700', marginTop: 12, paddingHorizontal: 10, paddingVertical: 9 },
  statusSecondaryButton: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#1f2937', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', marginTop: 12 },
  statusSecondaryButtonText: { color: '#e5e7eb', fontSize: 13, fontWeight: '800' },

  rulesStatusCard: { borderWidth: 1, borderColor: '#253247', backgroundColor: '#111827', borderRadius: 18, padding: 15 },
  rulesStatusHeader: { marginBottom: 12 },
  rulesStatusTitle: { color: '#f3f4f6', fontSize: 18, fontWeight: '900' },
  rulesStatusSubtitle: { color: '#94a3b8', fontSize: 12, lineHeight: 18, marginTop: 4 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryTile: { width: '48%', minHeight: 105, borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#ffffff0a', borderRadius: 16, padding: 10 },
  summaryLabel: { color: '#6b7280', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  summaryValue: { color: '#f3f4f6', fontSize: 15, fontWeight: '900', marginTop: 6 },
  summaryDetail: { color: '#94a3b8', fontSize: 11, lineHeight: 16, marginTop: 5 },

  lockPanel: { borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e918', borderRadius: 18, padding: 14, gap: 10 },
  lockTitle: { color: '#38bdf8', fontSize: 13, fontWeight: '900' },
  lockSub: { color: '#94a3b8', fontSize: 12, marginTop: 3 },
  lockCountdown: { color: '#fff', fontSize: 25, fontWeight: '900' },

  gameweekDisplayPanel: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#0f172acc', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  gameweekDisplayCopy: { flex: 1, minWidth: 0 },
  gameweekDisplayEyebrow: { color: '#7dd3fc', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  gameweekDisplayTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '900', marginTop: 2 },
  gameweekDisplaySwitch: { flexDirection: 'row', borderWidth: 1, borderColor: '#334155', backgroundColor: '#020617', borderRadius: 13, padding: 4, gap: 4 },
  gameweekDisplayOption: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  gameweekDisplayOptionActive: { backgroundColor: '#0ea5e933', borderWidth: 1, borderColor: '#38bdf866' },
  gameweekDisplayOptionText: { color: '#94a3b8', fontSize: 11, fontWeight: '900' },
  gameweekDisplayOptionTextActive: { color: '#bae6fd' },
  gameweeksSection: { gap: 12 },
  webGameweekCard: { borderWidth: 1, borderColor: '#253247', backgroundColor: '#111827', borderRadius: 18, padding: 14, overflow: 'hidden' },
  webGameweekCardRoute: { padding: 10, borderRadius: 15 },
  webGameweekPicked: { borderColor: '#0ea5e966' },
  webGameweekCompleted: { borderColor: '#37415166', opacity: 0.86 },
  webGameweekHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  webGameweekHeaderText: { flex: 1 },
  webGwTitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  webGameweekTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  webGameweekTitleRoute: { fontSize: 16 },
  webGwBadge: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  webGwBadgeGray: { color: '#d1d5db', backgroundColor: '#ffffff18' },
  webGwBadgeRed: { color: '#fca5a5', backgroundColor: '#ef444422' },
  webGwBadgeYellow: { color: '#fcd34d', backgroundColor: '#f59e0b22' },
  routeGwSummary: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  routeGwSummaryText: { overflow: 'hidden', color: '#94a3b8', borderWidth: 1, borderColor: '#ffffff12', backgroundColor: '#ffffff08', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 10, fontWeight: '800' },
  routeGwSummaryPick: { overflow: 'hidden', color: '#7dd3fc', borderWidth: 1, borderColor: '#38bdf855', backgroundColor: '#0ea5e922', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 10, fontWeight: '900' },
  routeGwSummaryLifeline: { overflow: 'hidden', color: '#a5f3fc', borderWidth: 1, borderColor: '#06b6d455', backgroundColor: '#06b6d422', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 10, fontWeight: '900' },
  routeGwSummaryMissing: { overflow: 'hidden', color: '#fcd34d', borderWidth: 1, borderColor: '#f59e0b55', backgroundColor: '#f59e0b22', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 10, fontWeight: '900' },
  webCollapsedPick: { color: '#94a3b8', fontSize: 12, marginTop: 5 },
  webCollapsedPickTeam: { color: '#38bdf8', fontWeight: '900' },
  webExpandedPick: { color: '#d1d5db', fontSize: 12, marginTop: -2, marginBottom: 8, paddingHorizontal: 2 },
  webExpandedPickTeam: { fontWeight: '900' },
  pickOutcomeAdvanced: { color: '#4ade80' },
  pickOutcomeEliminated: { color: '#f87171' },
  pickOutcomePostponed: { color: '#facc15' },
  pickOutcomePending: { color: '#38bdf8' },
  noPickText: { color: '#fcd34d', fontSize: 12, fontStyle: 'italic', marginTop: 5 },
  chevronBox: { width: 32, height: 32, borderRadius: 11, borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  chevronBoxOpen: { borderColor: '#0ea5e966', backgroundColor: '#0ea5e922' },
  chevron: { color: '#bae6fd', fontSize: 10, fontWeight: '900' },
  mobileGameweekLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 9 },
  selectionLink: { color: '#38bdf8', fontSize: 12, fontWeight: '800' },
  resultsLink: { color: '#4ade80', fontSize: 12, fontWeight: '900' },
  fixturesStack: { gap: 8, marginTop: 14 },
  lifelineBox: { borderWidth: 1, borderColor: '#06b6d455', backgroundColor: '#06b6d422', borderRadius: 12, padding: 10 },
  lifelineBoxSelected: { borderColor: '#22d3ee', backgroundColor: '#06b6d433' },
  lifelineBoxDisabled: { opacity: 0.55 },
  lifelineCheckboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  lifelineCheckbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: '#67e8f9', backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  lifelineCheckboxChecked: { backgroundColor: '#0891b2', borderColor: '#a5f3fc' },
  lifelineCheckboxDisabled: { borderColor: '#475569', backgroundColor: '#111827' },
  lifelineCheckboxTick: { color: '#ffffff', fontSize: 13, fontWeight: '900', lineHeight: 16 },
  lifelineTextCol: { flex: 1 },
  lifelineBoxText: { color: '#a5f3fc', fontSize: 12, fontWeight: '900' },
  lifelineBoxHelp: { color: '#bae6fd', opacity: 0.85, fontSize: 11, lineHeight: 15, marginTop: 3 },
  eliminatedBox: { borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#ef444422', borderRadius: 10, padding: 10 },
  eliminatedBoxText: { color: '#fca5a5', fontSize: 12, fontWeight: '800' },
  fixtureCardWithInsight: { gap: 0 },
  webFixtureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#1f293780', paddingHorizontal: 10, paddingVertical: 8 },
  pickInsightPanel: { marginTop: -2, marginHorizontal: 4, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, borderWidth: 1, borderTopWidth: 0, borderColor: '#38bdf833', backgroundColor: '#082f4955', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 11 },
  pickInsightHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pickInsightKicker: { color: '#7dd3fc', fontSize: 9, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' },
  pickInsightTitle: { color: '#f8fafc', fontSize: 13, fontWeight: '900', marginTop: 7 },
  pickInsightText: { color: '#cbd5e1', fontSize: 11, lineHeight: 16, marginTop: 4 },
  pickInsightMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 },
  pickInsightMetric: { borderRadius: 999, backgroundColor: '#ffffff12', paddingHorizontal: 9, paddingVertical: 5 },
  pickInsightMetricValue: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  pickInsightMetricLabel: { color: '#94a3b8', fontSize: 8, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  routePanel: { gap: 10, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0b1220', borderRadius: 16, padding: 12 },
  routeCurrentCard: { borderWidth: 1, borderColor: '#38bdf855', backgroundColor: '#0ea5e91a', borderRadius: 14, padding: 12 },
  routeEyebrow: { color: '#7dd3fc', fontSize: 10, fontWeight: '900', letterSpacing: 1.8, textTransform: 'uppercase' },
  routeCurrentPick: { color: '#ffffff', fontSize: 28, fontWeight: '900', marginTop: 4 },
  routeCurrentPickMissing: { color: '#fcd34d', fontSize: 18, fontWeight: '900', marginTop: 6 },
  routeCurrentMeta: { color: '#cbd5e1', fontSize: 12, fontWeight: '700', marginTop: 2 },
  routeOpponentMeta: { color: '#7dd3fc', fontSize: 12, fontWeight: '900', marginTop: 4 },
  routeLifelineTag: { alignSelf: 'flex-start', overflow: 'hidden', borderRadius: 999, backgroundColor: '#06b6d433', color: '#a5f3fc', paddingHorizontal: 8, paddingVertical: 4, fontSize: 10, fontWeight: '900', marginTop: 8 },
  routeCurrentConfidence: { marginTop: 8, alignSelf: 'flex-start' },
  routeStatsRow: { flexDirection: 'row', gap: 8 },
  routeStatBox: { flex: 1, borderWidth: 1, borderColor: '#ffffff12', backgroundColor: '#111827', borderRadius: 12, padding: 10 },
  routeStatValue: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  routeStatLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.1, marginTop: 2 },
  routeSection: { gap: 8 },
  routeSectionTitle: { color: '#cbd5e1', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.4 },
  routeChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  routeUsedChip: { overflow: 'hidden', borderRadius: 999, borderWidth: 1, borderColor: '#f59e0b55', backgroundColor: '#f59e0b1a', color: '#fcd34d', paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: '900', textDecorationLine: 'line-through' },
  routeReservedChip: { overflow: 'hidden', borderRadius: 999, borderWidth: 1, borderColor: '#22d3ee55', backgroundColor: '#06b6d41a', color: '#a5f3fc', paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: '900' },
  routeTeamChip: { width: '30.5%', minWidth: 86, borderRadius: 12, borderWidth: 1, borderColor: '#334155', backgroundColor: '#1f2937', paddingHorizontal: 8, paddingVertical: 8 },
  routeTeamChipPicked: { borderColor: '#7dd3fc', backgroundColor: '#0284c7' },
  routeTeamChipDisabled: { opacity: 0.55 },
  routeTeamChipText: { color: '#e5e7eb', fontSize: 14, fontWeight: '900' },
  routeTeamChipTextPicked: { color: '#ffffff' },
  routeTeamChipSub: { color: '#94a3b8', fontSize: 9, fontWeight: '700', marginTop: 2 },
  routeTeamChipConfidence: { color: '#7dd3fc', fontSize: 9, fontWeight: '900', marginTop: 4 },
  webTeamSide: { flex: 1, minHeight: 48, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 5, justifyContent: 'center' },
  webTeamSideCompact: { minHeight: 34, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 4 },
  webTeamRight: { alignItems: 'flex-end' },
  webTeamLeft: { alignItems: 'flex-start' },
  webTeamClickable: { borderWidth: 1, borderColor: '#4b5563', backgroundColor: '#33415555' },
  webTeamPicked: { borderWidth: 2, borderColor: '#7dd3fc', backgroundColor: '#0284c7dd' },
  webTeamUsed: { backgroundColor: 'transparent' },
  webTeamReserved: { backgroundColor: 'transparent' },
  webTeamLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  webTeamLineRight: { flexDirection: 'row-reverse' },
  webTeamShort: { color: '#e5e7eb', fontSize: 12, fontWeight: '900' },
  webTeamShortCompact: { fontSize: 11 },
  webTeamName: { color: '#94a3b8', fontSize: 10, marginTop: 3, maxWidth: 110 },
  webTeamNameRight: { textAlign: 'right' },
  webTeamStatus: { overflow: 'hidden', borderRadius: 999, backgroundColor: '#ffffff22', paddingHorizontal: 5, paddingVertical: 2, fontSize: 8, fontWeight: '900', textTransform: 'uppercase' },
  webPickMetaRow: { marginTop: 6, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5, maxWidth: 116 },
  webPickMetaRowRight: { alignSelf: 'flex-end', justifyContent: 'flex-end' },
  confidenceBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 3, maxWidth: 96, flexShrink: 1 },
  confidenceSafe: { backgroundColor: '#22c55e26', borderWidth: 1, borderColor: '#22c55e55' },
  confidenceBalanced: { backgroundColor: '#f59e0b26', borderWidth: 1, borderColor: '#f59e0b55' },
  confidenceBold: { backgroundColor: '#06b6d426', borderWidth: 1, borderColor: '#06b6d455' },
  confidencePicked: { backgroundColor: '#ffffff26', borderColor: '#ffffff44' },
  confidenceBadgeText: { color: '#e5e7eb', fontSize: 9, fontWeight: '900', flexShrink: 1 },
  confidenceBadgeSubText: { color: '#cbd5e1', opacity: 0.75, fontSize: 8, fontWeight: '700', flexShrink: 1 },
  confidenceBadgeTextPicked: { color: '#ffffff' },
  webPickStatBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', maxWidth: 108, borderRadius: 999, backgroundColor: '#ffffff14', paddingHorizontal: 6, paddingVertical: 3 },
  webPickStatBadgeRight: { alignSelf: 'flex-end' },
  webPickStatBadgePicked: { backgroundColor: '#ffffff26' },
  webPickStatText: { color: '#d1d5db', fontSize: 9, fontWeight: '900' },
  webPickStatTextPicked: { color: '#ffffff' },
  webPickStatSubText: { color: '#94a3b8', fontSize: 9, fontWeight: '700' },
  webPickStatSubTextPicked: { color: '#e5e7eb' },
  webTeamPickedText: { color: '#fff' },
  webTeamUsedText: { color: '#fcd34d', textDecorationLine: 'line-through' },
  webTeamReservedText: { color: '#67e8f9' },
  webCenterCol: { minWidth: 72, alignItems: 'center', justifyContent: 'center' },
  webCenterColCompact: { minWidth: 54 },
  scoreText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  scoreTextCompact: { fontSize: 13 },
  postponedText: { color: '#fcd34d', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  liveText: { color: '#4ade80', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', marginTop: 2, letterSpacing: 1.0 },
  kickDate: { color: '#94a3b8', fontSize: 10 },
  kickDateCompact: { fontSize: 9 },
  kickTime: { color: '#cbd5e1', fontSize: 11, fontWeight: '700', marginTop: 1 },
  kickTimeCompact: { fontSize: 10 },

  pickHistoryCard: { borderWidth: 1, borderColor: '#253247', backgroundColor: '#111827', borderRadius: 18, padding: 14 },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  historyHeading: { color: '#fff', fontSize: 20, fontWeight: '900' },
  historyEntryLabel: { color: '#94a3b8', fontSize: 12, marginTop: 3 },
  webPickHistoryList: { marginTop: 14, borderTopWidth: 1, borderTopColor: '#37415180' },
  webPickHistoryItem: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#37415180', gap: 9 },
  webPickHistoryTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  webPickHistoryTeamBlock: { flex: 1, minWidth: 0 },
  webPickGwLabel: { color: '#6b7280', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.4 },
  webPickTeamShort: { color: '#f3f4f6', fontSize: 14, fontWeight: '900', marginTop: 5 },
  webPickTeamName: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  webPickHistoryMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  webPickSourceText: { color: '#6b7280', fontSize: 12, fontWeight: '700' },
  webPickChipRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  lifelineHistoryChip: { overflow: 'hidden', borderRadius: 999, backgroundColor: '#06b6d433', color: '#a5f3fc', fontSize: 10, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 3 },
  pickTypeChip: { overflow: 'hidden', borderRadius: 999, fontSize: 10, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 3 },
  pickTypeAuto: { backgroundColor: '#f59e0b22', color: '#fcd34d' },
  pickTypeSelf: { backgroundColor: '#ffffff18', color: '#d1d5db' },
});
