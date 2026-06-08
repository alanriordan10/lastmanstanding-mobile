import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, getApiErrorMessage } from '../api/client';
import type { Fixture, MyStatusResponse } from '../types';
import { useEffect, useMemo, useState } from 'react';
import { Card, MetaText, PrimaryButton, ScreenTitle, SectionTitle } from '../components/ui';
import { colors, spacing } from '../theme/tokens';

interface TeamOption {
  id: number;
  label: string;
}

export default function PickScreen() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; gwId: string; entryId?: string }>();
  const competitionId = Number(params.id);
  const gwId = Number(params.gwId);
  const entryId = params.entryId ? Number(params.entryId) : null;
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fixturesQuery = useQuery({
    queryKey: ['competition', competitionId, 'gameweek', gwId, 'fixtures'],
    queryFn: async () => (await api.get<Fixture[]>(`/competitions/${competitionId}/gameweeks/${gwId}/fixtures`)).data,
    enabled: Number.isFinite(competitionId) && Number.isFinite(gwId),
  });

  const myStatusQuery = useQuery({
    queryKey: ['competition', competitionId, 'my-status', entryId],
    queryFn: async () => (await api.get<MyStatusResponse>(`/competitions/${competitionId}/me`, {
      params: entryId ? { entryId } : undefined,
    })).data,
    enabled: Number.isFinite(competitionId),
  });

  const currentPick = useMemo(
    () => myStatusQuery.data?.picks.find((pick) => pick.gameweekId === gwId) ?? null,
    [myStatusQuery.data?.picks, gwId],
  );

  const consumedTeamIds = useMemo(() => {
    const ids = new Set<number>(myStatusQuery.data?.usedTeamIds ?? []);
    for (const pick of myStatusQuery.data?.picks ?? []) {
      if (pick.gameweekId === gwId) continue;
      if (pick.locked || pick.outcome !== 'PENDING') ids.add(pick.teamId);
    }
    if (currentPick?.teamId) ids.delete(currentPick.teamId);
    return ids;
  }, [currentPick?.teamId, myStatusQuery.data?.picks, myStatusQuery.data?.usedTeamIds, gwId]);

  useEffect(() => {
    if (currentPick?.teamId && selectedTeamId == null) {
      setSelectedTeamId(currentPick.teamId);
    }
  }, [currentPick?.teamId, selectedTeamId]);

  const isUnchangedPick = currentPick?.teamId === selectedTeamId;

  const teamOptions: TeamOption[] = useMemo(() => (fixturesQuery.data ?? []).flatMap((f) => [
    { id: f.homeTeamId, label: `${f.homeTeamShortName} (${f.homeTeamName})` },
    { id: f.awayTeamId, label: `${f.awayTeamShortName} (${f.awayTeamName})` },
  ]).filter((team, index, arr) => arr.findIndex((t) => t.id === team.id) === index), [fixturesQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedTeamId) throw new Error('Select a team first');
      await api.post(`/competitions/${competitionId}/gameweeks/${gwId}/pick`, {
        teamId: selectedTeamId,
        entryId: entryId ?? undefined,
      });
    },
    onMutate: () => {
      if (!selectedTeamId) return undefined;
      const queryKey = ['competition', competitionId, 'my-status', entryId] as const;
      const previous = queryClient.getQueryData<MyStatusResponse>(queryKey);
      queryClient.setQueryData<MyStatusResponse>(queryKey, (current) => {
        if (!current) return current;
        const nextUsed = new Set(current.usedTeamIds ?? []);
        const previousPick = current.picks.find((pick) => pick.gameweekId === gwId);
        if (previousPick) nextUsed.delete(previousPick.teamId);
        nextUsed.add(selectedTeamId);
        return { ...current, usedTeamIds: Array.from(nextUsed) };
      });
      return { queryKey, previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competition', competitionId] });
      queryClient.invalidateQueries({ queryKey: ['competition', competitionId, 'my-status', entryId] });
      queryClient.invalidateQueries({ queryKey: ['competition', competitionId, 'my-pick'] });
      queryClient.invalidateQueries({ queryKey: ['competition', competitionId, 'current-gameweek'] });
      queryClient.invalidateQueries({ queryKey: ['competition', competitionId, 'my-entries'] });
      router.replace(`/competitions/${competitionId}`);
    },
    onError: (e: any, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      setError(getApiErrorMessage(e, 'Failed to save pick'));
    },
  });

  if (!Number.isFinite(competitionId) || !Number.isFinite(gwId)) {
    return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}><Text style={styles.error}>Invalid route parameters.</Text></SafeAreaView>;
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={fixturesQuery.isRefetching || myStatusQuery.isRefetching} onRefresh={() => { void fixturesQuery.refetch(); void myStatusQuery.refetch(); }} tintColor={colors.brand} />}
      >
        <View style={styles.hero}>
          <MetaText>Gameweek Pick</MetaText>
          <ScreenTitle>Choose Your Team</ScreenTitle>
          <View style={styles.heroRow}>
            <MetaText>GW {gwId}</MetaText>
            <MetaText>{entryId ? `Entry #${entryId}` : 'Primary Entry'}</MetaText>
          </View>
        </View>

        <Card>
          <SectionTitle>Eligible Teams</SectionTitle>
          {fixturesQuery.isLoading || myStatusQuery.isLoading ? <MetaText>Loading teams...</MetaText> : null}
          {consumedTeamIds.size > 0 ? <MetaText>Teams already used by this entry are greyed out and cannot be picked again.</MetaText> : null}
          {teamOptions.map((team) => {
            const selected = selectedTeamId === team.id;
            const used = consumedTeamIds.has(team.id) && !selected;
            return (
              <TouchableOpacity
                key={team.id}
                disabled={used || mutation.isPending}
                style={[styles.option, selected ? styles.optionSelected : null, used ? styles.optionUsed : null]}
                onPress={() => {
                  if (selected) return;
                  setError(null);
                  setSelectedTeamId(team.id);
                }}
              >
                <Text style={[styles.optionText, selected ? styles.optionTextSelected : null, used ? styles.optionTextUsed : null]}>{team.label}</Text>
                {selected ? <Text style={styles.selectedTag}>Selected</Text> : null}
                {used ? <Text style={styles.usedTag}>Used</Text> : null}
              </TouchableOpacity>
            );
          })}
          {teamOptions.length === 0 && !fixturesQuery.isLoading ? <MetaText>No eligible teams found.</MetaText> : null}
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton label={mutation.isPending ? 'Saving...' : 'Save Pick'} onPress={() => mutation.mutate()} disabled={!selectedTeamId || isUnchangedPick || consumedTeamIds.has(selectedTeamId) || mutation.isPending} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.screen },
  hero: {
    borderWidth: 1,
    borderColor: '#ffffff1a',
    borderRadius: 18,
    backgroundColor: '#111827',
    padding: 14,
  },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  option: {
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.panelSoft,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  optionSelected: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  optionUsed: { backgroundColor: '#0f172a99', borderColor: '#334155', opacity: 0.62 },
  optionText: { color: '#e5e7eb', flex: 1 },
  optionTextSelected: { color: '#fff', fontWeight: '700' },
  optionTextUsed: { color: '#94a3b8', textDecorationLine: 'line-through' },
  selectedTag: {
    color: '#7dd3fc',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
  },
  usedTag: {
    color: '#94a3b8',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
  },
  error: { color: '#fca5a5', marginTop: 10 },
});
