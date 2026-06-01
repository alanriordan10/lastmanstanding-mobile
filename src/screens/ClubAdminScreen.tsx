import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import Slider from '@react-native-community/slider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import { Image, Linking, Modal, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import type { Club, Competition, Participant } from '../types';
import { Card, FilterPill, MetaText, PrimaryButton, ScreenTitle, SectionTitle, StatusPill } from '../components/ui';
import { colors, spacing } from '../theme/tokens';

type StatusFilter = 'ALL' | 'ACTIVE' | 'ELIMINATED' | 'WINNER';
type ViewMode = 'ALL' | 'AWAITING' | 'PAID';
type FormMode = 'create' | 'edit';
type OpStatusTone = 'success' | 'error' | 'info';
type CompetitionFormErrors = { name?: string; startDate?: string };
type ConfirmDialogState = {
  title: string;
  message: string;
  items?: string[];
  confirmText: string;
  onConfirm: () => void;
} | null;

type UserSearchResult = { id: number; username: string; email: string; role: string };

const BRAND_COLOR_PRESETS = [
  '#0ea5e9', '#2563eb', '#4f46e5', '#7c3aed',
  '#db2777', '#dc2626', '#ea580c', '#d97706',
  '#16a34a', '#059669', '#0f766e', '#334155',
  '#f8fafc', '#cbd5e1', '#111827', '#020617',
];

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

type StripeConnectStatus = {
  stripeAccountId?: string | null;
  onboardingComplete?: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
};

interface CompetitionFormState {
  name: string;
  description: string;
  entryFee: string;
  prizePool: string;
  startDate: string;
  status: 'UPCOMING' | 'ACTIVE' | 'COMPLETED';
  paymentMode: 'FREE' | 'MANUAL' | 'STRIPE';
  manualPaymentPolicy: 'STRICT' | 'LENIENT';
  visibility: 'PUBLIC' | 'PRIVATE';
  fixtureCompetitionCode: 'PL' | 'WC';
  missedPickMode: 'ELIMINATE' | 'ALLOW';
  postponedConsumesTeam: boolean;
  lifelineEnabled: boolean;
  maxEntriesPerUser: string;
}

