import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import type { Fixture } from '../types';
import { useMemo, useState } from 'react';
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['competition', competitionId] });
      await queryClient.invalidateQueries({ queryKey: ['competition', competitionId, 'my-pick'] });
      await queryClient.invalidateQueries({ queryKey: ['competition', competitionId, 'current-gameweek'] });
      await queryClient.invalidateQueries({ queryKey: ['competition', competitionId, 'my-entries'] });
      router.replace(`/competitions/${competitionId}`);
    },
    onError: (e: any) => {
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to save pick');
    },
  });

  if (!Number.isFinite(competitionId) || !Number.isFinite(gwId)) {
    return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}><Text style={styles.error}>Invalid route parameters.</Text></SafeAreaView>;
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={fixturesQuery.isRefetching} onRefresh={() => void fixturesQuery.refetch()} tintColor={colors.brand} />}
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
          {fixturesQuery.isLoading ? <MetaText>Loading teams...</MetaText> : null}
          {teamOptions.map((team) => {
            const selected = selectedTeamId === team.id;
            return (
              <TouchableOpacity
                key={team.id}
                style={[styles.option, selected ? styles.optionSelected : null]}
                onPress={() => setSelectedTeamId(team.id)}
              >
                <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>{team.label}</Text>
                {selected ? <Text style={styles.selectedTag}>Selected</Text> : null}
              </TouchableOpacity>
            );
          })}
          {teamOptions.length === 0 && !fixturesQuery.isLoading ? <MetaText>No eligible teams found.</MetaText> : null}
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton label={mutation.isPending ? 'Saving...' : 'Save Pick'} onPress={() => mutation.mutate()} disabled={!selectedTeamId || mutation.isPending} />
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
  optionText: { color: '#e5e7eb', flex: 1 },
  optionTextSelected: { color: '#fff', fontWeight: '700' },
  selectedTag: {
    color: '#7dd3fc',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
  },
  error: { color: '#fca5a5', marginTop: 10 },
});