function toDateInput(value?: string | null): string {
  if (!value) return '';
  const raw = String(value);
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromInput(value: string) {
  if (!value) return new Date();
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function defaultForm(): CompetitionFormState {
  return {
    name: '', description: '', entryFee: '0', prizePool: '', startDate: '', status: 'UPCOMING', paymentMode: 'FREE', manualPaymentPolicy: 'STRICT', visibility: 'PUBLIC', fixtureCompetitionCode: 'PL', missedPickMode: 'ELIMINATE', postponedConsumesTeam: true, lifelineEnabled: false, maxEntriesPerUser: '1',
  };
}

function money(value?: number | null) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '€0';
  return `€${n.toFixed(2)}`;
}

function participantLabel(p: Participant, showEntry: boolean) {
  if (!showEntry || !p.entryNumber) return p.username;
  return `${p.username} (Entry #${p.entryNumber})`;
}

export default function ClubAdminScreen() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<number | null>(null);
  const [managingCompetitionId, setManagingCompetitionId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [viewMode, setViewMode] = useState<ViewMode>('ALL');
  const [expandedParticipantIds, setExpandedParticipantIds] = useState<Set<number>>(new Set());
  const [formMode, setFormMode] = useState<FormMode>('create');
  const [form, setForm] = useState<CompetitionFormState>(defaultForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<CompetitionFormErrors>({});
  const [opStatus, setOpStatus] = useState<{ tone: OpStatusTone; message: string } | null>(null);

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [compSearch, setCompSearch] = useState('');
  const [compStatusFilter, setCompStatusFilter] = useState<'ALL' | 'UPCOMING' | 'ACTIVE' | 'COMPLETED'>('ALL');
  const [participantPage, setParticipantPage] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [guestUsername, setGuestUsername] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [stripeOpen, setStripeOpen] = useState(false);
  const [showCompetitionModal, setShowCompetitionModal] = useState(false);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const [showAssignAdmin, setShowAssignAdmin] = useState(false);
  const [adminSearchQuery, setAdminSearchQuery] = useState('');
  const [showBrandingForm, setShowBrandingForm] = useState(false);
  const [brandingPrimary, setBrandingPrimary] = useState('');
  const [brandingSecondary, setBrandingSecondary] = useState('');
  const [brandingLogoUrl, setBrandingLogoUrl] = useState('');

  const clubQuery = useQuery({ queryKey: ['club-admin', 'my-club'], queryFn: async () => (await api.get<Club>('/club-admin/my-club')).data });
  const competitionsQuery = useQuery({ queryKey: ['club-admin', 'competitions'], queryFn: async () => {
    const data = (await api.get<Competition[]>('/club-admin/competitions')).data;
    return Array.isArray(data) ? data : [];
  } });
  const stripeStatusQuery = useQuery({
    queryKey: ['club-admin', 'stripe-connect-status'],
    queryFn: async () => (await api.get<StripeConnectStatus>('/club-admin/my-club/stripe/connect/status')).data,
  });

  const adminSearchQueryResult = useQuery({
    queryKey: ['club-admin', 'admin-search', adminSearchQuery],
    queryFn: async () => (await api.get<UserSearchResult[]>('/club-admin/users/search', { params: { q: adminSearchQuery.trim() } })).data ?? [],
    enabled: showAssignAdmin && adminSearchQuery.trim().length >= 2,
  });

  const selectedCompetition = useMemo(() => competitionsQuery.data?.find((c) => c.id === selectedCompetitionId) ?? null, [competitionsQuery.data, selectedCompetitionId]);
  const managedCompetition = useMemo(() => competitionsQuery.data?.find((c) => c.id === managingCompetitionId) ?? null, [competitionsQuery.data, managingCompetitionId]);

  const filteredCompetitions = useMemo(() => {
    let list = competitionsQuery.data ?? [];
    if (compStatusFilter !== 'ALL') list = list.filter((competition) => competition.status === compStatusFilter);
    if (compSearch.trim()) {
      const q = compSearch.toLowerCase();
      list = list.filter((competition) => competition.name.toLowerCase().includes(q));
    }
    return list;
  }, [competitionsQuery.data, compSearch, compStatusFilter]);

  const participantsQuery = useQuery({
    queryKey: ['club-admin', 'participants', managingCompetitionId],
    queryFn: async () => (await api.get<Participant[]>(`/club-admin/competitions/${managingCompetitionId}/participants`)).data,
    enabled: !!managingCompetitionId,
  });

  const paidParticipantsQuery = useQuery({
    queryKey: ['club-admin', 'paid-participants', managingCompetitionId],
    queryFn: async () => (await api.get<number[]>(`/club-admin/competitions/${managingCompetitionId}/paid-participants`)).data,
    enabled: !!managingCompetitionId && managedCompetition?.paymentMode === 'MANUAL',
  });

  const userSearchQuery = useQuery({
    queryKey: ['club-admin', 'users-search', userSearch],
    queryFn: async () => (await api.get<UserSearchResult[]>('/club-admin/users/search', { params: { q: userSearch.trim() } })).data ?? [],
    enabled: !!managingCompetitionId && showAddPanel && userSearch.trim().length >= 2,
  });

  useEffect(() => {
    const club = clubQuery.data;
    if (!club) return;
    setBrandingPrimary(club.primaryColor ?? '');
    setBrandingSecondary(club.secondaryColor ?? '');
    setBrandingLogoUrl(club.logoUrl ?? '');
  }, [clubQuery.data]);

  const assignAdminMutation = useMutation({
    mutationFn: async (userId: number) => api.put('/club-admin/my-club/assign-admin', { userId }),
    onSuccess: async () => {
      setOpStatus({ tone: 'success', message: 'Club admin updated successfully.' });
      setShowAssignAdmin(false);
      setAdminSearchQuery('');
      await clubQuery.refetch();
    },
    onError: (e: any) => setOpStatus({ tone: 'error', message: getApiMessage(e, 'Failed to assign admin.') }),
  });

  const brandingMutation = useMutation({
    mutationFn: async () => api.put('/club-admin/my-club/branding', {
      primaryColor: brandingPrimary.trim() || null,
      secondaryColor: brandingSecondary.trim() || null,
      logoUrl: brandingLogoUrl.trim() || null,
    }),
    onSuccess: async () => {
      setOpStatus({ tone: 'success', message: 'Club branding saved.' });
      setShowBrandingForm(false);
      await clubQuery.refetch();
    },
    onError: (e: any) => setOpStatus({ tone: 'error', message: getApiMessage(e, 'Failed to save branding.') }),
  });

  const pickLogoImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setOpStatus({ tone: 'error', message: 'Photo library permission is required to choose a logo.' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.75,
      base64: true,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.base64) {
      setOpStatus({ tone: 'error', message: 'Could not read the selected image.' });
      return;
    }
    const mimeType = asset.mimeType ?? 'image/jpeg';
    setBrandingLogoUrl(`data:${mimeType};base64,${asset.base64}`);
  };

  const paidSet = useMemo(() => new Set(paidParticipantsQuery.data ?? []), [paidParticipantsQuery.data]);
  const participants = participantsQuery.data ?? [];
  const entryCountByUserId = useMemo(() => {
    const counts = new Map<number, number>();
    for (const participant of participants) {
      counts.set(participant.userId, (counts.get(participant.userId) ?? 0) + 1);
    }
    return counts;
  }, [participants]);
  const activeParticipantCount = useMemo(() => participants.filter((p) => p.status === 'ACTIVE').length, [participants]);

  const awaitingParticipants = participants.filter((p) => !paidSet.has(p.id));
  const paidParticipants = participants.filter((p) => paidSet.has(p.id));

  const filteredParticipants = useMemo(() => {
    let all = participants;
    if (statusFilter !== 'ALL') all = all.filter((p) => p.status === statusFilter);
    if (viewMode === 'AWAITING') all = all.filter((p) => !paidSet.has(p.id));
    if (viewMode === 'PAID') all = all.filter((p) => paidSet.has(p.id));
    if (search.trim()) {
      const q = search.toLowerCase();
      all = all.filter((p) => p.username.toLowerCase().includes(q));
    }
    return all;
  }, [participants, paidSet, statusFilter, viewMode, search]);

  const PARTICIPANT_PAGE_SIZE = 25;
  const totalParticipantPages = Math.max(1, Math.ceil(filteredParticipants.length / PARTICIPANT_PAGE_SIZE));
  const currentParticipantPage = Math.min(participantPage, totalParticipantPages);
  const paginatedParticipants = filteredParticipants.slice((currentParticipantPage - 1) * PARTICIPANT_PAGE_SIZE, currentParticipantPage * PARTICIPANT_PAGE_SIZE);

  useEffect(() => {
    setParticipantPage(1);
  }, [search, statusFilter, viewMode, managingCompetitionId]);

  const stats = useMemo(() => {
    const comps = competitionsQuery.data ?? [];
    const paidCount = participants.filter((p) => paidSet.has(p.id)).length;
    const stripeCount = comps.filter((c) => c.paymentMode === 'STRIPE').length;
    const manualCount = comps.filter((c) => c.paymentMode === 'MANUAL').length;
    return { totalComps: comps.length, activeComps: comps.filter((c) => c.status === 'ACTIVE').length, selectedParticipants: participants.length, paidCount, stripeCount, manualCount };
  }, [competitionsQuery.data, participants, paidSet]);

  const setupItems = [
    { label: 'Create competition', done: stats.totalComps > 0 },
    { label: 'Configure payments', done: stats.manualCount > 0 || stats.stripeCount > 0 },
    { label: 'Manage participants', done: stats.selectedParticipants > 0 },
  ];
  const setupDone = setupItems.filter((i) => i.done).length;
  const stripeStatus = stripeStatusQuery.data;
  const stripeReady = Boolean(
    stripeStatus?.stripeAccountId &&
      stripeStatus?.onboardingComplete &&
      stripeStatus?.chargesEnabled &&
      stripeStatus?.payoutsEnabled,
  );
  const stripeSummary = stripeReady ? 'Ready' : stripeStatus?.stripeAccountId ? 'Setup incomplete' : 'Not connected';

  const mutationRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['club-admin', 'participants', managingCompetitionId] });
    await queryClient.invalidateQueries({ queryKey: ['club-admin', 'paid-participants', managingCompetitionId] });
    await queryClient.invalidateQueries({ queryKey: ['club-admin', 'competitions'] });
  };

  const getApiMessage = (error: any, fallback: string) => error?.response?.data?.message ?? fallback;

  const saveCompetitionMutation = useMutation({ mutationFn: async () => {
    const payload = {
      name: form.name.trim(), description: form.description.trim() ? form.description.trim() : null, entryFee: Number(form.entryFee || '0'), prizePool: form.prizePool.trim() ? Number(form.prizePool) : null,
      maxEntriesPerUser: Number(form.maxEntriesPerUser || '1'), fixtureCompetitionCode: form.fixtureCompetitionCode, missedPickMode: form.missedPickMode, postponedConsumesTeam: form.postponedConsumesTeam, lifelineEnabled: form.lifelineEnabled,
      passFeeToParticipant: false, paymentMode: form.paymentMode, manualPaymentPolicy: form.manualPaymentPolicy, visibility: form.visibility, startDate: form.startDate, status: form.status,
    };
    if (formMode === 'create') return api.post<Competition>('/club-admin/competitions', payload);
    if (!selectedCompetitionId) throw new Error('No competition selected');
    return api.put<Competition>(`/club-admin/competitions/${selectedCompetitionId}`, payload);
  }, onSuccess: async (res) => {
    setFormError(null);
    setFormErrors({});
    setShowStartDatePicker(false);
    setShowCompetitionModal(false);
    setOpStatus({ tone: 'success', message: formMode === 'create' ? 'Competition created.' : 'Competition updated.' });
    await queryClient.invalidateQueries({ queryKey: ['club-admin', 'competitions'] });
    const id = (res.data as any)?.id;
    if (id) { setSelectedCompetitionId(id); setManagingCompetitionId(id); }
    setFormMode('edit');
  }, onError: (e: any) => {
    const msg = getApiMessage(e, 'Failed to save competition');
    setFormError(msg);
    setOpStatus({ tone: 'error', message: msg });
  } });


  const deleteCompetitionMutation = useMutation({
    mutationFn: async (competitionId: number) => api.delete(`/club-admin/competitions/${competitionId}`),
    onSuccess: async () => {
      setOpStatus({ tone: 'success', message: 'Competition deleted.' });
      setSelectedCompetitionId(null);
      setManagingCompetitionId(null);
      await queryClient.invalidateQueries({ queryKey: ['club-admin', 'competitions'] });
    },
    onError: (e: any) => setOpStatus({ tone: 'error', message: getApiMessage(e, 'Failed to delete competition.') }),
  });

  const markPaidMutation = useMutation({
    mutationFn: async (participantId: number) => api.post(`/club-admin/competitions/${managingCompetitionId}/participants/${participantId}/mark-paid`),
    onSuccess: async () => {
      setOpStatus({ tone: 'success', message: 'Payment marked as paid.' });
      await mutationRefresh();
    },
    onError: (e: any) => setOpStatus({ tone: 'error', message: getApiMessage(e, 'Failed to mark payment.') }),
  });
  const unmarkPaidMutation = useMutation({
    mutationFn: async (participantId: number) => api.post(`/club-admin/competitions/${managingCompetitionId}/participants/${participantId}/unmark-paid`),
    onSuccess: async () => {
      setOpStatus({ tone: 'info', message: 'Payment reverted to awaiting.' });
      await mutationRefresh();
    },
    onError: (e: any) => setOpStatus({ tone: 'error', message: getApiMessage(e, 'Failed to revert payment.') }),
  });
  const removeParticipantMutation = useMutation({
    mutationFn: async (participantId: number) => api.delete(`/club-admin/competitions/${managingCompetitionId}/participants/${participantId}`),
    onSuccess: async () => {
      setOpStatus({ tone: 'success', message: 'Entry removed.' });
      await mutationRefresh();
    },
    onError: (e: any) => setOpStatus({ tone: 'error', message: getApiMessage(e, 'Failed to remove entry.') }),
  });
  const declareWinnerMutation = useMutation({
    mutationFn: async (participantId: number) => api.post(`/club-admin/competitions/${managingCompetitionId}/declare-winner/${participantId}`),
    onSuccess: async () => {
      setOpStatus({ tone: 'success', message: 'Winner declared.' });
      await mutationRefresh();
    },
    onError: (e: any) => setOpStatus({ tone: 'error', message: getApiMessage(e, 'Failed to declare winner.') }),
  });
  const addParticipantMutation = useMutation({
    mutationFn: async (payload: { userId?: number; guestUsername?: string; guestEmail?: string }) =>
      api.post(`/club-admin/competitions/${managingCompetitionId}/add-participant`, payload),
    onSuccess: async () => {
      setShowAddPanel(false);
      setUserSearch('');
      setGuestUsername('');
      setGuestEmail('');
      setOpStatus({ tone: 'success', message: 'Participant added.' });
      await mutationRefresh();
    },
    onError: (e: any) => setOpStatus({ tone: 'error', message: getApiMessage(e, 'Failed to add participant.') }),
  });


  const startStripeConnectMutation = useMutation({
    mutationFn: async () => (await api.post<{ url?: string }>('/club-admin/my-club/stripe/connect/start')).data,
    onSuccess: async (data) => {
      if (data?.url) await Linking.openURL(data.url);
      await stripeStatusQuery.refetch();
    },
    onError: (e: any) => setOpStatus({ tone: 'error', message: getApiMessage(e, 'Failed to start Stripe onboarding.') }),
  });
  const stripeDashboardLinkMutation = useMutation({
    mutationFn: async () => (await api.post<{ url?: string }>('/club-admin/my-club/stripe/connect/dashboard-link')).data,
    onSuccess: async (data) => {
      if (data?.url) await Linking.openURL(data.url);
    },
    onError: (e: any) => setOpStatus({ tone: 'error', message: getApiMessage(e, 'Failed to open Stripe dashboard.') }),
  });

  const syncFormFromCompetition = (competition: Competition) => {
    setFormMode('edit');
    setFormError(null);
    setFormErrors({});
    setShowStartDatePicker(false);
    setForm({
      name: competition.name ?? '', description: competition.description ?? '', entryFee: String(competition.entryFee ?? 0), prizePool: competition.prizePool != null ? String(competition.prizePool) : '',
      startDate: toDateInput(competition.startDate), status: (competition.status ?? 'UPCOMING') as 'UPCOMING' | 'ACTIVE' | 'COMPLETED', paymentMode: (competition.paymentMode ?? 'FREE') as 'FREE' | 'MANUAL' | 'STRIPE',
      visibility: (competition.visibility ?? 'PUBLIC') as 'PUBLIC' | 'PRIVATE', manualPaymentPolicy: (competition.manualPaymentPolicy ?? 'STRICT') as 'STRICT' | 'LENIENT', fixtureCompetitionCode: (competition.fixtureCompetitionCode ?? 'PL') as 'PL' | 'WC', missedPickMode: (competition.missedPickMode ?? 'ELIMINATE') as 'ELIMINATE' | 'ALLOW', postponedConsumesTeam: competition.postponedConsumesTeam ?? true, lifelineEnabled: Boolean(competition.lifelineEnabled), maxEntriesPerUser: String(competition.maxEntriesPerUser ?? 1),
    });
  };

  const closeCompetitionModal = () => {
    setShowStartDatePicker(false);
    setFormErrors({});
    setFormError(null);
    setShowCompetitionModal(false);
  };

  const beginCreate = () => {
    setFormMode('create');
    setSelectedCompetitionId(null);
    setFormError(null);
    setFormErrors({});
    setShowStartDatePicker(false);
    setForm({ ...defaultForm(), startDate: new Date().toISOString().slice(0, 10) });
    setShowCompetitionModal(true);
  };

  const clearFormError = (field: keyof CompetitionFormErrors) => {
    setFormErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const validateCompetitionForm = () => {
    const errors: CompetitionFormErrors = {};
    if (!form.name.trim()) errors.name = 'Competition name is required.';
    if (!form.startDate.trim()) errors.startDate = 'Start date is required.';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveCompetition = () => {
    setFormError(null);
    if (!validateCompetitionForm()) return;
    saveCompetitionMutation.mutate();
  };

  const handleStartDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowStartDatePicker(false);
    if (selectedDate) {
      setForm((state) => ({ ...state, startDate: toDateInputValue(selectedDate) }));
      clearFormError('startDate');
    }
  };

  const runConfirmedAction = () => {
    const action = confirmDialog?.onConfirm;
    setConfirmDialog(null);
    action?.();
  };

  const exportPaymentsCsv = async () => {
    const csvValue = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = participants.map((p) => [
      p.id,
      p.username,
      p.entryNumber ?? '',
      p.status,
      paidSet.has(p.id) ? 'PAID' : 'AWAITING_PAYMENT',
      p.eliminatedWeek ?? '',
      p.joinedAt,
    ].map(csvValue).join(','));
    const csv = ['participant_id,username,entry_number,status,payment_status,eliminated_week,joined_at', ...rows].join('\n');
    try {
      await Share.share({
        title: 'Participants CSV',
        message: csv,
      });
      setOpStatus({ tone: 'success', message: 'CSV export opened.' });
    } catch (e: any) {
      setOpStatus({ tone: 'error', message: e?.message ?? 'Failed to export CSV.' });
    }
  };

  const refreshing = clubQuery.isRefetching || competitionsQuery.isRefetching || participantsQuery.isRefetching || paidParticipantsQuery.isRefetching;

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void Promise.all([clubQuery.refetch(), competitionsQuery.refetch(), participantsQuery.refetch(), paidParticipantsQuery.refetch()])} tintColor={colors.brand} />}>
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>Club Control</Text>
          <ScreenTitle>{clubQuery.data?.name ?? 'My Club'}</ScreenTitle>
          <MetaText>Manage competitions, setup, and participant operations.</MetaText>
          <Text style={styles.heroAdminLine}>Admin: {(clubQuery.data as any)?.clubAdminUsername ?? 'Club admin'}</Text>
          <View style={styles.metricRow}>
            <View style={styles.metric}><Text style={styles.metricValue}>{stats.totalComps}</Text><Text style={styles.metricLabel}>Competitions</Text></View>
            <View style={styles.metric}><Text style={styles.metricValue}>{stats.activeComps}</Text><Text style={styles.metricLabel}>Active</Text></View>
            <View style={styles.metric}><Text style={styles.metricValue}>{stats.selectedParticipants}</Text><Text style={styles.metricLabel}>Participants</Text></View>
          </View>
          <TouchableOpacity style={styles.heroCreateBtn} onPress={beginCreate}><Text style={styles.heroCreateBtnText}>+ New Competition</Text></TouchableOpacity>
        </View>

        <Card>
          <TouchableOpacity style={styles.collapseHeader} onPress={() => setChecklistOpen((v) => !v)}>
            <View>
              <SectionTitle>Setup Checklist</SectionTitle>
              <MetaText>{setupDone}/{setupItems.length} setup milestones complete.</MetaText>
            </View>
            <View style={[styles.collapseIconBox, checklistOpen ? styles.collapseIconBoxOpen : null]}><Text style={styles.collapseIcon}>{checklistOpen ? '▲' : '▼'}</Text></View>
          </TouchableOpacity>
          {checklistOpen ? (
            <View style={styles.setupList}>
              {setupItems.map((item) => (
                <View key={item.label} style={[styles.setupRow, item.done ? styles.setupRowDone : styles.setupRowTodo]}>
                  <Text style={[styles.setupIcon, item.done ? styles.setupIconDone : styles.setupIconTodo]}>{item.done ? '✓' : '○'}</Text>
                  <Text style={[styles.setupText, item.done ? styles.setupTextDone : null]}>{item.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>

        <Card>
          <TouchableOpacity style={styles.collapseHeader} onPress={() => setStripeOpen((v) => !v)}>
            <View style={styles.collapseHeaderText}>
              <View style={styles.stripeHeaderTitleRow}>
                <SectionTitle>Stripe Connect</SectionTitle>
                <View style={[styles.collapseIconBox, stripeOpen ? styles.collapseIconBoxOpen : null]}><Text style={styles.collapseIcon}>{stripeOpen ? '▲' : '▼'}</Text></View>
              </View>
              <MetaText>Connect your club for Stripe card payments and payouts.</MetaText>
              <View style={styles.stripeHeaderStatusRow}>
                <View style={[styles.stripeSummaryPill, stripeReady ? styles.stripeSummaryPillReady : styles.stripeSummaryPillWarn]}>
                  <Text
                    style={[styles.stripeSummaryText, stripeReady ? styles.stripeSummaryTextReady : styles.stripeSummaryTextWarn]}
                    numberOfLines={1}
                  >
                    {stripeSummary}
                  </Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
          {stripeOpen ? (
            <View style={styles.stripeBody}>
              <View style={styles.chipWrap}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => void stripeStatusQuery.refetch()}>
                  <Text style={styles.secondaryBtnText}>{stripeStatusQuery.isLoading ? 'Refreshing...' : 'Refresh status'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => startStripeConnectMutation.mutate()}>
                  <Text style={styles.secondaryBtnText}>{stripeReady ? 'Reconnect Stripe' : stripeStatus?.stripeAccountId ? 'Continue onboarding' : 'Connect Stripe'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => stripeDashboardLinkMutation.mutate()} disabled={!stripeStatus?.stripeAccountId}>
                  <Text style={styles.secondaryBtnText}>Manage payouts</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.stripeInfoBox}><Text style={styles.stripeInfoLabel}>Account</Text><Text style={styles.stripeInfoValue}>{stripeStatus?.stripeAccountId ?? 'Not connected'}</Text></View>
              <View style={styles.stripeStatusRow}>
                <View style={[styles.stripeChip, stripeStatus?.onboardingComplete ? styles.stripeChipGood : styles.stripeChipWarn]}><Text style={styles.stripeChipText}>Onboarding: {stripeStatus?.onboardingComplete ? 'Complete' : 'Incomplete'}</Text></View>
                <View style={[styles.stripeChip, stripeStatus?.chargesEnabled ? styles.stripeChipGood : styles.stripeChipWarn]}><Text style={styles.stripeChipText}>Charges: {stripeStatus?.chargesEnabled ? 'On' : 'Off'}</Text></View>
                <View style={[styles.stripeChip, stripeStatus?.payoutsEnabled ? styles.stripeChipGood : styles.stripeChipWarn]}><Text style={styles.stripeChipText}>Payouts: {stripeStatus?.payoutsEnabled ? 'On' : 'Off'}</Text></View>
              </View>
            </View>
          ) : null}
        </Card>

        <Card>
          <View style={styles.webCardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.webSectionTitle}>Club Settings</Text>
              <Text style={styles.webSectionSub}>Transfer admin access or review club-level ownership details.</Text>
            </View>
            <TouchableOpacity style={styles.webGhostButton} onPress={() => { setShowAssignAdmin((v) => !v); setAdminSearchQuery(''); }}>
              <Text style={styles.webGhostButtonText}>{showAssignAdmin ? 'Cancel' : 'Assign New Admin'}</Text>
            </TouchableOpacity>
          </View>
          {showAssignAdmin ? (
            <View style={styles.webBluePanel}>
              <Text style={styles.webHelpText}>Search for a user to transfer club admin to. They will be promoted to Club Admin role and you will remain as a regular user.</Text>
              <TextInput value={adminSearchQuery} onChangeText={setAdminSearchQuery} placeholder="Search by username or email..." placeholderTextColor={colors.textMuted} style={styles.input} />
              {adminSearchQuery.trim().length > 0 && adminSearchQuery.trim().length < 2 ? <MetaText>Type at least 2 characters.</MetaText> : null}
              {adminSearchQueryResult.isLoading ? <MetaText>Searching...</MetaText> : null}
              {adminSearchQuery.trim().length >= 2 && !adminSearchQueryResult.isLoading && (adminSearchQueryResult.data ?? []).length === 0 ? <MetaText>No users found.</MetaText> : null}
              {(adminSearchQueryResult.data ?? []).slice(0, 8).map((u) => (
                <View key={u.id} style={styles.adminResultRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.adminResultName}>{u.username}</Text>
                    <Text style={styles.adminResultEmail}>{u.email}</Text>
                  </View>
                  <TouchableOpacity style={styles.assignBtn} onPress={() => assignAdminMutation.mutate(u.id)} disabled={assignAdminMutation.isPending}>
                    <Text style={styles.assignBtnText}>{assignAdminMutation.isPending ? '...' : 'Assign'}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
        </Card>

        <Card>
          <View style={styles.webCardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.webSectionTitle}>Club Branding</Text>
              <Text style={styles.webSectionSub}>Set a logo and colour scheme that appears on your competition pages.</Text>
            </View>
            <TouchableOpacity style={styles.webGhostButton} onPress={() => setShowBrandingForm((v) => !v)}>
              <Text style={styles.webGhostButtonText}>{showBrandingForm ? 'Cancel' : 'Edit Branding'}</Text>
            </TouchableOpacity>
          </View>
          {(clubQuery.data?.primaryColor || clubQuery.data?.logoUrl) && !showBrandingForm ? (
            <View style={styles.brandPreviewRow}>
              {clubQuery.data?.logoUrl ? <Image source={{ uri: clubQuery.data.logoUrl }} style={styles.brandLogoPreview} /> : null}
              <View style={styles.brandColorWrap}>
                {clubQuery.data?.primaryColor ? <ColorPreview label={clubQuery.data.primaryColor} color={clubQuery.data.primaryColor} /> : null}
                {clubQuery.data?.secondaryColor ? <ColorPreview label={clubQuery.data.secondaryColor} color={clubQuery.data.secondaryColor} /> : null}
              </View>
            </View>
          ) : null}
          {showBrandingForm ? (
            <View style={styles.webBluePanel}>
              <BrandColorPicker label="Primary Colour" value={brandingPrimary} fallback="#6366f1" onChange={setBrandingPrimary} />
              <BrandColorPicker label="Secondary Colour" optional value={brandingSecondary} fallback="#a5b4fc" onChange={setBrandingSecondary} />
              <Text style={styles.fieldLabel}>Club Logo</Text>
              <View style={styles.logoPickerRow}>
                {brandingLogoUrl ? <Image source={{ uri: brandingLogoUrl }} style={styles.brandLogoPreview} /> : <View style={styles.emptyLogoPreview}><Text style={styles.emptyLogoText}>Logo</Text></View>}
                <View style={styles.logoPickerActions}>
                  <TouchableOpacity style={styles.logoPickerBtn} onPress={() => void pickLogoImage()}>
                    <Text style={styles.logoPickerBtnText}>{brandingLogoUrl ? 'Replace logo...' : 'Choose file...'}</Text>
                  </TouchableOpacity>
                  {brandingLogoUrl ? <TouchableOpacity onPress={() => setBrandingLogoUrl('')}><Text style={styles.removeLogoText}>Remove logo</Text></TouchableOpacity> : null}
                </View>
              </View>
              <Text style={styles.fieldHelp}>Choose an image from your phone, or paste a hosted logo URL below.</Text>
              <View style={styles.logoInputRow}>
                <TextInput value={brandingLogoUrl} onChangeText={setBrandingLogoUrl} placeholder="https://... or data:image/..." placeholderTextColor={colors.textMuted} autoCapitalize="none" style={[styles.input, styles.logoTextInput]} />
              </View>
              <PrimaryButton label={brandingMutation.isPending ? 'Saving...' : 'Save Branding'} onPress={() => brandingMutation.mutate()} disabled={brandingMutation.isPending} />
            </View>
          ) : null}
        </Card>

        <Card>
          {opStatus ? (
            <View style={[styles.feedbackBox, opStatus.tone === 'success' ? styles.feedbackSuccess : opStatus.tone === 'error' ? styles.feedbackError : styles.feedbackInfo]}>
              <Text style={styles.feedbackText}>{opStatus.message}</Text>
            </View>
          ) : null}
          <SectionTitle>Competitions</SectionTitle>
          <TextInput value={compSearch} onChangeText={setCompSearch} placeholder="Search competitions..." placeholderTextColor={colors.textMuted} style={styles.input} />
          <View style={styles.chipWrap}>{(['ALL', 'UPCOMING', 'ACTIVE', 'COMPLETED'] as const).map((status) => <FilterPill key={status} label={status} active={compStatusFilter === status} onPress={() => setCompStatusFilter(status)} />)}</View>
          {(compSearch.trim() || compStatusFilter !== 'ALL') ? <MetaText>{filteredCompetitions.length} results · filtered</MetaText> : null}
          {filteredCompetitions.map((c) => {
            const active = c.id === selectedCompetitionId;
            const managing = c.id === managingCompetitionId;
            return (
              <View key={c.id} style={styles.compBlock}>
                <View style={[styles.webCompetitionCard, active ? styles.webCompetitionCardActive : null]}>
                  <TouchableOpacity onPress={() => { setSelectedCompetitionId(c.id); syncFormFromCompetition(c); }} activeOpacity={0.85}>
                    <View style={styles.webCompetitionTopRow}>
                      <View style={styles.webCompetitionTitleBlock}>
                        <View style={styles.webBadgeTitleRow}>
                          <StatusPill text={c.status} tone={c.status === 'ACTIVE' ? 'success' : c.status === 'UPCOMING' ? 'info' : 'neutral'} />
                          <StatusPill text={c.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC'} tone={c.visibility === 'PRIVATE' ? 'warn' : 'neutral'} />
                        </View>
                        <Text style={styles.webCompetitionName} numberOfLines={1}>{c.name}</Text>
                        <View style={styles.webCompetitionMetaRow}>
                          <Text style={styles.webCompetitionMeta}>Starts {toDateInput(c.startDate) || '—'}</Text>
                          <Text style={styles.webCompetitionMeta}>{c.participantCount} players ({c.activeCount} active)</Text>
                          {c.entryFee > 0 ? <Text style={styles.webCompetitionFee}>€{c.entryFee}</Text> : null}
                        </View>
                        {c.visibility === 'PRIVATE' && c.joinCode ? (
                          <View style={styles.inviteCodeBox}>
                            <Text style={styles.inviteCodeLabel}>Invite code</Text>
                            <Text style={styles.inviteCodeValue}>{c.joinCode}</Text>
                          </View>
                        ) : (
                          <View style={styles.publicCodeBox}><Text style={styles.publicCodeText}>Public - no invite code required.</Text></View>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                  <View style={styles.webCompetitionActions}>
                    <TouchableOpacity style={[styles.webActionBtn, styles.copyInviteBtn]} onPress={() => Share.share({ message: c.joinCode ? `Join ${c.name} with invite code ${c.joinCode}` : `Join ${c.name} on Last Man Standing.` })}>
                      <Text style={styles.copyInviteText}>{c.joinCode ? 'Copy Invite' : 'Copy Public Link'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.webActionBtn, styles.editCompBtn]} onPress={() => { setSelectedCompetitionId(c.id); syncFormFromCompetition(c); setShowCompetitionModal(true); }}><Text style={styles.editCompBtnText}>Edit</Text></TouchableOpacity>
                    <TouchableOpacity style={[styles.webActionBtn, styles.viewCompBtn]} onPress={() => router.push(`/competitions/${c.id}`)}><Text style={styles.viewCompBtnText}>View</Text></TouchableOpacity>
                    <TouchableOpacity style={[styles.webActionBtn, styles.dropdownBtnInline]} onPress={() => {
                    setManagingCompetitionId((prev) => prev === c.id ? null : c.id);
                    setExpandedParticipantIds(new Set());
                    setShowAddPanel(false);
                  }}><Text style={styles.dropdownBtnText}>{managing ? 'Participants ▲' : 'Participants ▼'}</Text></TouchableOpacity>
                    <TouchableOpacity style={[styles.webActionBtn, styles.deleteCompBtn]} onPress={() => setConfirmDialog({ title: `Delete ${c.name}?`, message: 'This will permanently delete this competition and related competition data.', items: ['Participants, picks, payments, and gameweek data may be removed.', 'This action cannot be undone.'], confirmText: 'Delete Competition', onConfirm: () => deleteCompetitionMutation.mutate(c.id) })} disabled={deleteCompetitionMutation.isPending}>
                      <Text style={styles.deleteCompBtnText}>{deleteCompetitionMutation.isPending ? 'Deleting...' : 'Delete'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {managing ? (
                  <View style={styles.panel}>
                    <View style={styles.payOps}>
                        {showAddPanel ? (
                          <View style={styles.addPanel}>
                            <TextInput value={userSearch} onChangeText={setUserSearch} placeholder="Search users (min 2 chars)" placeholderTextColor={colors.textMuted} style={styles.input} />
                            {userSearch.trim().length > 0 && userSearch.trim().length < 2 ? <MetaText>Type at least 2 characters to search.</MetaText> : null}
                            {userSearchQuery.isLoading ? <MetaText>Searching users...</MetaText> : null}
                            {userSearch.trim().length >= 2 && !userSearchQuery.isLoading && (userSearchQuery.data ?? []).length === 0 ? <MetaText>No users found.</MetaText> : null}
                            {(userSearchQuery.data ?? []).slice(0, 8).map((u) => (
                              <View key={u.id} style={styles.userResultRow}>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.userResultName}>{u.username}</Text>
                                  <Text style={styles.userResultEmail}>{u.email}</Text>
                                </View>
                                <TouchableOpacity style={styles.payBtn} onPress={() => addParticipantMutation.mutate({ userId: u.id })}>
                                  <Text style={styles.payBtnText}>Add</Text>
                                </TouchableOpacity>
                              </View>
                            ))}

                            <Text style={styles.addGuestTitle}>Or add guest</Text>
                            <TextInput value={guestUsername} onChangeText={setGuestUsername} placeholder="Guest username" placeholderTextColor={colors.textMuted} style={styles.input} />
                            <TextInput value={guestEmail} onChangeText={setGuestEmail} placeholder="Guest email (optional)" placeholderTextColor={colors.textMuted} style={styles.input} />
                            <TouchableOpacity style={styles.payBtn} onPress={() => addParticipantMutation.mutate({ guestUsername: guestUsername.trim(), guestEmail: guestEmail.trim() || undefined })} disabled={addParticipantMutation.isPending || !guestUsername.trim()}>
                              <Text style={styles.payBtnText}>{addParticipantMutation.isPending ? 'Adding...' : 'Add guest'}</Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>

                    <View style={styles.participantsHeaderRow}>
                      <Text style={styles.participantsHeaderTitle}>Participants ({participants.length})</Text>
                      {c.paymentMode === 'MANUAL' && awaitingParticipants.length > 0 ? <Text style={styles.awaitingInline}>· {awaitingParticipants.length} awaiting payment</Text> : null}
                    </View>

                    {c.paymentMode === 'MANUAL' ? (
                      <View style={styles.manualHintBox}>
                        <Text style={styles.manualHintText}>Manual payment competition — confirm payment once received.</Text>
                      </View>
                    ) : null}

                    {participants.length > 0 ? (
                      <View style={styles.participantToolbar}>
                        <View style={styles.participantToolbarTop}>
                          <TextInput value={search} onChangeText={setSearch} placeholder="Search participants..." placeholderTextColor={colors.textMuted} style={styles.toolbarSearchInputCompact} />
                          <TouchableOpacity style={[styles.toolbarSmallBtn, mobileFiltersOpen ? styles.toolbarSmallBtnActive : null]} onPress={() => setMobileFiltersOpen((v) => !v)}>
                            <Text style={[styles.toolbarSmallBtnText, mobileFiltersOpen ? styles.toolbarSmallBtnTextActive : null]}>Filters</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.toolbarActionGrid}>
                          <TouchableOpacity style={styles.toolbarActionBtn} onPress={() => setShowAddPanel((v) => !v)}>
                            <Text style={styles.toolbarActionText}>{showAddPanel ? 'Close add panel' : 'Add participant'}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.toolbarActionBtn} onPress={exportPaymentsCsv}>
                            <Text style={styles.toolbarActionText}>Export CSV</Text>
                          </TouchableOpacity>
                        </View>
                        {mobileFiltersOpen ? (
                          <View style={styles.filtersDrawer}>
                            <Text style={styles.toolbarLabel}>Status</Text>
                            <View style={styles.compactChipRow}>{(['ALL', 'ACTIVE', 'ELIMINATED', 'WINNER'] as const).map((s) => <FilterPill key={s} label={s} active={statusFilter === s} onPress={() => setStatusFilter(s)} />)}</View>
                            {c.paymentMode === 'MANUAL' ? (
                              <>
                                <Text style={styles.toolbarLabel}>Payment</Text>
                                <View style={styles.compactChipRow}>{(['ALL', 'AWAITING', 'PAID'] as const).map((v) => <FilterPill key={v} label={v} active={viewMode === v} onPress={() => setViewMode(v)} />)}</View>
                              </>
                            ) : null}
                          </View>
                        ) : null}
                        {(statusFilter !== 'ALL' || viewMode !== 'ALL' || search.trim()) ? (
                          <View style={styles.activeFilterBar}>
                            <Text style={styles.activeFilterText}>{filteredParticipants.length} results · filtered</Text>
                            <TouchableOpacity onPress={() => { setSearch(''); setStatusFilter('ALL'); setViewMode('ALL'); }}>
                              <Text style={styles.clearFilterText}>Clear</Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                    ) : null}

                    {paginatedParticipants.map((p) => {
                      const paid = paidSet.has(p.id);
                      const canManualPay = c.paymentMode === 'MANUAL';
                      const paymentUpdating = (markPaidMutation.isPending && markPaidMutation.variables === p.id) || (unmarkPaidMutation.isPending && unmarkPaidMutation.variables === p.id);
                      const canDeclareWinner = p.status === 'ACTIVE' && c.status !== 'COMPLETED' && activeParticipantCount > 1;
                      const isExpanded = expandedParticipantIds.has(p.id);
                      return (
                        <View key={p.id} style={styles.participantCard}>
                          <View style={styles.participantHeaderRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.participantName}>{participantLabel(p, (entryCountByUserId.get(p.userId) ?? 0) > 1)}</Text>
                              <View style={styles.inlineMeta}>
                                <StatusPill text={p.status} tone={p.status === 'ACTIVE' ? 'success' : p.status === 'WINNER' ? 'brand' : 'danger'} />
                                {canManualPay ? <StatusPill text={paid ? 'PAID' : 'AWAITING'} tone={paid ? 'success' : 'warn'} /> : null}
                              </View>
                              <MetaText>{p.eliminatedWeek ? `Eliminated GW${p.eliminatedWeek}` : 'Still eligible'}</MetaText>
                            </View>
                            <View style={styles.participantQuickActions}>
                              <TouchableOpacity style={styles.detailsBtn} onPress={() =>
                                setExpandedParticipantIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(p.id)) next.delete(p.id);
                                  else next.add(p.id);
                                  return next;
                                })
                              }>
                                <Text style={styles.detailsBtnText}>{isExpanded ? 'Hide' : 'More'}</Text>
                              </TouchableOpacity>
                            </View>
                          </View>

                          {isExpanded ? (
                            <View style={styles.expandedPanel}>
                              <View style={styles.actionRowWrap}>
                                {canManualPay ? (paid ? (
                                  <TouchableOpacity style={[styles.warnBtn, paymentUpdating ? styles.actionBtnDisabled : null]} onPress={() => setConfirmDialog({ title: `Revert payment for ${participantLabel(p, (entryCountByUserId.get(p.userId) ?? 0) > 1)}?`, message: 'This will move this entry back to awaiting payment.', items: ['The player may lose paid status for this competition entry.', 'Use this only when payment was marked incorrectly or refunded.'], confirmText: 'Revert Payment', onConfirm: () => unmarkPaidMutation.mutate(p.id) })} disabled={paymentUpdating}>
                                    <Text style={styles.warnBtnText}>{paymentUpdating ? 'Saving...' : 'Revert'}</Text>
                                  </TouchableOpacity>
                                ) : (
                                  <TouchableOpacity style={[styles.payBtn, paymentUpdating ? styles.actionBtnDisabled : null]} onPress={() => markPaidMutation.mutate(p.id)} disabled={paymentUpdating}>
                                    <Text style={styles.payBtnText}>{paymentUpdating ? 'Saving...' : 'Mark paid'}</Text>
                                  </TouchableOpacity>
                                )) : null}
                                {canDeclareWinner ? <TouchableOpacity style={styles.winBtn} onPress={() => setConfirmDialog({ title: `Declare ${participantLabel(p, (entryCountByUserId.get(p.userId) ?? 0) > 1)} as winner?`, message: 'This will mark this entry as the competition winner.', items: ['Use this only when the competition is ready to be closed.', 'Other active entries may be affected by the winner workflow.'], confirmText: 'Declare Winner', onConfirm: () => declareWinnerMutation.mutate(p.id) })}><Text style={styles.winBtnText}>Declare winner</Text></TouchableOpacity> : null}
                                <TouchableOpacity style={styles.removeBtn} onPress={() => setConfirmDialog({ title: `Remove ${participantLabel(p, (entryCountByUserId.get(p.userId) ?? 0) > 1)}?`, message: 'This removes this entry from the competition.', items: ['Payment and pick history for this entry may be affected.', 'This action cannot be undone.'], confirmText: 'Remove Participant', onConfirm: () => removeParticipantMutation.mutate(p.id) })}><Text style={styles.removeBtnText}>Remove participant</Text></TouchableOpacity>
                              </View>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                    {filteredParticipants.length === 0 ? <MetaText>No participants match your filters</MetaText> : null}
                    {filteredParticipants.length > 0 && totalParticipantPages > 1 ? (
                      <View style={styles.paginationRow}>
                        <TouchableOpacity style={styles.pageBtn} onPress={() => setParticipantPage((p) => Math.max(1, p - 1))} disabled={currentParticipantPage === 1}><Text style={styles.pageBtnText}>← Prev</Text></TouchableOpacity>
                        <Text style={styles.pageInfo}>Page {currentParticipantPage}/{totalParticipantPages}</Text>
                        <TouchableOpacity style={styles.pageBtn} onPress={() => setParticipantPage((p) => Math.min(totalParticipantPages, p + 1))} disabled={currentParticipantPage === totalParticipantPages}><Text style={styles.pageBtnText}>Next →</Text></TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
          {filteredCompetitions.length === 0 ? <MetaText>No competitions match your filters</MetaText> : null}
        </Card>

        <Modal visible={confirmDialog !== null} animationType="fade" transparent onRequestClose={() => setConfirmDialog(null)}>
          <View style={styles.confirmBackdrop}>
            <View style={styles.confirmCard}>
              <View style={styles.confirmIconWrap}>
                <Text style={styles.confirmIcon}>!</Text>
              </View>
              <Text style={styles.confirmTitle}>{confirmDialog?.title}</Text>
              <Text style={styles.confirmMessage}>{confirmDialog?.message}</Text>
              {confirmDialog?.items?.map((item) => (
                <View key={item} style={styles.confirmItemRow}>
                  <Text style={styles.confirmBullet}>•</Text>
                  <Text style={styles.confirmItemText}>{item}</Text>
                </View>
              ))}
              <View style={styles.confirmActions}>
                <TouchableOpacity style={styles.confirmCancelButton} onPress={() => setConfirmDialog(null)}>
                  <Text style={styles.confirmCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmDeleteButton} onPress={runConfirmedAction}>
                  <Text style={styles.confirmDeleteText}>{confirmDialog?.confirmText ?? 'Confirm'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={showCompetitionModal} animationType="slide" transparent onRequestClose={closeCompetitionModal}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>{formMode === 'create' ? 'New Competition' : 'Edit Competition'}</Text>
                  <Text style={styles.modalSubtitle}>{formMode === 'create' ? 'Create a new club competition and configure how players join.' : 'Update prize money, entry settings, timing, and visibility.'}</Text>
                </View>
                <TouchableOpacity style={styles.modalCloseButton} onPress={closeCompetitionModal}>
                  <Text style={styles.modalCloseText}>X</Text>
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={styles.modalBody}>
                <View style={styles.modalSection}>
                  <Text style={styles.fieldLabel}>Name *</Text>
                  <TextInput
                    value={form.name}
                    onChangeText={(v) => { setForm((state) => ({ ...state, name: v })); clearFormError('name'); }}
                    placeholder="Competition name"
                    placeholderTextColor={colors.textMuted}
                    style={[styles.modalInput, formErrors.name ? styles.inputError : null]}
                  />
                  {formErrors.name ? <Text style={styles.fieldErrorText}>{formErrors.name}</Text> : null}
                  <Text style={styles.fieldLabel}>Start Date *</Text>
                  <TouchableOpacity style={[styles.datePickerButton, formErrors.startDate ? styles.inputError : null]} onPress={() => setShowStartDatePicker(true)}>
                    <Text style={form.startDate ? styles.datePickerValue : styles.datePickerPlaceholder}>{form.startDate || 'Select start date'}</Text>
                    <Text style={styles.datePickerIcon}>📅</Text>
                  </TouchableOpacity>
                  {showStartDatePicker ? (
                    <DateTimePicker
                      value={dateFromInput(form.startDate)}
                      mode="date"
                      display="default"
                      minimumDate={formMode === 'create' ? new Date() : undefined}
                      onChange={handleStartDateChange}
                    />
                  ) : null}
                  {formErrors.startDate ? <Text style={styles.fieldErrorText}>{formErrors.startDate}</Text> : null}
                  <Text style={styles.fieldHelp}>The first gameweek starts from the next unstarted fixture week on or after this date.</Text>
                  <Text style={styles.fieldLabel}>Description</Text>
                  <TextInput value={form.description} onChangeText={(v) => setForm((state) => ({ ...state, description: v }))} placeholder="Optional description" placeholderTextColor={colors.textMuted} style={[styles.modalInput, styles.modalTextarea]} multiline />
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.fieldLabel}>Visibility</Text>
                  <View style={styles.optionGrid}>
                    {([
                      { value: 'PRIVATE', label: 'Private', icon: '🔐', desc: 'Hidden from browse. Join by code or invite link.' },
                      { value: 'PUBLIC', label: 'Public', icon: '🌍', desc: 'Visible in the main competitions list.' },
                    ] as const).map((option) => (
                      <TouchableOpacity key={option.value} style={[styles.optionCard, form.visibility === option.value ? styles.optionCardActive : null]} onPress={() => setForm((state) => ({ ...state, visibility: option.value }))}>
                        <Text style={styles.optionIcon}>{option.icon}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.optionTitle}>{option.label}</Text>
                          <Text style={styles.optionDesc}>{option.desc}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.fieldLabel}>Payment Mode</Text>
                  <View style={styles.optionGrid}>
                    {([
                      { value: 'FREE', label: 'Free', icon: '🎉', desc: 'No entry fee' },
                      { value: 'MANUAL', label: 'Manual', icon: '💸', desc: 'Revolut / cash / bank transfer' },
                      { value: 'STRIPE', label: 'Online', icon: '💳', desc: 'Players pay by card via Stripe' },
                    ] as const).map((option) => (
                      <TouchableOpacity key={option.value} style={[styles.paymentOptionCard, form.paymentMode === option.value ? styles.optionCardActive : null, option.value === 'STRIPE' && !stripeReady ? styles.optionCardDisabled : null]} onPress={() => {
                        if (option.value === 'STRIPE' && !stripeReady) {
                          setFormError('Complete Stripe Connect setup before enabling Stripe payments.');
                          return;
                        }
                        setFormError(null);
                        setForm((state) => ({ ...state, paymentMode: option.value, entryFee: option.value === 'FREE' ? '0' : state.entryFee }));
                      }}>
                        <Text style={styles.optionIcon}>{option.icon}</Text>
                        <Text style={styles.optionTitle}>{option.label}</Text>
                        <Text style={styles.optionDescCentered}>{option.desc}</Text>
                        {option.value === 'STRIPE' && !stripeReady ? <Text style={styles.optionWarn}>Connect Stripe first</Text> : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                  {form.paymentMode === 'STRIPE' ? <Text style={[styles.fieldHelp, stripeReady ? styles.goodHelp : styles.warnHelp]}>{stripeReady ? 'Stripe is ready. Participant payments will route to your connected club account.' : 'Stripe is not ready yet. Complete onboarding and enable charges/payouts.'}</Text> : null}
                  {form.paymentMode === 'MANUAL' ? (
                    <View style={styles.subPanel}>
                      <Text style={styles.fieldHelp}>Players join for free. You confirm payment manually in the Participants panel.</Text>
                      <Text style={styles.fieldLabelSmall}>Manual Payment Policy</Text>
                      <View style={styles.optionGrid}>
                        {([
                          { value: 'STRICT', label: 'Strict', desc: 'Unpaid cannot pick and are removed at lock.' },
                          { value: 'LENIENT', label: 'Lenient', desc: 'Allow picks while still awaiting payment.' },
                        ] as const).map((option) => (
                          <TouchableOpacity key={option.value} style={[styles.optionCard, form.manualPaymentPolicy === option.value ? styles.optionCardActive : null]} onPress={() => setForm((state) => ({ ...state, manualPaymentPolicy: option.value }))}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.optionTitle}>{option.label}</Text>
                              <Text style={styles.optionDesc}>{option.desc}</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </View>

                {form.paymentMode !== 'FREE' ? (
                  <View style={styles.modalSection}>
                    <Text style={styles.fieldLabel}>Entry Fee (€)</Text>
                    <TextInput value={form.entryFee} onChangeText={(v) => setForm((state) => ({ ...state, entryFee: v }))} placeholder="0" keyboardType="numeric" placeholderTextColor={colors.textMuted} style={styles.modalInput} />
                    <View style={styles.presetRow}>{[5, 10, 20, 50].map((value) => <TouchableOpacity key={value} style={[styles.presetBtn, form.entryFee === String(value) ? styles.presetBtnActive : null]} onPress={() => setForm((state) => ({ ...state, entryFee: String(value) }))}><Text style={[styles.presetText, form.entryFee === String(value) ? styles.presetTextActive : null]}>€{value}</Text></TouchableOpacity>)}</View>
                  </View>
                ) : null}

                <View style={styles.modalSection}>
                  <Text style={styles.fieldLabel}>Prize Pool (€) <Text style={styles.optionalText}>optional</Text></Text>
                  <TextInput value={form.prizePool} onChangeText={(v) => setForm((state) => ({ ...state, prizePool: v }))} placeholder="e.g. 200" keyboardType="numeric" placeholderTextColor={colors.textMuted} style={styles.modalInput} />
                  <View style={styles.presetRow}>{[50, 100, 200, 500].map((value) => <TouchableOpacity key={value} style={[styles.presetBtn, form.prizePool === String(value) ? styles.presetBtnActive : null]} onPress={() => setForm((state) => ({ ...state, prizePool: String(value) }))}><Text style={[styles.presetText, form.prizePool === String(value) ? styles.presetTextActive : null]}>€{value}</Text></TouchableOpacity>)}</View>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.fieldLabel}>Fixture Source</Text>
                  <View style={styles.optionGrid}>
                    {([
                      { value: 'PL', label: 'Premier League', desc: 'Use Premier League fixture weeks.' },
                      { value: 'WC', label: 'World Cup', desc: 'Use World Cup fixtures with balanced gameweeks.' },
                    ] as const).map((option) => (
                      <TouchableOpacity key={option.value} style={[styles.optionCard, form.fixtureCompetitionCode === option.value ? styles.optionCardActive : null]} onPress={() => setForm((state) => ({ ...state, fixtureCompetitionCode: option.value }))}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.optionTitle}>{option.label}</Text>
                          <Text style={styles.optionDesc}>{option.desc}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.fieldLabel}>Rules</Text>
                  <Text style={styles.fieldLabelSmall}>Max entries per user</Text>
                  <TextInput value={form.maxEntriesPerUser} onChangeText={(v) => setForm((state) => ({ ...state, maxEntriesPerUser: v }))} placeholder="1" keyboardType="numeric" placeholderTextColor={colors.textMuted} style={styles.modalInput} />
                  <Text style={styles.fieldHelp}>Controls how many separate entries the same player can have in this competition.</Text>
                  <TouchableOpacity style={styles.checkboxRow} onPress={() => setForm((state) => ({ ...state, lifelineEnabled: !state.lifelineEnabled }))}>
                    <View style={[styles.checkboxBox, form.lifelineEnabled ? styles.checkboxBoxChecked : null]}>
                      {form.lifelineEnabled ? <Text style={styles.checkboxTick}>✓</Text> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionTitle}>Enable lifeline</Text>
                      <Text style={styles.optionDesc}>Allow each entry to use one lifeline before a gameweek starts.</Text>
                    </View>
                  </TouchableOpacity>
                  <Text style={styles.fieldLabelSmall}>Missed Pick Rule</Text>
                  <View style={styles.optionGrid}>
                    {([
                      { value: 'ELIMINATE', label: 'Eliminate', desc: 'No pick means the entry is out.' },
                      { value: 'ALLOW', label: 'Allow', desc: 'Keep the entry pending when no pick is made.' },
                    ] as const).map((option) => (
                      <TouchableOpacity key={option.value} style={[styles.optionCard, form.missedPickMode === option.value ? styles.optionCardActive : null]} onPress={() => setForm((state) => ({ ...state, missedPickMode: option.value }))}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.optionTitle}>{option.label}</Text>
                          <Text style={styles.optionDesc}>{option.desc}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity style={[styles.optionCard, form.postponedConsumesTeam ? styles.optionCardActive : null]} onPress={() => setForm((state) => ({ ...state, postponedConsumesTeam: !state.postponedConsumesTeam }))}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionTitle}>Postponed fixtures consume team</Text>
                      <Text style={styles.optionDesc}>{form.postponedConsumesTeam ? 'Enabled' : 'Disabled'}</Text>
                    </View>
                  </TouchableOpacity>
                </View>

                {formError ? <Text style={styles.error}>{formError}</Text> : null}
                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.modalCancelButton} onPress={closeCompetitionModal}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalSaveButton} onPress={saveCompetition} disabled={saveCompetitionMutation.isPending}>
                    <Text style={styles.modalSaveText}>{saveCompetitionMutation.isPending ? 'Saving...' : formMode === 'create' ? 'Create Competition' : 'Save Changes'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}



function normalizeHexInput(value: string) {
  const cleaned = value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
  return cleaned ? `#${cleaned}` : '';
}

function hexToRgb(hex: string) {
  const valid = HEX_COLOR_PATTERN.test(hex) ? hex : '#000000';
  return {
    r: parseInt(valid.slice(1, 3), 16),
    g: parseInt(valid.slice(3, 5), 16),
    b: parseInt(valid.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  const toHex = (value: number) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function ColorSlider({ label, value, tint, onChange }: { label: string; value: number; tint: string; onChange: (value: number) => void }) {
  return (
    <View style={styles.colorSliderRow}>
      <Text style={styles.colorSliderLabel}>{label}</Text>
      <Slider
        style={styles.colorSlider}
        minimumValue={0}
        maximumValue={255}
        step={1}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor={tint}
        maximumTrackTintColor="#334155"
        thumbTintColor={tint}
      />
      <Text style={styles.colorSliderValue}>{Math.round(value)}</Text>
    </View>
  );
}

function BrandColorPicker({ label, optional, value, fallback, onChange }: { label: string; optional?: boolean; value: string; fallback: string; onChange: (value: string) => void }) {
  const activeColor = HEX_COLOR_PATTERN.test(value) ? value : fallback;
  const rgb = hexToRgb(activeColor);
  const updateRgb = (channel: 'r' | 'g' | 'b', next: number) => {
    onChange(rgbToHex(channel === 'r' ? next : rgb.r, channel === 'g' ? next : rgb.g, channel === 'b' ? next : rgb.b));
  };

  return (
    <View style={styles.colorPickerBlock}>
      <View style={styles.colorPickerHeader}>
        <Text style={styles.fieldLabel}>{label} {optional ? <Text style={styles.optionalText}>(optional)</Text> : null}</Text>
        {value ? <TouchableOpacity onPress={() => onChange('')}><Text style={styles.removeTiny}>Clear</Text></TouchableOpacity> : null}
      </View>
      <View style={styles.colorMixerPreviewRow}>
        <View style={[styles.colorMixerPreview, { backgroundColor: activeColor }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.colorPickerValue}>{value || fallback}</Text>
          <Text style={styles.colorPickerHint}>Mix with sliders or enter a hex value.</Text>
        </View>
      </View>
      <ColorSlider label="R" value={rgb.r} tint="#ef4444" onChange={(next) => updateRgb('r', next)} />
      <ColorSlider label="G" value={rgb.g} tint="#22c55e" onChange={(next) => updateRgb('g', next)} />
      <ColorSlider label="B" value={rgb.b} tint="#3b82f6" onChange={(next) => updateRgb('b', next)} />
      <View style={styles.colorSwatchGrid}>
        {BRAND_COLOR_PRESETS.map((preset) => {
          const selected = activeColor.toLowerCase() === preset.toLowerCase();
          return (
            <TouchableOpacity key={`${label}-${preset}`} onPress={() => onChange(preset)} style={[styles.colorSwatchButton, selected ? styles.colorSwatchButtonActive : null]}>
              <View style={[styles.colorSwatch, { backgroundColor: preset }]} />
            </TouchableOpacity>
          );
        })}
      </View>
      <TextInput
        value={value}
        onChangeText={(next) => onChange(normalizeHexInput(next))}
        placeholder={fallback}
        placeholderTextColor={colors.textMuted}
        maxLength={7}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, styles.colorTextInput]}
      />
    </View>
  );
}

function ColorDot({ color }: { color: string }) {
  return <View style={[styles.colorDot, { backgroundColor: color }]} />;
}

function ColorPreview({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.colorPreviewPill}>
      <ColorDot color={color} />
      <Text style={styles.colorPreviewText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingBottom: spacing.screen, paddingTop: 8 },
  hero: { borderWidth: 1, borderColor: '#334155', borderRadius: 24, backgroundColor: '#0b1220', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  metricRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  metric: { flex: 1, borderWidth: 1, borderColor: '#334155', borderRadius: 12, backgroundColor: '#111827', paddingVertical: 10, alignItems: 'center' },
  metricValue: { color: colors.text, fontWeight: '900', fontSize: 15 },
  metricLabel: { color: colors.textMuted, fontSize: 10, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.7 },
  heroEyebrow: { color: '#7dd3fc', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.0, marginBottom: 6 },
  heroCreateBtn: { marginTop: 12, borderWidth: 1, borderColor: '#0ea5e966', backgroundColor: '#0ea5e930', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  heroCreateBtnText: { color: '#bae6fd', fontSize: 12, fontWeight: '900', letterSpacing: 0.3 },
  heroAdminLine: { color: '#94a3b8', fontSize: 11, marginTop: 4, letterSpacing: 0.4 },
  collapseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#26354d', backgroundColor: '#0b1324', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12, gap: 12 },
  collapseHeaderText: { flex: 1, minWidth: 0 },
  collapseIconBox: { width: 32, height: 32, borderRadius: 11, borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  collapseIconBoxOpen: { borderColor: '#0ea5e966', backgroundColor: '#0ea5e922' },
  collapseIcon: { color: '#bae6fd', fontSize: 10, fontWeight: '900' },
  rowInline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexShrink: 1, maxWidth: 126 },
  stripeHeaderTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  stripeHeaderStatusRow: { flexDirection: 'row', marginTop: 8 },
  stripeSummaryPill: { alignSelf: 'flex-start', maxWidth: '100%', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  stripeSummaryPillReady: { borderColor: '#22c55e55', backgroundColor: '#22c55e22' },
  stripeSummaryPillWarn: { borderColor: '#f59e0b55', backgroundColor: '#f59e0b22' },
  stripeSummaryText: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.4 },
  stripeSummaryTextReady: { color: '#86efac' },
  stripeSummaryTextWarn: { color: '#fcd34d' },
  stripeBody: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 12 },
  stripeInfoBox: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#0b1220', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  stripeInfoLabel: { color: '#94a3b8', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.7 },
  stripeInfoValue: { color: '#e2e8f0', fontSize: 12, fontWeight: '700', marginTop: 3 },
  stripeStatusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stripeChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  stripeChipGood: { borderColor: '#22c55e55', backgroundColor: '#22c55e22' },
  stripeChipWarn: { borderColor: '#f59e0b55', backgroundColor: '#f59e0b22' },
  stripeChipText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  webCardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  webSectionTitle: { color: '#e5e7eb', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 },
  webSectionSub: { color: '#94a3b8', fontSize: 12, lineHeight: 18, marginTop: 5 },
  webGhostButton: { borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 8, alignItems: 'center' },
  webGhostButtonText: { color: '#d1d5db', fontSize: 11, fontWeight: '800' },
  webBluePanel: { borderWidth: 1, borderColor: '#0ea5e94d', backgroundColor: '#0ea5e90d', borderRadius: 12, padding: 12, marginTop: 12, gap: 8 },
  webHelpText: { color: '#94a3b8', fontSize: 12, lineHeight: 18 },
  adminResultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#374151', backgroundColor: '#1f293780', borderRadius: 10, padding: 10 },
  adminResultName: { color: '#f3f4f6', fontSize: 13, fontWeight: '800' },
  adminResultEmail: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  assignBtn: { backgroundColor: '#0ea5e922', borderWidth: 1, borderColor: '#0ea5e955', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  assignBtnText: { color: '#7dd3fc', fontSize: 11, fontWeight: '900' },
  brandPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 12, padding: 12, marginTop: 12 },
  brandLogoPreview: { width: 42, height: 42, borderRadius: 999, borderWidth: 1, borderColor: '#ffffff33' },
  brandColorWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1 },
  colorPreviewPill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  colorPreviewText: { color: '#d1d5db', fontSize: 11, fontWeight: '700' },
  colorDot: { width: 18, height: 18, borderRadius: 999, borderWidth: 1, borderColor: '#ffffff33' },
  colorPickerBlock: { borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#0f172a99', borderRadius: 12, padding: 10, gap: 8 },
  colorPickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  colorPickerSelectedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  colorMixerPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  colorMixerPreview: { width: 54, height: 54, borderRadius: 16, borderWidth: 1, borderColor: '#ffffff33' },
  colorPickerValue: { color: '#e5e7eb', fontSize: 13, fontWeight: '900', fontFamily: 'monospace' },
  colorPickerHint: { color: '#94a3b8', fontSize: 11, marginTop: 3 },
  colorSliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  colorSliderLabel: { width: 16, color: '#cbd5e1', fontSize: 12, fontWeight: '900' },
  colorSlider: { flex: 1, height: 34 },
  colorSliderValue: { width: 32, color: '#94a3b8', fontSize: 11, fontWeight: '800', textAlign: 'right' },
  colorSwatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  colorSwatchButton: { width: 34, height: 34, borderRadius: 12, borderWidth: 1, borderColor: '#ffffff1a', alignItems: 'center', justifyContent: 'center', backgroundColor: '#111827' },
  colorSwatchButtonActive: { borderColor: '#7dd3fc', backgroundColor: '#0ea5e922' },
  colorSwatch: { width: 24, height: 24, borderRadius: 999, borderWidth: 1, borderColor: '#ffffff33' },
  colorTextInput: { marginBottom: 0, fontFamily: 'monospace' },
  removeTiny: { color: '#94a3b8', fontSize: 12, fontWeight: '900', paddingHorizontal: 5 },
  logoPickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  logoPickerActions: { flex: 1, gap: 7 },
  logoPickerBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e922', borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8 },
  logoPickerBtnText: { color: '#7dd3fc', fontSize: 12, fontWeight: '900' },
  emptyLogoPreview: { width: 48, height: 48, borderRadius: 999, borderWidth: 1, borderColor: '#ffffff26', backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' },
  emptyLogoText: { color: '#64748b', fontSize: 10, fontWeight: '900' },
  logoInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoTextInput: { flex: 1, marginBottom: 0 },
  removeLogoText: { color: '#94a3b8', fontSize: 11, fontWeight: '800' },

  editCompBtn: { borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e922' },
  editCompBtnText: { color: '#7dd3fc', fontSize: 12, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: '#020617cc', justifyContent: 'flex-start', paddingHorizontal: 12, paddingTop: 34, paddingBottom: 16 },
  modalCard: { maxHeight: '94%', borderWidth: 1, borderColor: '#334155', backgroundColor: '#0b1220', borderRadius: 24, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10 },
  closeText: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  modalBody: { paddingBottom: 18, paddingTop: 2 },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  modalTitle: { color: '#f8fafc', fontSize: 19, fontWeight: '900' },
  modalSubtitle: { color: '#94a3b8', fontSize: 12, lineHeight: 17, marginTop: 3 },
  modalCloseButton: { borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  modalCloseText: { color: '#cbd5e1', fontSize: 11, fontWeight: '900' },
  modalSection: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#ffffff05', borderRadius: 16, padding: 11, marginBottom: 10 },
  fieldLabel: { color: '#cbd5e1', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 7 },
  fieldLabelSmall: { color: '#94a3b8', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 8, marginBottom: 6 },
  fieldHelp: { color: '#64748b', fontSize: 11, lineHeight: 15, marginTop: 2 },
  goodHelp: { color: '#86efac' },
  warnHelp: { color: '#fcd34d' },
  optionalText: { color: '#64748b', fontWeight: '500' },
  modalInput: { backgroundColor: '#0f172a', color: colors.text, borderRadius: 12, borderWidth: 1, borderColor: '#334155', paddingHorizontal: 12, paddingVertical: 12, marginBottom: 9, fontSize: 13 },
  modalTextarea: { minHeight: 72, textAlignVertical: 'top' },
  inputError: { borderColor: '#ef4444', backgroundColor: '#ef444414' },
  fieldErrorText: { color: '#fca5a5', fontSize: 11, fontWeight: '700', marginTop: -4, marginBottom: 8 },
  datePickerButton: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  datePickerValue: { color: colors.text, fontSize: 13, fontWeight: '700' },
  datePickerPlaceholder: { color: colors.textMuted, fontSize: 13 },
  datePickerIcon: { fontSize: 16 },
  optionGrid: { gap: 8 },
  optionCard: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', borderRadius: 12, padding: 11, flexDirection: 'row', gap: 9, alignItems: 'center' },
  paymentOptionCard: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', borderRadius: 12, padding: 11, alignItems: 'center', gap: 5 },
  optionCardActive: { borderColor: '#0ea5e980', backgroundColor: '#0ea5e922' },
  optionCardDisabled: { opacity: 0.65 },
  optionIcon: { color: '#7dd3fc', fontSize: 22, fontWeight: '900', minWidth: 28 },
  optionTitle: { color: '#f8fafc', fontSize: 12, fontWeight: '900' },
  optionDesc: { color: '#94a3b8', fontSize: 11, lineHeight: 15, marginTop: 2 },
  optionDescCentered: { color: '#94a3b8', fontSize: 10, lineHeight: 14, textAlign: 'center' },
  optionWarn: { color: '#fcd34d', fontSize: 11, marginTop: 3 },
  subPanel: { borderWidth: 1, borderColor: '#f59e0b33', backgroundColor: '#f59e0b12', borderRadius: 12, padding: 10, marginTop: 9 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 2 },
  presetBtn: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6 },
  presetBtnActive: { borderColor: '#0ea5e980', backgroundColor: '#0ea5e922' },
  presetText: { color: '#cbd5e1', fontSize: 11, fontWeight: '700' },
  presetTextActive: { color: '#bae6fd' },
  toggleBox: { flex: 1, borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 10, justifyContent: 'center' },
  checkboxRow: { marginTop: 8, borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', borderRadius: 12, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkboxBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: '#475569', backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' },
  checkboxBoxChecked: { borderColor: '#0ea5e9', backgroundColor: '#0ea5e933' },
  checkboxTick: { color: '#bae6fd', fontSize: 14, fontWeight: '900' },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  modalCancelButton: { flex: 1, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  modalCancelText: { color: '#cbd5e1', fontSize: 12, fontWeight: '900' },
  modalSaveButton: { flex: 1.4, borderWidth: 1, borderColor: '#0ea5e966', backgroundColor: '#0ea5e930', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  modalSaveText: { color: '#bae6fd', fontSize: 12, fontWeight: '900' },
    setupList: { marginTop: 10, gap: 8 },
  setupRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setupRowDone: { borderWidth: 1, borderColor: '#22c55e44', backgroundColor: '#22c55e1c', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  setupRowTodo: { borderWidth: 1, borderColor: '#f59e0b44', backgroundColor: '#f59e0b1a', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  setupIcon: { width: 14, fontSize: 12, fontWeight: '700' },
  setupIconDone: { color: '#86efac' },
  setupIconTodo: { color: '#94a3b8' },
  setupText: { color: '#cbd5e1', fontSize: 12 },
  setupTextDone: { color: '#f8fafc' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  ghostBtn: { borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e922', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 },
  ghostBtnText: { color: '#7dd3fc', fontWeight: '700', fontSize: 12 },
  input: { backgroundColor: colors.panelSoft, color: colors.text, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  twoCol: { flexDirection: 'row', gap: 8 },
  inputHalf: { flex: 1 },
  chipWrap: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  error: { color: '#fca5a5', marginBottom: 6 },
  feedbackBox: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  feedbackSuccess: { borderColor: '#22c55e55', backgroundColor: '#22c55e22' },
  feedbackError: { borderColor: '#ef444455', backgroundColor: '#ef444422' },
  feedbackInfo: { borderColor: '#0ea5e955', backgroundColor: '#0ea5e922' },
  feedbackText: { color: '#e2e8f0', fontSize: 12, fontWeight: '600' },
  compBlock: { marginBottom: 12 },
  webCompetitionCard: { borderWidth: 1, borderColor: '#253247', borderRadius: 18, backgroundColor: '#111827', padding: 14 },
  webCompetitionCardActive: { borderColor: '#0ea5e966', backgroundColor: '#0ea5e914' },
  webCompetitionTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  webCompetitionTitleBlock: { flex: 1, minWidth: 0 },
  webBadgeTitleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  webCompetitionName: { color: '#f3f4f6', fontSize: 20, lineHeight: 25, fontWeight: '900', marginBottom: 8 },
  webCompetitionMetaRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 },
  webCompetitionMeta: { color: '#9ca3af', fontSize: 13, fontWeight: '800' },
  webCompetitionFee: { color: '#38bdf8', fontSize: 14, fontWeight: '900' },
  inviteCodeBox: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12, borderWidth: 1, borderColor: '#0ea5e944', backgroundColor: '#0ea5e914', borderRadius: 11, paddingHorizontal: 11, paddingVertical: 8 },
  inviteCodeLabel: { color: '#7dd3fc', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  inviteCodeValue: { overflow: 'hidden', backgroundColor: '#0ea5e91f', color: '#fff', fontSize: 13, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1.5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  publicCodeBox: { alignSelf: 'flex-start', marginTop: 12, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 11, paddingHorizontal: 11, paddingVertical: 8 },
  publicCodeText: { color: '#d1d5db', fontSize: 13, fontWeight: '800' },
  webCompetitionActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, alignItems: 'center' },
  webActionBtn: { alignSelf: 'flex-start', minHeight: 34, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  copyInviteBtn: { backgroundColor: '#0ea5e926' },
  copyInviteText: { color: '#7dd3fc', fontSize: 12, fontWeight: '900' },
  viewCompBtn: { borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08' },
  viewCompBtnText: { color: '#d1d5db', fontSize: 12, fontWeight: '900' },
  competitionCard: { borderWidth: 1, borderColor: '#253247', borderRadius: 12, backgroundColor: '#1f2937', padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  competitionCardActive: { borderColor: '#0ea5e9', backgroundColor: '#0ea5e914' },
  competitionName: { color: colors.text, fontWeight: '700', marginBottom: 2 },
  dropdownBtn: { marginTop: 6, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  compActionRow: { marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dropdownBtnInline: { borderWidth: 1, borderColor: '#26354d', backgroundColor: '#0b1324', borderRadius: 12 },
  deleteCompBtn: { borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#ef444422' },
  deleteCompBtnText: { color: '#f87171', fontSize: 12, fontWeight: '900' },
  dropdownBtnText: { color: '#bae6fd', fontWeight: '900', fontSize: 12 },
  panel: { marginTop: 8, borderWidth: 1, borderColor: '#253247', borderRadius: 12, backgroundColor: '#0f172a', padding: 12 },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tabBtn: { flex: 1, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  tabBtnActive: { borderColor: '#0ea5e980', backgroundColor: '#0ea5e922' },
  tabBtnText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  tabBtnTextActive: { color: '#7dd3fc' },
  payOps: { marginBottom: 10 },
  exportLink: { color: '#7dd3fc', textDecorationLine: 'underline', fontSize: 12, marginTop: 6 },
  secondaryBtn: { borderWidth: 1, borderColor: '#ffffff2a', backgroundColor: '#ffffff12', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 10, alignItems: 'center', marginBottom: 8 },
  secondaryBtnText: { color: '#e2e8f0', fontWeight: '700', fontSize: 11 },
  addPanel: { borderWidth: 1, borderColor: '#253247', borderRadius: 10, backgroundColor: '#111827', padding: 8, marginBottom: 8 },
  userResultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: '#253247', paddingVertical: 8 },
  userResultName: { color: '#e2e8f0', fontWeight: '700', fontSize: 12 },
  userResultEmail: { color: '#94a3b8', fontSize: 11 },
  addGuestTitle: { color: '#cbd5e1', fontWeight: '700', fontSize: 12, marginTop: 8, marginBottom: 6 },
  paymentColumns: { gap: 8, marginTop: 8 },
  awaitingBox: { borderWidth: 1, borderColor: '#f59e0b40', backgroundColor: '#f59e0b10', borderRadius: 10, padding: 8 },
  paidBox: { borderWidth: 1, borderColor: '#22c55e40', backgroundColor: '#22c55e10', borderRadius: 10, padding: 8 },
  paymentBoxHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  paymentHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  awaitingTitle: { color: '#fcd34d', fontWeight: '800', fontSize: 11, textTransform: 'uppercase' },
  paidTitle: { color: '#86efac', fontWeight: '800', fontSize: 11, textTransform: 'uppercase' },
  awaitingCount: { color: '#fcd34d', fontSize: 12, fontWeight: '700' },
  paidCount: { color: '#86efac', fontSize: 12, fontWeight: '700' },
  collapseBtn: { borderWidth: 1, borderColor: '#ffffff25', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  collapseBtnText: { color: '#cbd5e1', fontSize: 10, fontWeight: '700' },
  paymentList: { gap: 6 },
  paymentRowAwait: { borderWidth: 1, borderColor: '#f59e0b33', backgroundColor: '#00000026', borderRadius: 8, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  paymentRowPaid: { borderWidth: 1, borderColor: '#22c55e33', backgroundColor: '#00000026', borderRadius: 8, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  paymentNameAwait: { color: '#fef3c7', fontWeight: '700', fontSize: 12 },
  paymentNamePaid: { color: '#dcfce7', fontWeight: '700', fontSize: 12 },
  paymentSubAwait: { color: '#fde68a', fontSize: 11, marginTop: 2 },
  paymentSubPaid: { color: '#bbf7d0', fontSize: 11, marginTop: 2 },
  participantCard: { borderWidth: 1, borderColor: '#253247', borderRadius: 8, backgroundColor: '#111827', padding: 9, marginBottom: 7 },
  participantHeaderRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  participantName: { color: colors.text, fontWeight: '700', marginBottom: 4 },
  inlineMeta: { flexDirection: 'row', gap: 6, marginBottom: 4, flexWrap: 'wrap' },
  participantQuickActions: { alignItems: 'flex-end', gap: 6 },
  detailsBtn: { borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  detailsBtnText: { color: '#cbd5e1', fontSize: 11, fontWeight: '700' },
  expandedPanel: { borderTopWidth: 1, borderTopColor: '#253247', marginTop: 8, paddingTop: 8 },
  actionRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actionBtnDisabled: { opacity: 0.55 },
  winBtn: { backgroundColor: '#22c55e22', borderWidth: 1, borderColor: '#22c55e55', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center' },
  winBtnText: { color: '#86efac', fontWeight: '700', fontSize: 11 },
  payBtn: { backgroundColor: colors.brand, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center' },
  payBtnCompact: { backgroundColor: colors.brand, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center', minWidth: 82 },
  payBtnText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  warnBtn: { backgroundColor: '#f59e0b22', borderWidth: 1, borderColor: '#f59e0b55', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center' },
  warnBtnCompact: { backgroundColor: '#f59e0b22', borderWidth: 1, borderColor: '#f59e0b55', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center', minWidth: 82 },
  warnBtnText: { color: '#fcd34d', fontWeight: '700', fontSize: 11 },
  removeBtn: { backgroundColor: '#ef444422', borderWidth: 1, borderColor: '#ef444455', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center' },
  removeBtnText: { color: '#fca5a5', fontWeight: '700', fontSize: 11 },
  mobileToolbar: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  mobileToolbarBtn: { flex: 1, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  mobileToolbarBtnActive: { borderColor: '#0ea5e980', backgroundColor: '#0ea5e922' },
  mobileToolbarBtnText: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  mobileToolbarBtnTextActive: { color: '#7dd3fc' },
  mobileActionsBox: { borderWidth: 1, borderColor: '#253247', borderRadius: 10, backgroundColor: '#111827', padding: 8, marginBottom: 8 },
  participantsHeaderRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  participantsHeaderTitle: { color: '#94a3b8', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 },
  awaitingInline: { color: '#fcd34d', fontSize: 11 },
  manualHintBox: { borderWidth: 1, borderColor: '#f59e0b33', backgroundColor: '#f59e0b14', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  manualHintText: { color: '#fde68a', fontSize: 11, fontWeight: '600' },
  participantToolbar: { borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#111827', borderRadius: 10, padding: 8, marginBottom: 8, gap: 8 },
  participantToolbarTop: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  toolbarSearchInput: { backgroundColor: '#0f172a', color: colors.text, borderRadius: 8, borderWidth: 1, borderColor: '#334155', paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, fontSize: 12 },
  toolbarSearchInputCompact: { flex: 1, backgroundColor: '#0f172a', color: colors.text, borderRadius: 8, borderWidth: 1, borderColor: '#334155', paddingHorizontal: 10, paddingVertical: 8, fontSize: 12 },
  toolbarSmallBtn: { borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9 },
  toolbarSmallBtnActive: { borderColor: '#0ea5e980', backgroundColor: '#0ea5e922' },
  toolbarSmallBtnText: { color: '#cbd5e1', fontSize: 11, fontWeight: '800' },
  toolbarSmallBtnTextActive: { color: '#7dd3fc' },
  toolbarLabel: { color: '#64748b', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 },
  compactChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  filtersDrawer: { borderTopWidth: 1, borderTopColor: '#253247', paddingTop: 8 },
  toolbarActionGrid: { flexDirection: 'row', gap: 8, marginTop: 2 },
  toolbarActionBtn: { flex: 1, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  toolbarActionText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  clearFilterBtn: { borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e91f', borderRadius: 8, paddingVertical: 7, alignItems: 'center', marginTop: 8 },
  activeFilterBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#253247', paddingTop: 8 },
  activeFilterText: { color: '#94a3b8', fontSize: 11, fontWeight: '700' },
  clearFilterText: { color: '#7dd3fc', fontSize: 11, fontWeight: '800' },
  paginationRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pageBtn: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#1f2937', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  pageBtnText: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  pageInfo: { color: '#94a3b8', fontSize: 12 },
  confirmBackdrop: { flex: 1, backgroundColor: '#020617dd', paddingHorizontal: 16, justifyContent: 'center' },
  confirmCard: { borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#0b1220', borderRadius: 22, padding: 16, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 22, elevation: 10 },
  confirmIconWrap: { width: 38, height: 38, borderRadius: 999, backgroundColor: '#ef444422', borderWidth: 1, borderColor: '#ef444455', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  confirmIcon: { color: '#fca5a5', fontWeight: '900', fontSize: 20 },
  confirmTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '900' },
  confirmMessage: { color: '#cbd5e1', fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: 8 },
  confirmItemRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  confirmBullet: { color: '#fca5a5', fontSize: 13, fontWeight: '900' },
  confirmItemText: { color: '#94a3b8', flex: 1, fontSize: 12, lineHeight: 17 },
  confirmActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  confirmCancelButton: { flex: 1, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  confirmCancelText: { color: '#cbd5e1', fontWeight: '900', fontSize: 12 },
  confirmDeleteButton: { flex: 1.3, borderWidth: 1, borderColor: '#ef444466', backgroundColor: '#ef444426', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  confirmDeleteText: { color: '#fca5a5', fontWeight: '900', fontSize: 12 },
});
