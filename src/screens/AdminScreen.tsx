import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { Card, FilterPill, MetaText, PrimaryButton, ScreenTitle, SectionTitle, StatusPill } from '../components/ui';
import { colors, spacing } from '../theme/tokens';
import type { Competition, Club, Participant } from '../types';

type AdminTab = 'competitions' | 'clubs' | 'users' | 'sync' | 'simulate' | 'testdata' | 'audit';
type CompetitionStatusFilter = 'ALL' | 'UPCOMING' | 'ACTIVE' | 'COMPLETED';
type UserRoleFilter = 'ALL' | 'USER' | 'CLUB_ADMIN' | 'ADMIN';
const USER_PAGE_SIZE = 25;

type AdminUser = {
  id: number;
  email: string;
  username: string;
  role: 'USER' | 'CLUB_ADMIN' | 'ADMIN';
  disabled?: boolean;
  createdAt?: string;
};

type AdminFixture = {
  id: number;
  homeTeamName: string;
  homeTeamShortName: string;
  awayTeamName: string;
  awayTeamShortName: string;
  kickoffAt: string | number[];
  status: string;
  scoreHome: number | null;
  scoreAway: number | null;
  hasOverride?: boolean;
};
type Gameweek = { id: number; weekNumber: number; status: string; lockAt?: string | number[]; startsAt?: string | number[]; fixtures?: AdminFixture[] };
type FixtureResultDraft = { status: string; scoreHome: string; scoreAway: string };
function existingFixtureDrafts(gameweek?: Gameweek | null): Record<number, FixtureResultDraft> {
  if (!gameweek || gameweek.status !== 'COMPLETED') return {};
  return Object.fromEntries((gameweek.fixtures ?? []).map((fixture) => [fixture.id, {
    status: fixture.status || 'FINISHED',
    scoreHome: fixture.scoreHome == null ? '' : String(fixture.scoreHome),
    scoreAway: fixture.scoreAway == null ? '' : String(fixture.scoreAway),
  }]));
}
type AuditLog = { id?: number; username?: string | null; entityType?: string; entityId?: number | null; fieldName?: string | null; oldValue?: string | null; newValue?: string | null; action?: string; createdAt?: string | number[] | null };
type OpStatus = { tone: 'success' | 'error' | 'info'; message: string } | null;
type CompetitionFormErrors = { name?: string; startDate?: string };
type OpStatusTone = 'success' | 'error' | 'info';
type ClubFormErrors = { name?: string };
type UserFormErrors = { email?: string; username?: string; password?: string };
type PageResponse<T> = { content: T[]; totalElements: number; totalPages: number; number: number; size: number };
type ConfirmDialogState = {
  title: string;
  message: string;
  items?: string[];
  confirmText: string;
  onConfirm: () => void | Promise<unknown>;
} | null;

function getApiMessage(err: any, fallback: string) {
  return err?.response?.data?.message || err?.response?.data?.error || fallback;
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

function parseGameweekRangeInput(input: string): number[] {
  const weeks = new Set<number>();
  for (const rawPart of input.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      const [from, to] = start <= end ? [start, end] : [end, start];
      for (let week = from; week <= to; week += 1) weeks.add(week);
      continue;
    }
    const week = Number(part);
    if (Number.isInteger(week) && week > 0) weeks.add(week);
  }
  return Array.from(weeks).sort((a, b) => a - b);
}

function parseAdminDate(value?: string | number[] | null) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const [year, month, day, hour = 0, minute = 0, second = 0] = value;
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  }
  const date = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAdminDate(value?: string | number[] | null) {
  const date = parseAdminDate(value);
  return date ? date.toLocaleString() : 'No lock time';
}

function randomFixtureResult(): FixtureResultDraft {
  const roll = Math.random();
  let scoreHome: number;
  let scoreAway: number;
  if (roll < 0.45) {
    scoreHome = Math.floor(Math.random() * 4) + 1;
    scoreAway = Math.floor(Math.random() * scoreHome);
  } else if (roll < 0.70) {
    scoreAway = Math.floor(Math.random() * 4) + 1;
    scoreHome = Math.floor(Math.random() * scoreAway);
  } else {
    const goals = Math.floor(Math.random() * 4);
    scoreHome = goals;
    scoreAway = goals;
  }
  return { status: 'FINISHED', scoreHome: String(scoreHome), scoreAway: String(scoreAway) };
}

export default function AdminScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<AdminTab>('competitions');
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false);
  const [opStatus, setOpStatus] = useState<OpStatus>(null);
  const [competitionModalMode, setCompetitionModalMode] = useState<'create' | 'edit' | null>(null);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [competitionFormErrors, setCompetitionFormErrors] = useState<CompetitionFormErrors>({});

  const [compName, setCompName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [compSearch, setCompSearch] = useState('');
  const [compStatusFilter, setCompStatusFilter] = useState<CompetitionStatusFilter>('ALL');
  const [bulkPrefix, setBulkPrefix] = useState('Load Test');
  const [bulkCount, setBulkCount] = useState('10');
  const [bulkStartDate, setBulkStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [bulkDeletePrefix, setBulkDeletePrefix] = useState('Load Test');
  const [bulkDeleteUpcomingOnly, setBulkDeleteUpcomingOnly] = useState(true);

  const [editCompId, setEditCompId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEntryFee, setEditEntryFee] = useState('0');
  const [editPrizePool, setEditPrizePool] = useState('0');
  const [editMaxEntries, setEditMaxEntries] = useState('1');
  const [editStatus, setEditStatus] = useState<'UPCOMING' | 'ACTIVE' | 'COMPLETED'>('UPCOMING');
  const [editPaymentMode, setEditPaymentMode] = useState<'FREE' | 'MANUAL' | 'STRIPE'>('FREE');
  const [editVisibility, setEditVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [editLifelineEnabled, setEditLifelineEnabled] = useState(false);
  const [editFixtureCompetitionCode, setEditFixtureCompetitionCode] = useState<'PL' | 'WC'>('PL');
  const [editMissedPickMode, setEditMissedPickMode] = useState<'ELIMINATE' | 'ALLOW'>('ELIMINATE');
  const [editPostponedConsumesTeam, setEditPostponedConsumesTeam] = useState(true);
  const [editPassFeeToParticipant, setEditPassFeeToParticipant] = useState(false);
  const [editManualPaymentPolicy, setEditManualPaymentPolicy] = useState<'STRICT' | 'LENIENT'>('STRICT');

  const [clubName, setClubName] = useState('');
  const [clubDescription, setClubDescription] = useState('');
  const [clubFormErrors, setClubFormErrors] = useState<ClubFormErrors>({});
  const [clubAdminUserId, setClubAdminUserId] = useState('');
  const [clubAdminSearch, setClubAdminSearch] = useState('');
  const [assignAdminSearch, setAssignAdminSearch] = useState('');
  const [clubSearch, setClubSearch] = useState('');
  const [showClubModal, setShowClubModal] = useState(false);
  const [assigningClub, setAssigningClub] = useState<Club | null>(null);
  const [assignUserId, setAssignUserId] = useState('');

  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<'USER' | 'CLUB_ADMIN' | 'ADMIN'>('USER');
  const [showUserModal, setShowUserModal] = useState(false);
  const [userFormErrors, setUserFormErrors] = useState<UserFormErrors>({});
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<UserRoleFilter>('ALL');
  const [userVisibleCount, setUserVisibleCount] = useState(USER_PAGE_SIZE);

  const [selectedCompId, setSelectedCompId] = useState<number | null>(null);
  const [managingAdminCompetitionId, setManagingAdminCompetitionId] = useState<number | null>(null);
  const [selectedGwId, setSelectedGwId] = useState<number | null>(null);
  const [simulateCompetitionDropdownOpen, setSimulateCompetitionDropdownOpen] = useState(false);
  const [simulateGameweekDropdownOpen, setSimulateGameweekDropdownOpen] = useState(false);
  const [testDataCompetitionId, setTestDataCompetitionId] = useState<number | null>(null);
  const [testDataCompetitionDropdownOpen, setTestDataCompetitionDropdownOpen] = useState(false);
  const [testDataUserCount, setTestDataUserCount] = useState('100');
  const [testDataGameweeks, setTestDataGameweeks] = useState('3-6');
  const [fixtureResults, setFixtureResults] = useState<Record<number, FixtureResultDraft>>({});
  const [skipAutoComplete, setSkipAutoComplete] = useState(false);
  const [simulateDensity, setSimulateDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [auditEntityFilter, setAuditEntityFilter] = useState('all');
  const [auditAdminFilter, setAuditAdminFilter] = useState('all');
  const [auditFieldFilter, setAuditFieldFilter] = useState('all');
  const [auditDropdownOpen, setAuditDropdownOpen] = useState<'action' | 'entity' | 'admin' | 'field' | null>(null);
  const [auditEntityIdFilter, setAuditEntityIdFilter] = useState('');
  const [auditDateFrom, setAuditDateFrom] = useState('');
  const [auditDateTo, setAuditDateTo] = useState('');
  const [auditPageSize, setAuditPageSize] = useState(50);
  const [auditPage, setAuditPage] = useState(0);
  const [auditDensity, setAuditDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

  const adminTabs: { key: AdminTab; label: string }[] = [
    { key: 'competitions', label: 'Competitions' },
    { key: 'clubs', label: 'Clubs' },
    { key: 'users', label: 'Users' },
    { key: 'sync', label: 'Fixture Sync' },
    { key: 'simulate', label: 'Simulate Results' },
    { key: 'testdata', label: 'Test Data' },
    { key: 'audit', label: 'Audit Log' },
  ];
  const selectedAdminTab = adminTabs.find((item) => item.key === tab) ?? adminTabs[0];

  const competitionsQuery = useQuery({
    queryKey: ['admin', 'competitions'],
    queryFn: async () => (await api.get<Competition[]>('/admin/competitions')).data,
    enabled: isAdmin,
  });

  const clubsQuery = useQuery({
    queryKey: ['admin', 'clubs'],
    queryFn: async () => (await api.get<Club[]>('/admin/clubs')).data,
    enabled: isAdmin,
  });

  const usersQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await api.get<AdminUser[]>('/admin/users')).data,
    enabled: isAdmin && (tab === 'clubs' || showClubModal || assigningClub !== null),
  });

  const pagedUsersQuery = useQuery({
    queryKey: ['admin', 'users', 'page', userSearch, userRoleFilter, userVisibleCount],
    queryFn: async () => (await api.get<PageResponse<AdminUser>>('/admin/users/page', {
      params: {
        page: 0,
        size: userVisibleCount,
        q: userSearch.trim() || undefined,
        role: userRoleFilter === 'ALL' ? undefined : userRoleFilter,
      },
    })).data,
    enabled: isAdmin && tab === 'users',
    placeholderData: (previous) => previous,
  });

  const gameweeksQuery = useQuery({
    queryKey: ['admin', 'gameweeks', selectedCompId],
    queryFn: async () => (await api.get<Gameweek[]>(`/admin/competitions/${selectedCompId}/gameweeks`)).data,
    enabled: isAdmin && !!selectedCompId,
  });

  const auditQuery = useQuery({
    queryKey: ['admin', 'audit', auditPage, auditPageSize, auditActionFilter, auditEntityFilter, auditAdminFilter, auditFieldFilter, auditEntityIdFilter, auditDateFrom, auditDateTo],
    queryFn: async () => {
      const res = await api.get<PageResponse<AuditLog>>('/admin/audit', {
        params: {
          page: auditPage,
          size: auditPageSize,
          action: auditActionFilter === 'all' ? undefined : auditActionFilter,
          entityType: auditEntityFilter === 'all' ? undefined : auditEntityFilter,
          username: auditAdminFilter === 'all' ? undefined : auditAdminFilter,
          fieldName: auditFieldFilter === 'all' ? undefined : auditFieldFilter,
          entityId: auditEntityIdFilter.trim() || undefined,
          from: auditDateFrom || undefined,
          to: auditDateTo || undefined,
        },
      });
      return res.data;
    },
    enabled: isAdmin && tab === 'audit',
  });

  const runConfirmedAction = async () => {
    const action = confirmDialog?.onConfirm;
    if (!action || confirmBusy) return;
    setConfirmBusy(true);
    try {
      await action();
    } catch {
      // Mutation handlers surface the user-facing error.
    } finally {
      setConfirmDialog(null);
      setConfirmBusy(false);
    }
  };

  const refreshAll = async () => {
    await Promise.all([
      competitionsQuery.refetch(),
      clubsQuery.refetch(),
      usersQuery.refetch(),
      gameweeksQuery.refetch(),
      auditQuery.refetch(),
    ]);
  };

  const clearCompetitionFieldError = (field: keyof CompetitionFormErrors) => {
    setCompetitionFormErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const validateCompetitionForm = () => {
    const name = competitionModalMode === 'create' ? compName : editName;
    const errors: CompetitionFormErrors = {};
    if (!name.trim()) errors.name = 'Competition name is required.';
    if (!editStartDate.trim()) errors.startDate = 'Start date is required.';
    setCompetitionFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submitCompetitionForm = () => {
    if (!validateCompetitionForm()) return;
    if (competitionModalMode === 'create') {
      createCompetition.mutate();
      return;
    }
    updateCompetition.mutate();
  };

  const closeCompetitionModal = () => {
    setShowStartDatePicker(false);
    setCompetitionFormErrors({});
    setCompetitionModalMode(null);
  };

  const createCompetition = useMutation({
    mutationFn: async () => api.post('/admin/competitions', {
      name: compName.trim(), description: editDescription.trim() || null,
      entryFee: editPaymentMode === 'FREE' ? 0 : Number(editEntryFee || '0'), prizePool: editPrizePool.trim() ? Number(editPrizePool) : null,
      maxEntriesPerUser: Number(editMaxEntries || '1'), fixtureCompetitionCode: editFixtureCompetitionCode,
      missedPickMode: editMissedPickMode, postponedConsumesTeam: editPostponedConsumesTeam, lifelineEnabled: editLifelineEnabled, passFeeToParticipant: editPassFeeToParticipant,
      paymentMode: editPaymentMode, manualPaymentPolicy: editManualPaymentPolicy, visibility: editVisibility, startDate: editStartDate, status: editStatus,
    }),
    onSuccess: async () => {
      setCompName('');
      setEditDescription('');
      setCompetitionFormErrors({});
      setCompetitionModalMode(null);
      setOpStatus({ tone: 'success', message: 'Competition created.' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'competitions'] });
    },
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Failed to create competition.') }),
  });

  const updateCompetition = useMutation({
    mutationFn: async () => {
      if (!editCompId) throw new Error('No competition selected');
      return api.put(`/admin/competitions/${editCompId}`, {
        name: editName.trim(), description: editDescription.trim() || null,
        entryFee: editPaymentMode === 'FREE' ? 0 : Number(editEntryFee || '0'), prizePool: editPrizePool.trim() ? Number(editPrizePool) : null,
        maxEntriesPerUser: Number(editMaxEntries || '1'), fixtureCompetitionCode: editFixtureCompetitionCode, missedPickMode: editMissedPickMode, postponedConsumesTeam: editPostponedConsumesTeam,
        lifelineEnabled: editLifelineEnabled, passFeeToParticipant: editPassFeeToParticipant, paymentMode: editPaymentMode, manualPaymentPolicy: editManualPaymentPolicy,
        visibility: editVisibility, startDate: editStartDate, status: editStatus,
      });
    },
    onSuccess: async () => {
      setCompetitionFormErrors({});
      setCompetitionModalMode(null);
      setOpStatus({ tone: 'success', message: 'Competition updated.' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'competitions'] });
    },
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Failed to update competition.') }),
  });

  const openCreateCompetitionModal = () => {
    setCompName('');
    setEditDescription('');
    setEditStartDate(new Date().toISOString().slice(0, 10));
    setEditEntryFee('0');
    setEditPrizePool('0');
    setEditMaxEntries('1');
    setEditStatus('UPCOMING');
    setEditPaymentMode('FREE');
    setEditVisibility('PUBLIC');
    setEditLifelineEnabled(false);
    setEditFixtureCompetitionCode('PL');
    setEditMissedPickMode('ELIMINATE');
    setEditPostponedConsumesTeam(true);
    setEditPassFeeToParticipant(false);
    setEditManualPaymentPolicy('STRICT');
    setShowStartDatePicker(false);
    setCompetitionFormErrors({});
    setCompetitionModalMode('create');
  };

  const openEditCompetitionModal = (competition: Competition) => {
    setEditCompId(competition.id);
    setEditName(competition.name ?? '');
    setEditDescription(competition.description ?? '');
    setEditStartDate((competition.startDate ?? '').slice(0, 10));
    setEditEntryFee(String(competition.entryFee ?? 0));
    setEditPrizePool(String(competition.prizePool ?? 0));
    setEditMaxEntries(String(competition.maxEntriesPerUser ?? 1));
    setEditStatus((competition.status ?? 'UPCOMING') as 'UPCOMING' | 'ACTIVE' | 'COMPLETED');
    setEditPaymentMode((competition.paymentMode ?? 'FREE') as 'FREE' | 'MANUAL' | 'STRIPE');
    setEditVisibility((competition.visibility ?? 'PUBLIC') as 'PUBLIC' | 'PRIVATE');
    setEditLifelineEnabled(Boolean(competition.lifelineEnabled));
    setEditFixtureCompetitionCode((competition.fixtureCompetitionCode ?? 'PL') as 'PL' | 'WC');
    setEditMissedPickMode((competition.missedPickMode ?? 'ELIMINATE') as 'ELIMINATE' | 'ALLOW');
    setEditPostponedConsumesTeam(competition.postponedConsumesTeam ?? true);
    setEditPassFeeToParticipant(Boolean(competition.passFeeToParticipant));
    setEditManualPaymentPolicy((competition.manualPaymentPolicy ?? 'STRICT') as 'STRICT' | 'LENIENT');
    setShowStartDatePicker(false);
    setCompetitionFormErrors({});
    setCompetitionModalMode('edit');
  };

  const bulkCreateCompetitions = useMutation({
    mutationFn: async () => api.post('/admin/competitions/bulk-create', {
      prefix: (bulkPrefix || 'Load Test').trim(),
      count: Math.max(1, Math.min(500, Number(bulkCount || '1'))),
      startDate: bulkStartDate,
      clubId: null,
    }, { timeout: 120_000 }),
    onSuccess: async () => {
      setOpStatus({ tone: 'success', message: 'Bulk create completed.' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'competitions'] });
    },
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Bulk create failed.') }),
  });

  const bulkDeleteCompetitions = useMutation({
    mutationFn: async () => api.delete('/admin/competitions/bulk-delete', {
      timeout: 120_000,
      data: { prefix: (bulkDeletePrefix || '').trim(), upcomingOnly: bulkDeleteUpcomingOnly },
    }),
    onSuccess: async () => {
      setOpStatus({ tone: 'success', message: 'Bulk delete completed.' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'competitions'] });
    },
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Bulk delete failed.') }),
  });

  const deleteCompetition = useMutation({
    mutationFn: async (id: number) => api.delete(`/admin/competitions/${id}`),
    onSuccess: async () => {
      setOpStatus({ tone: 'success', message: 'Competition deleted.' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'competitions'] });
    },
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Failed to delete competition.') }),
  });

  const syncCompetitionFixtures = useMutation({
    mutationFn: async (id: number) => api.post(`/admin/competitions/${id}/sync-fixtures`),
    onSuccess: () => setOpStatus({ tone: 'success', message: 'Competition fixtures sync started.' }),
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Fixture sync failed.') }),
  });

  const createClub = useMutation({
    mutationFn: async () => api.post('/admin/clubs', {
      name: clubName.trim(),
      description: clubDescription.trim() || null,
      clubAdminUserId: clubAdminUserId ? Number(clubAdminUserId) : null,
    }),
    onSuccess: async () => {
      setClubName('');
      setClubDescription('');
      setClubAdminUserId('');
      setClubAdminSearch('');
      setClubFormErrors({});
      setShowClubModal(false);
      setOpStatus({ tone: 'success', message: 'Club created.' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'clubs'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Failed to create club.') }),
  });

  const assignClubAdmin = useMutation({
    mutationFn: async ({ clubId, userId }: { clubId: number; userId: number }) => api.put(`/admin/clubs/${clubId}`, { clubAdminUserId: userId }),
    onSuccess: async () => {
      setAssigningClub(null);
      setAssignUserId('');
      setAssignAdminSearch('');
      setOpStatus({ tone: 'success', message: 'Club admin assigned.' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'clubs'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Failed to assign club admin.') }),
  });

  const deleteClub = useMutation({
    mutationFn: async (id: number) => api.delete(`/admin/clubs/${id}`),
    onSuccess: async () => {
      setOpStatus({ tone: 'success', message: 'Club deleted.' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'clubs'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Failed to delete club.') }),
  });

  const createUser = useMutation({
    mutationFn: async () => api.post('/admin/users', { email: newUserEmail.trim(), username: newUserName.trim(), password: newUserPassword, role: newUserRole }),
    onSuccess: async () => {
      setNewUserEmail('');
      setNewUserName('');
      setNewUserPassword('');
      setNewUserRole('USER');
      setUserFormErrors({});
      setShowUserModal(false);
      setOpStatus({ tone: 'success', message: 'User created.' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Failed to create user.') }),
  });

  const toggleUserDisabled = useMutation({
    mutationFn: async (id: number) => api.put(`/admin/users/${id}/toggle-disabled`),
    onSuccess: async () => {
      setOpStatus({ tone: 'success', message: 'User status updated.' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Failed to update user status.') }),
  });

  const changeUserRole = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: AdminUser['role'] }) => api.put(`/admin/users/${id}/role`, { role }),
    onSuccess: async () => {
      setOpStatus({ tone: 'success', message: 'User role updated.' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Failed to update role.') }),
  });

  const deleteUser = useMutation({
    mutationFn: async (id: number) => api.delete(`/admin/users/${id}`),
    onSuccess: async () => {
      setOpStatus({ tone: 'success', message: 'User deleted.' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Failed to delete user.') }),
  });

  const syncAllFixtures = useMutation({
    mutationFn: async () => api.post('/admin/fixtures/import/sync'),
    onSuccess: () => setOpStatus({ tone: 'success', message: 'Fixture sync started.' }),
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Failed to start fixture sync.') }),
  });
  const clearFixtureCache = useMutation({
    mutationFn: async () => api.delete('/admin/fixtures/cache'),
    onSuccess: () => setOpStatus({ tone: 'success', message: 'Fixture cache cleared.' }),
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Failed to clear fixture cache.') }),
  });

  const simulateResult = useMutation({
    mutationFn: async () => {
      const fixtures = Object.fromEntries(Object.entries(fixtureResults)
        .filter(([, result]) => result.status || result.scoreHome || result.scoreAway)
        .map(([fixtureId, result]) => [fixtureId, {
          status: result.status || null,
          scoreHome: result.scoreHome ? Number(result.scoreHome) : null,
          scoreAway: result.scoreAway ? Number(result.scoreAway) : null,
        }]));
      const gameweek = (gameweeksQuery.data ?? []).find((item) => item.id === selectedGwId);
      const endpoint = gameweek?.status === 'COMPLETED' ? 'correct' : 'simulate';
      return api.post(`/admin/competitions/${selectedCompId}/gameweeks/${selectedGwId}/${endpoint}`, { fixtures, skipAutoComplete });
    },
    onSuccess: async () => {
      setFixtureResults({});
      setOpStatus({
        tone: 'success',
        message: isCorrectionMode
          ? 'Corrected result saved and participant outcomes recalculated.'
          : 'Simulation started. Refresh after processing completes.',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'gameweeks', selectedCompId] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'competitions'] }),
        queryClient.invalidateQueries({ queryKey: ['competitions-upcoming'] }),
        queryClient.invalidateQueries({ queryKey: ['competitions-my-details'] }),
      ]);
    },
    onError: (err: any) => setOpStatus({
      tone: 'error',
      message: getApiMessage(err, isCorrectionMode ? 'Correction failed.' : 'Simulation failed.'),
    }),
  });

  const bulkSimulateResult = useMutation({
    mutationFn: async () => {
      if (!selectedGameweek) throw new Error('No gameweek selected');
      const fixtures = Object.fromEntries((selectedGameweek.fixtures ?? []).map((fixture) => {
        const result = randomFixtureResult();
        return [String(fixture.id), { status: result.status, scoreHome: Number(result.scoreHome), scoreAway: Number(result.scoreAway) }];
      }));
      return api.post(`/admin/competitions/${selectedCompId}/gameweeks/${selectedGwId}/simulate`, { fixtures, skipAutoComplete });
    },
    onSuccess: async () => {
      setFixtureResults({});
      setOpStatus({ tone: 'success', message: 'Randomised simulation started.' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'gameweeks', selectedCompId] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'competitions'] }),
        queryClient.invalidateQueries({ queryKey: ['competitions-upcoming'] }),
        queryClient.invalidateQueries({ queryKey: ['competitions-my-details'] }),
      ]);
    },
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Bulk simulation failed.') }),
  });

  const generateTestData = useMutation({
    mutationFn: async () => api.post('/admin/test/generate', {
      competitionId: testDataCompetitionId,
      userCount: Math.max(1, Math.min(500, Number(testDataUserCount || '0'))),
      gameweeksToSeedPicks: parseGameweekRangeInput(testDataGameweeks),
    }, { timeout: 120_000 }),
    onSuccess: async (response: any) => {
      const data = response?.data ?? {};
      setOpStatus({ tone: 'success', message: `Created ${data.usersCreated ?? 0} users, ${data.participantsAdded ?? 0} participants, ${data.picksCreated ?? 0} picks.` });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'competitions'] }),
        queryClient.invalidateQueries({ queryKey: ['competitions-upcoming'] }),
        queryClient.invalidateQueries({ queryKey: ['competitions-my-details'] }),
      ]);
    },
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Failed to generate test data.') }),
  });
  const cleanupTestData = useMutation({
    mutationFn: async () => api.delete('/admin/test/cleanup', { timeout: 120_000 }),
    onSuccess: () => setOpStatus({ tone: 'success', message: 'Test data cleanup completed.' }),
    onError: (err: any) => setOpStatus({ tone: 'error', message: getApiMessage(err, 'Failed to cleanup test data.') }),
  });

  const selectedCompetition = useMemo(() => (competitionsQuery.data ?? []).find((c) => c.id === selectedCompId) ?? null, [competitionsQuery.data, selectedCompId]);
  const selectedTestDataCompetition = useMemo(() => (competitionsQuery.data ?? []).find((c) => c.id === testDataCompetitionId) ?? null, [competitionsQuery.data, testDataCompetitionId]);
  const selectedGameweek = useMemo(() => (gameweeksQuery.data ?? []).find((gw) => gw.id === selectedGwId) ?? null, [gameweeksQuery.data, selectedGwId]);
  const isCorrectionMode = selectedGameweek?.status === 'COMPLETED';
  const hasFixtureResults = Object.values(fixtureResults).some((result) => result.status || result.scoreHome || result.scoreAway);

  const auditLogs = auditQuery.data?.content ?? [];
  const auditActions = useMemo(() => Array.from(new Set(auditLogs.map((log) => log.action).filter(Boolean))).sort() as string[], [auditLogs]);
  const auditEntities = useMemo(() => Array.from(new Set(auditLogs.map((log) => log.entityType).filter(Boolean))).sort() as string[], [auditLogs]);
  const auditAdmins = useMemo(() => Array.from(new Set(auditLogs.map((log) => log.username).filter(Boolean))).sort() as string[], [auditLogs]);
  const auditFields = useMemo(() => Array.from(new Set(auditLogs.map((log) => log.fieldName).filter(Boolean))).sort() as string[], [auditLogs]);
  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter((log) => [log.username, log.action, log.entityType, String(log.entityId ?? ''), log.fieldName, log.oldValue, log.newValue]
      .filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [auditLogs, auditSearch]);
  const auditTotalElements = auditQuery.data?.totalElements ?? auditLogs.length;
  const auditTotalPages = Math.max(auditQuery.data?.totalPages ?? 1, 1);
  const auditCurrentPage = auditQuery.data?.number ?? auditPage;
  const auditActiveFilters = [
    auditSearch.trim() ? `Search: ${auditSearch.trim()}` : null,
    auditActionFilter !== 'all' ? `Action: ${auditActionFilter}` : null,
    auditEntityFilter !== 'all' ? `Entity: ${auditEntityFilter}` : null,
    auditAdminFilter !== 'all' ? `Admin: ${auditAdminFilter}` : null,
    auditFieldFilter !== 'all' ? `Field: ${auditFieldFilter}` : null,
    auditEntityIdFilter.trim() ? `Entity ID: ${auditEntityIdFilter.trim()}` : null,
    auditDateFrom ? `From: ${auditDateFrom}` : null,
    auditDateTo ? `To: ${auditDateTo}` : null,
  ].filter(Boolean) as string[];

  const filteredCompetitions = useMemo(() => {
    let rows = competitionsQuery.data ?? [];
    if (compStatusFilter !== 'ALL') rows = rows.filter((c) => c.status === compStatusFilter);
    if (compSearch.trim()) {
      const q = compSearch.toLowerCase();
      rows = rows.filter((c) => c.name.toLowerCase().includes(q));
    }
    return rows;
  }, [competitionsQuery.data, compStatusFilter, compSearch]);

  const filteredUsers = useMemo(() => {
    if (tab === 'users') return pagedUsersQuery.data?.content ?? [];
    let rows = usersQuery.data ?? [];
    if (userRoleFilter !== 'ALL') rows = rows.filter((u) => u.role === userRoleFilter);
    if (userSearch.trim()) {
      const q = userSearch.toLowerCase();
      rows = rows.filter((u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    return rows;
  }, [tab, pagedUsersQuery.data, usersQuery.data, userRoleFilter, userSearch]);

  const totalFilteredUsers = tab === 'users' ? (pagedUsersQuery.data?.totalElements ?? filteredUsers.length) : filteredUsers.length;
  const visibleUsers = tab === 'users' ? filteredUsers : filteredUsers.slice(0, userVisibleCount);
  const hasMoreUsers = visibleUsers.length < totalFilteredUsers;

  const filteredClubs = useMemo(() => {
    let rows = clubsQuery.data ?? [];
    if (clubSearch.trim()) {
      const q = clubSearch.toLowerCase();
      rows = rows.filter((club) =>
        club.name.toLowerCase().includes(q) ||
        (club.description ?? '').toLowerCase().includes(q) ||
        (club.clubAdminUsername ?? '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [clubsQuery.data, clubSearch]);

  const eligibleClubAdmins = useMemo(() => (usersQuery.data ?? []).filter((u) => !u.disabled), [usersQuery.data]);

  const selectedClubAdmin = useMemo(() => eligibleClubAdmins.find((admin) => String(admin.id) === clubAdminUserId) ?? null, [eligibleClubAdmins, clubAdminUserId]);

  const selectedAssignAdmin = useMemo(() => eligibleClubAdmins.find((admin) => String(admin.id) === assignUserId) ?? null, [eligibleClubAdmins, assignUserId]);

  const filteredClubAdminOptions = useMemo(() => {
    const query = clubAdminSearch.trim().toLowerCase();
    if (query.length < 2) return [];
    return eligibleClubAdmins.filter((admin) => admin.username.toLowerCase().includes(query) || admin.email.toLowerCase().includes(query)).slice(0, 8);
  }, [eligibleClubAdmins, clubAdminSearch]);

  const filteredAssignAdminOptions = useMemo(() => {
    const query = assignAdminSearch.trim().toLowerCase();
    if (query.length < 2) return [];
    return eligibleClubAdmins.filter((admin) => admin.username.toLowerCase().includes(query) || admin.email.toLowerCase().includes(query)).slice(0, 8);
  }, [eligibleClubAdmins, assignAdminSearch]);

  const openCreateClubModal = () => {
    setClubName('');
    setClubDescription('');
    setClubAdminUserId('');
    setClubAdminSearch('');
    setClubFormErrors({});
    setShowClubModal(true);
  };

  const validateClubForm = () => {
    const errors: ClubFormErrors = {};
    if (!clubName.trim()) errors.name = 'Club name is required.';
    setClubFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submitClubForm = () => {
    if (!validateClubForm()) return;
    createClub.mutate();
  };

  const openCreateUserModal = () => {
    setNewUserEmail('');
    setNewUserName('');
    setNewUserPassword('');
    setNewUserRole('USER');
    setUserFormErrors({});
    setShowUserModal(true);
  };

  const validateUserForm = () => {
    const errors: UserFormErrors = {};
    if (!newUserEmail.trim()) errors.email = 'Email is required.';
    if (!newUserName.trim()) errors.username = 'Username is required.';
    if (!newUserPassword.trim()) errors.password = 'Password is required.';
    else if (newUserPassword.length < 6) errors.password = 'Password must be at least 6 characters.';
    setUserFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submitUserForm = () => {
    if (!validateUserForm()) return;
    createUser.mutate();
  };

  const formatUserDate = (value?: string) => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
  };

  const adminStats = useMemo(() => ({
    competitions: competitionsQuery.data?.length ?? 0,
    clubs: clubsQuery.data?.length ?? 0,
    users: usersQuery.data?.length ?? 0,
  }), [competitionsQuery.data, clubsQuery.data, usersQuery.data]);

  const handleStartDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowStartDatePicker(false);
    if (selectedDate) {
      setEditStartDate(toDateInputValue(selectedDate));
      clearCompetitionFieldError('startDate');
    }
  };

  const setFixtureResult = (fixtureId: number, field: keyof FixtureResultDraft, value: string) => {
    setFixtureResults((current) => ({
      ...current,
      [fixtureId]: { ...(current[fixtureId] ?? { status: '', scoreHome: '', scoreAway: '' }), [field]: value },
    }));
  };

  const setQuickFixtureResult = (fixture: AdminFixture, result: FixtureResultDraft) => {
    setFixtureResults((current) => ({ ...current, [fixture.id]: result }));
  };

  const setHomeWin = (fixture: AdminFixture) => setQuickFixtureResult(fixture, { status: 'FINISHED', scoreHome: '2', scoreAway: '1' });
  const setAwayWin = (fixture: AdminFixture) => setQuickFixtureResult(fixture, { status: 'FINISHED', scoreHome: '1', scoreAway: '2' });
  const setDraw = (fixture: AdminFixture) => setQuickFixtureResult(fixture, { status: 'FINISHED', scoreHome: '1', scoreAway: '1' });
  const setPostponed = (fixture: AdminFixture) => setQuickFixtureResult(fixture, { status: 'POSTPONED', scoreHome: '', scoreAway: '' });
  const randomiseFixture = (fixture: AdminFixture) => setQuickFixtureResult(fixture, randomFixtureResult());

  const randomiseAllFixtures = () => {
    if (!selectedGameweek) return;
    const next: Record<number, FixtureResultDraft> = {};
    (selectedGameweek.fixtures ?? []).forEach((fixture) => { next[fixture.id] = randomFixtureResult(); });
    setFixtureResults(next);
  };

  const setAuditFilterAndResetPage = (setter: (value: string) => void, value: string) => {
    setter(value);
    setAuditPage(0);
  };

  const clearAuditFilters = () => {
    setAuditSearch('');
    setAuditActionFilter('all');
    setAuditEntityFilter('all');
    setAuditAdminFilter('all');
    setAuditFieldFilter('all');
    setAuditEntityIdFilter('');
    setAuditDateFrom('');
    setAuditDateTo('');
    setAuditPage(0);
    setAuditDropdownOpen(null);
  };

  const activeOperation = useMemo(() => {
    const operations = [
      { active: createCompetition.isPending, message: 'Creating competition...' },
      { active: updateCompetition.isPending, message: 'Saving competition changes...' },
      { active: bulkCreateCompetitions.isPending, message: 'Bulk creating competitions...' },
      { active: bulkDeleteCompetitions.isPending, message: 'Deleting matching competitions...' },
      { active: deleteCompetition.isPending, message: 'Deleting competition...' },
      { active: syncCompetitionFixtures.isPending, message: 'Syncing competition fixtures...' },
      { active: createClub.isPending, message: 'Creating club...' },
      { active: assignClubAdmin.isPending, message: 'Assigning club admin...' },
      { active: deleteClub.isPending, message: 'Deleting club...' },
      { active: createUser.isPending, message: 'Creating user...' },
      { active: toggleUserDisabled.isPending, message: 'Updating user status...' },
      { active: changeUserRole.isPending, message: 'Updating user role...' },
      { active: deleteUser.isPending, message: 'Deleting user...' },
      { active: syncAllFixtures.isPending, message: 'Syncing fixtures...' },
      { active: clearFixtureCache.isPending, message: 'Clearing fixture cache...' },
      { active: simulateResult.isPending, message: 'Processing gameweek results and eliminations...' },
      { active: bulkSimulateResult.isPending, message: 'Randomising fixtures and processing gameweek results...' },
      { active: generateTestData.isPending, message: `Generating ${testDataUserCount || '0'} test users and seeded picks...` },
      { active: cleanupTestData.isPending, message: 'Deleting test users and related data...' },
      { active: auditQuery.isFetching, message: 'Loading audit trail...' },
    ];
    return operations.find((operation) => operation.active) ?? null;
  }, [
    createCompetition.isPending, updateCompetition.isPending, bulkCreateCompetitions.isPending,
    bulkDeleteCompetitions.isPending, deleteCompetition.isPending, syncCompetitionFixtures.isPending,
    createClub.isPending, assignClubAdmin.isPending, deleteClub.isPending, createUser.isPending,
    toggleUserDisabled.isPending, changeUserRole.isPending, deleteUser.isPending, syncAllFixtures.isPending,
    clearFixtureCache.isPending, simulateResult.isPending, bulkSimulateResult.isPending,
    generateTestData.isPending, cleanupTestData.isPending, auditQuery.isFetching, testDataUserCount,
  ]);
  const visibleStatus = activeOperation ? { tone: 'info' as const, message: activeOperation.message } : opStatus;
  const operationInProgress = Boolean(activeOperation);

  if (!isAdmin) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
        <Card>
          <SectionTitle>Admin Only</SectionTitle>
          <MetaText>You do not have access to the admin panel.</MetaText>
        </Card>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 36 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refreshAll()} tintColor={colors.brand} />}>
        <View style={styles.hero}>
          <View style={styles.heroGlowOne} />
          <View style={styles.heroGlowTwo} />
          <View style={styles.heroContent}>
            <View style={styles.heroBadge}><Text style={styles.heroBadgeText}>Control room</Text></View>
            <ScreenTitle>Admin Panel</ScreenTitle>
            <Text style={styles.heroCopy}>Manage competitions, clubs, users, fixtures, simulations, and audit trails from one operational dashboard.</Text>
            <View style={styles.heroStatsGrid}>
              <View style={styles.heroStat}><Text style={styles.heroStatValue}>Live</Text><Text style={styles.heroStatLabel}>Comps</Text></View>
              <View style={styles.heroStat}><Text style={styles.heroStatValueAlt}>Data</Text><Text style={styles.heroStatLabel}>Sync</Text></View>
              <View style={styles.heroStat}><Text style={styles.heroStatValueWarn}>Tracked</Text><Text style={styles.heroStatLabel}>Audit</Text></View>
            </View>
          </View>
        </View>

        <View style={styles.statusPanel}>
          <View style={styles.statusLeft}>
            {operationInProgress ? <ActivityIndicator size="small" color="#38bdf8" /> : <View style={[styles.statusDot, visibleStatus?.tone === 'error' ? styles.statusDotError : visibleStatus?.tone === 'info' ? styles.statusDotInfo : styles.statusDotOk]} />}
            <Text style={styles.statusLabel}>{operationInProgress ? 'Working' : 'Status'}</Text>
            <Text style={styles.statusMessage} numberOfLines={2}>{visibleStatus?.message ?? 'All systems nominal'}</Text>
          </View>
          <Text style={styles.statusHelper}>{operationInProgress ? 'Keep this screen open until the operation completes.' : 'Admin tooling is ready for operations.'}</Text>
        </View>

        <View style={styles.sectionSelectorBlock}>
          <Text style={styles.selectorLabel}>Admin section</Text>
          <TouchableOpacity style={[styles.selectorButton, sectionPickerOpen ? styles.selectorButtonOpen : null]} onPress={() => setSectionPickerOpen((value) => !value)}>
            <View style={styles.selectorButtonCopy}>
              <Text style={styles.selectorKicker}>Viewing</Text>
              <Text style={styles.selectorButtonText}>{selectedAdminTab.label}</Text>
              <Text style={styles.selectorButtonMeta}>Tap to switch admin tools</Text>
            </View>
            <View style={[styles.selectorChevronBox, sectionPickerOpen ? styles.selectorChevronBoxOpen : null]}>
              <Text style={styles.selectorChevron}>{sectionPickerOpen ? '▲' : '▼'}</Text>
            </View>
          </TouchableOpacity>
          {sectionPickerOpen ? (
            <View style={styles.selectorMenu}>
              {adminTabs.map((item) => (
                <TouchableOpacity key={item.key} style={[styles.selectorItem, tab === item.key ? styles.selectorItemActive : null]} onPress={() => { setConfirmDialog(null); setTab(item.key); setSectionPickerOpen(false); }}>
                  <Text style={[styles.selectorItemText, tab === item.key ? styles.selectorItemTextActive : null]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>

        {(competitionsQuery.isLoading || clubsQuery.isLoading || usersQuery.isLoading) ? (
          <View style={styles.webCard}><MetaText>Loading admin data...</MetaText></View>
        ) : null}
        {(competitionsQuery.error || clubsQuery.error || usersQuery.error) ? (
          <View style={styles.webCard}><Text style={styles.errorText}>Some admin data failed to load. Pull to refresh and try again.</Text></View>
        ) : null}

        {tab === 'competitions' && (
          <View style={styles.webCard}>
            <View style={styles.competitionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionHeading}>Manage Competitions</Text>
                <Text style={styles.sectionDescription}>Create new pools, inspect invite settings, and manage the full competition roster.</Text>
              </View>
              <TouchableOpacity style={styles.headerActionBtn} onPress={openCreateCompetitionModal}>
                <Text style={styles.headerActionBtnText}>+ New Competition</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.hr} />
            <SectionTitle>Bulk Create</SectionTitle>
            <TextInput value={bulkPrefix} onChangeText={setBulkPrefix} placeholder="Name prefix" placeholderTextColor={colors.textMuted} style={styles.input} />
            <View style={styles.twoCol}>
              <TextInput value={bulkCount} onChangeText={setBulkCount} keyboardType="number-pad" placeholder="Count" placeholderTextColor={colors.textMuted} style={[styles.input, styles.half]} />
              <TextInput value={bulkStartDate} onChangeText={setBulkStartDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} style={[styles.input, styles.half]} />
            </View>
            <PrimaryButton label={bulkCreateCompetitions.isPending ? 'Creating...' : 'Bulk Create'} onPress={() => bulkCreateCompetitions.mutate()} disabled={bulkCreateCompetitions.isPending} />

            <View style={styles.hr} />
            <SectionTitle>Bulk Delete</SectionTitle>
            <TextInput value={bulkDeletePrefix} onChangeText={setBulkDeletePrefix} placeholder="Prefix" placeholderTextColor={colors.textMuted} style={styles.input} />
            <View style={styles.tabWrap}>
              <FilterPill label="Upcoming only" active={bulkDeleteUpcomingOnly} onPress={() => setBulkDeleteUpcomingOnly((v) => !v)} />
            </View>
            <TouchableOpacity style={styles.delBtnWide} onPress={() => setConfirmDialog({ title: 'Delete matching competitions?', message: `This will permanently delete competitions matching "${(bulkDeletePrefix || '').trim() || 'the selected prefix'}"${bulkDeleteUpcomingOnly ? ' that are still upcoming' : ''}.`, items: ['Competition data, participants, picks, and payments can be affected.', 'This action cannot be undone.'], confirmText: 'Yes, Delete All', onConfirm: () => bulkDeleteCompetitions.mutateAsync() })}><Text style={styles.delBtnText}>{bulkDeleteCompetitions.isPending ? 'Deleting...' : 'Bulk Delete'}</Text></TouchableOpacity>

            <View style={styles.hr} />
            <SectionTitle>List</SectionTitle>
            <TextInput value={compSearch} onChangeText={setCompSearch} placeholder="Search competitions" placeholderTextColor={colors.textMuted} style={styles.input} />
            <View style={styles.tabWrap}>{(['ALL', 'UPCOMING', 'ACTIVE', 'COMPLETED'] as const).map((status) => <FilterPill key={status} label={status} active={compStatusFilter === status} onPress={() => setCompStatusFilter(status)} />)}</View>

            {filteredCompetitions.length === 0 ? <MetaText>No competitions match your filters.</MetaText> : null}
            {filteredCompetitions.map((c) => {
              const managing = managingAdminCompetitionId === c.id;
              return (
                <View key={c.id} style={styles.adminCompetitionBlock}>
                  <View style={styles.adminCompetitionCard}>
                    <View style={styles.adminCompetitionTop}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.adminCompetitionName} numberOfLines={1}>{c.name}</Text>
                        <Text style={styles.adminCompetitionDate}>{c.startDate ?? 'No start date'}</Text>
                        {c.visibility === 'PRIVATE' && c.joinCode ? (
                          <View style={styles.adminJoinCodePill}><Text style={styles.adminJoinCodeLabel}>Invite code</Text><Text selectable selectionColor="#38bdf8" style={styles.adminJoinCodeText}>{c.joinCode}</Text></View>
                        ) : null}
                      </View>
                      <StatusPill text={c.status} tone={c.status === 'ACTIVE' ? 'success' : c.status === 'UPCOMING' ? 'brand' : 'neutral'} />
                    </View>
                    <View style={styles.adminCompetitionMetaRow}>
                      <Text style={styles.adminCompetitionMeta}>👥 {c.participantCount ?? 0} players</Text>
                      <Text style={styles.adminCompetitionMeta}>⚙️ {c.missedPickMode ?? 'ELIMINATE'}</Text>
                    </View>
                    <View style={styles.adminCompetitionActions}>
                      <TouchableOpacity style={styles.adminEditBtn} onPress={() => openEditCompetitionModal(c)}><Text style={styles.adminEditBtnText}>Edit</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.adminSyncBtn} onPress={() => syncCompetitionFixtures.mutate(c.id)} disabled={syncCompetitionFixtures.isPending && syncCompetitionFixtures.variables === c.id}><Text style={styles.adminSyncBtnText}>{syncCompetitionFixtures.isPending && syncCompetitionFixtures.variables === c.id ? '⏳' : '🔄 Sync'}</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.adminManageBtn} onPress={() => setManagingAdminCompetitionId((prev) => prev === c.id ? null : c.id)}><Text style={styles.adminManageBtnText}>{managing ? 'Hide' : 'Manage'}</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.adminDeleteBtn} onPress={() => setConfirmDialog({ title: `Delete ${c.name}?`, message: 'This will permanently delete this competition and its related competition data.', items: ['Participants, picks, payments, and gameweek data may be removed.', 'This action cannot be undone.'], confirmText: 'Delete Competition', onConfirm: () => deleteCompetition.mutateAsync(c.id) })} disabled={deleteCompetition.isPending && deleteCompetition.variables === c.id}><Text style={styles.adminDeleteBtnText}>{deleteCompetition.isPending && deleteCompetition.variables === c.id ? 'Deleting...' : 'Delete'}</Text></TouchableOpacity>
                    </View>
                  </View>
                  {managing ? <AdminParticipantsPanel competition={c} setConfirmDialog={setConfirmDialog} /> : null}
                </View>
              );
            })}
          </View>
        )}

        {tab === 'clubs' && (
          <View style={styles.webCard}>
            <View style={styles.competitionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionEyebrow}>Club network</Text>
                <Text style={styles.sectionHeading}>Manage Clubs</Text>
                <Text style={styles.sectionDescription}>Create clubs, assign club admins, and keep the ownership structure tidy before competitions go live.</Text>
              </View>
              <TouchableOpacity style={styles.headerActionBtn} onPress={openCreateClubModal}>
                <Text style={styles.headerActionBtnText}>+ New Club</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.hr} />
            <TextInput value={clubSearch} onChangeText={setClubSearch} placeholder="Search clubs..." placeholderTextColor={colors.textMuted} style={styles.input} />
            {(clubSearch.trim()) ? <MetaText>{filteredClubs.length} results · filtered</MetaText> : null}

            {filteredClubs.length === 0 ? (
              <View style={styles.emptyStateCard}>
                <Text style={styles.emptyStateIcon}>⌂</Text>
                <Text style={styles.emptyStateText}>{clubSearch.trim() ? `No clubs match "${clubSearch.trim()}"` : 'No clubs yet. Create one to get started.'}</Text>
              </View>
            ) : (
              <View style={styles.clubListCard}>
                <View style={styles.clubListHeader}>
                  <Text style={styles.clubListHeaderText}>{filteredClubs.length} club{filteredClubs.length === 1 ? '' : 's'}{clubSearch.trim() ? ` matching "${clubSearch.trim()}"` : ''}</Text>
                </View>
                {filteredClubs.map((club) => (
                  <View key={club.id} style={styles.clubRowCard}>
                    <View style={styles.clubRowTop}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.clubName} numberOfLines={1}>{club.name}</Text>
                        {club.description ? <Text style={styles.clubDescription} numberOfLines={2}>{club.description}</Text> : null}
                      </View>
                      {club.clubAdminUsername ? (
                        <View style={styles.clubAdminBadge}><Text style={styles.clubAdminBadgeText}>{club.clubAdminUsername}</Text></View>
                      ) : (
                        <Text style={styles.noAdminText}>No admin</Text>
                      )}
                    </View>
                    <View style={styles.clubActions}>
                      <TouchableOpacity style={styles.clubGhostBtn} onPress={() => { setAssigningClub(club); setAssignUserId(String(club.clubAdminId ?? '')); setAssignAdminSearch(club.clubAdminUsername ?? ''); }}>
                        <Text style={styles.clubGhostBtnText}>{club.clubAdminUsername ? 'Change Admin' : 'Assign Admin'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.clubDeleteBtn} onPress={() => setConfirmDialog({ title: `Delete "${club.name}"?`, message: 'The club will be removed. Its competitions will not be deleted.', items: ['Club ownership/admin assignment will be removed.', 'This action cannot be undone.'], confirmText: 'Yes, Delete Club', onConfirm: () => deleteClub.mutateAsync(club.id) })} disabled={deleteClub.isPending && deleteClub.variables === club.id}>
                        <Text style={styles.clubDeleteBtnText}>{deleteClub.isPending && deleteClub.variables === club.id ? 'Deleting...' : 'Delete'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {tab === 'users' && (
          <View style={styles.webCard}>
            <View style={styles.competitionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionEyebrow}>Access control</Text>
                <Text style={styles.sectionHeading}>Manage Users</Text>
                <Text style={styles.sectionDescription}>Create accounts, adjust roles, and suspend or remove users from the platform safely.</Text>
              </View>
              <TouchableOpacity style={styles.headerActionBtn} onPress={openCreateUserModal}>
                <Text style={styles.headerActionBtnText}>+ Add User</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.hr} />
            <TextInput value={userSearch} onChangeText={(value) => { setUserSearch(value); setUserVisibleCount(USER_PAGE_SIZE); }} placeholder="Search users..." placeholderTextColor={colors.textMuted} style={styles.input} autoCapitalize="none" />
            <View style={styles.tabWrap}>{(['ALL', 'USER', 'CLUB_ADMIN', 'ADMIN'] as const).map((r) => <FilterPill key={r} label={r} active={userRoleFilter === r} onPress={() => { setUserRoleFilter(r); setUserVisibleCount(USER_PAGE_SIZE); }} />)}</View>

            {pagedUsersQuery.isFetching && visibleUsers.length === 0 ? (
              <View style={styles.emptyStateCard}>
                <Text style={styles.emptyStateText}>Loading users...</Text>
              </View>
            ) : filteredUsers.length === 0 ? (
              <View style={styles.emptyStateCard}>
                <Text style={styles.emptyStateText}>{userSearch.trim() ? `No users match "${userSearch.trim()}"` : 'No users found.'}</Text>
              </View>
            ) : (
              <View style={styles.clubListCard}>
                <View style={styles.clubListHeader}>
                  <Text style={styles.clubListHeaderText}>{totalFilteredUsers} user{totalFilteredUsers === 1 ? '' : 's'}{userSearch.trim() ? ` matching "${userSearch.trim()}"` : ''}</Text>
                </View>
                {visibleUsers.map((u) => (
                  <View key={u.id} style={styles.userRowCard}>
                    <View style={styles.clubRowTop}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.clubName} numberOfLines={1}>{u.username}</Text>
                        <Text style={styles.clubDescription} numberOfLines={1}>{u.email}</Text>
                        {formatUserDate(u.createdAt) ? <Text style={styles.userJoinedText}>{formatUserDate(u.createdAt)}</Text> : null}
                      </View>
                      <View style={[styles.userStatusBadge, u.disabled ? styles.userStatusDisabled : styles.userStatusActive]}>
                        <Text style={[styles.userStatusText, u.disabled ? styles.userStatusTextDisabled : styles.userStatusTextActive]}>{u.disabled ? 'Disabled' : 'Active'}</Text>
                      </View>
                    </View>
                    <View style={styles.userRolePicker}>
                      {(['USER', 'CLUB_ADMIN', 'ADMIN'] as const).map((role) => (
                        <TouchableOpacity key={role} style={[styles.userRoleBtn, u.role === role ? styles.userRoleBtnActive : null]} onPress={() => changeUserRole.mutate({ id: u.id, role })} disabled={changeUserRole.isPending}>
                          <Text style={[styles.userRoleBtnText, u.role === role ? styles.userRoleBtnTextActive : null]}>{role}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={styles.clubActions}>
                      <TouchableOpacity style={[styles.userActionBtn, u.disabled ? styles.userEnableBtn : styles.userDisableBtn]} onPress={() => toggleUserDisabled.mutate(u.id)} disabled={toggleUserDisabled.isPending}>
                        <Text style={[styles.userActionText, u.disabled ? styles.userEnableText : styles.userDisableText]}>{u.disabled ? 'Enable' : 'Disable'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.clubDeleteBtn} onPress={() => setConfirmDialog({ title: `Delete "${u.username}"?`, message: 'This will permanently remove the user account and all their competition data.', items: ['Club ownership and participant entries may be affected.', 'This action cannot be undone.'], confirmText: 'Yes, Delete User', onConfirm: () => deleteUser.mutateAsync(u.id) })} disabled={deleteUser.isPending && deleteUser.variables === u.id}>
                        <Text style={styles.clubDeleteBtnText}>{deleteUser.isPending && deleteUser.variables === u.id ? 'Deleting...' : 'Delete'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                {hasMoreUsers ? (
                  <TouchableOpacity style={styles.loadMoreUsersButton} onPress={() => setUserVisibleCount((count) => count + USER_PAGE_SIZE)}>
                    <Text style={styles.loadMoreUsersText}>{pagedUsersQuery.isFetching ? 'Loading...' : `Show ${Math.min(USER_PAGE_SIZE, totalFilteredUsers - visibleUsers.length)} more users`}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </View>
        )}

        {tab === 'sync' && (
          <View style={styles.webCard}>
            <SectionTitle>Fixture Sync</SectionTitle>
            <PrimaryButton label={syncAllFixtures.isPending ? 'Syncing...' : 'Sync Fixtures'} onPress={() => syncAllFixtures.mutate()} disabled={syncAllFixtures.isPending} />
            <View style={{ height: 10 }} />
            <TouchableOpacity style={styles.delBtnWide} onPress={() => setConfirmDialog({ title: 'Clear fixture cache?', message: 'This clears cached fixture provider responses.', items: ['Fresh fixture data will be fetched on the next sync or load.'], confirmText: 'Clear Cache', onConfirm: () => clearFixtureCache.mutateAsync() })}><Text style={styles.delBtnText}>{clearFixtureCache.isPending ? 'Clearing...' : 'Clear Fixture Cache'}</Text></TouchableOpacity>
          </View>
        )}

        {tab === 'simulate' && (
          <View style={styles.simulateRoot}>
            {(simulateResult.isPending || bulkSimulateResult.isPending) ? <AdminActionNotice tone="info" title={isCorrectionMode ? 'Applying correction' : 'Processing simulation'} message={activeOperation?.message ?? (isCorrectionMode ? 'Recalculating gameweek outcomes...' : 'Processing gameweek results...')} busy /> : null}
            <View style={styles.simulateIntro}>
              <Text style={styles.sectionEyebrow}>Scenario testing</Text>
              <Text style={styles.sectionHeading}>Manage Gameweek Results</Text>
              <Text style={styles.sectionDescription}>Simulate unresolved rounds or correct provider scores for the latest completed gameweek.</Text>
            </View>

            <View style={styles.simulateDensityBar}>
              <Text style={styles.simulateDensityLabel}>Density</Text>
              <View style={styles.simulateDensityToggle}>
                {(['comfortable', 'compact'] as const).map((mode) => (
                  <TouchableOpacity key={mode} style={[styles.simulateDensityOption, simulateDensity === mode ? styles.simulateDensityOptionActive : null]} onPress={() => setSimulateDensity(mode)}>
                    <Text style={[styles.simulateDensityText, simulateDensity === mode ? styles.simulateDensityTextActive : null]}>{mode === 'comfortable' ? 'Comfortable' : 'Compact'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.simulateStepCard}>
              <Text style={styles.simulateStepTitle}>1. Select Competition</Text>
              <TouchableOpacity style={styles.simulateDropdownButton} onPress={() => setSimulateCompetitionDropdownOpen((open) => !open)}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={selectedCompetition ? styles.simulateDropdownTitle : styles.simulateDropdownPlaceholder} numberOfLines={1}>{selectedCompetition?.name ?? 'Choose a competition...'}</Text>
                  {selectedCompetition ? <Text style={styles.simulateDropdownMeta}>{selectedCompetition.status} - {selectedCompetition.participantCount ?? 0} participants</Text> : null}
                </View>
                <Text style={styles.simulateDropdownChevron}>{simulateCompetitionDropdownOpen ? '^' : 'v'}</Text>
              </TouchableOpacity>
              {simulateCompetitionDropdownOpen ? (
                <View style={styles.simulateDropdownMenu}>{(competitionsQuery.data ?? []).map((c) => (
                  <TouchableOpacity key={c.id} style={[styles.simulateDropdownItem, selectedCompId === c.id ? styles.simulateDropdownItemActive : null]} onPress={() => { setSelectedCompId(c.id); setSelectedGwId(null); setFixtureResults({}); setSimulateCompetitionDropdownOpen(false); setSimulateGameweekDropdownOpen(false); }}>
                    <Text style={styles.simulateSelectTitle}>{c.name}</Text>
                    <Text style={styles.simulateSelectMeta}>{c.status} - {c.participantCount ?? 0} participants</Text>
                  </TouchableOpacity>
                ))}</View>
              ) : null}
            </View>

            {selectedCompId ? (
              <View style={styles.simulateStepCard}>
                <Text style={styles.simulateStepTitle}>2. Select Gameweek</Text>
                {gameweeksQuery.isLoading ? <MetaText>Loading gameweeks...</MetaText> : null}
                {!gameweeksQuery.isLoading && (gameweeksQuery.data ?? []).length === 0 ? <MetaText>No gameweeks found for this competition.</MetaText> : null}
                {!gameweeksQuery.isLoading && (gameweeksQuery.data ?? []).length > 0 ? (
                  <>
                    <TouchableOpacity style={styles.simulateDropdownButton} onPress={() => setSimulateGameweekDropdownOpen((open) => !open)}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={selectedGameweek ? styles.simulateDropdownTitle : styles.simulateDropdownPlaceholder} numberOfLines={1}>{selectedGameweek ? `GW${selectedGameweek.weekNumber} - ${selectedGameweek.status}` : 'Choose a gameweek...'}</Text>
                        {selectedGameweek ? <Text style={styles.simulateDropdownMeta}>{(selectedGameweek.fixtures ?? []).length} fixtures - Locks: {formatAdminDate(selectedGameweek.lockAt)}</Text> : null}
                      </View>
                      <Text style={styles.simulateDropdownChevron}>{simulateGameweekDropdownOpen ? '^' : 'v'}</Text>
                    </TouchableOpacity>
                    {simulateGameweekDropdownOpen ? (
                      <View style={styles.simulateDropdownMenu}>{(gameweeksQuery.data ?? []).map((gw) => (
                        <TouchableOpacity key={gw.id} style={[styles.simulateDropdownItem, selectedGwId === gw.id ? styles.simulateDropdownItemActive : null]} onPress={() => { setSelectedGwId(gw.id); setFixtureResults(existingFixtureDrafts(gw)); setSimulateGameweekDropdownOpen(false); }}>
                          <Text style={styles.simulateSelectTitle}>GW{gw.weekNumber} - {gw.status}</Text>
                          <Text style={styles.simulateSelectMeta}>{(gw.fixtures ?? []).length} fixtures - Locks: {formatAdminDate(gw.lockAt)}</Text>
                        </TouchableOpacity>
                      ))}</View>
                    ) : null}
                  </>
                ) : null}
              </View>
            ) : null}

            {selectedGameweek ? (
              <View style={styles.simulateStepCard}>
                <View style={styles.simulateFixtureHeader}>
                  <Text style={styles.simulateStepTitle}>3. {isCorrectionMode ? 'Correct' : 'Set'} Fixture Results for GW{selectedGameweek.weekNumber}</Text>
                  <StatusPill text={selectedGameweek.status} tone={selectedGameweek.status === 'COMPLETED' ? 'success' : selectedGameweek.status === 'LOCKED' ? 'brand' : 'warn'} />
                </View>
                <View style={styles.simulateBulkActions}>
                  {!isCorrectionMode ? (
                    <>
                      <TouchableOpacity style={styles.simulateSecondaryBtn} onPress={randomiseAllFixtures}><Text style={styles.simulateSecondaryText}>Randomise All</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.simulatePrimaryBtn} onPress={() => bulkSimulateResult.mutate()} disabled={bulkSimulateResult.isPending}><Text style={styles.simulatePrimaryText}>{bulkSimulateResult.isPending ? 'Processing...' : 'Randomise & Process All'}</Text></TouchableOpacity>
                    </>
                  ) : null}
                  <TouchableOpacity style={styles.simulateGhostBtn} onPress={() => setFixtureResults(isCorrectionMode ? existingFixtureDrafts(selectedGameweek) : {})}><Text style={styles.simulateGhostText}>{isCorrectionMode ? 'Reset Changes' : 'Clear All'}</Text></TouchableOpacity>
                </View>

                {isCorrectionMode ? (
                  <View style={styles.simulateWarningPanel}>
                    <Text style={styles.simulateWarningTitle}>Correct completed result</Text>
                    <Text style={styles.simulateWarningText}>This recalculates picks, eliminations, winner and lifeline usage. It is allowed only before a later gameweek starts.</Text>
                  </View>
                ) : null}

                {(selectedGameweek.fixtures ?? []).length === 0 ? <MetaText>No fixtures in this gameweek.</MetaText> : null}
                {(selectedGameweek.fixtures ?? []).map((fixture) => {
                  const result = fixtureResults[fixture.id] ?? { status: '', scoreHome: '', scoreAway: '' };
                  const hasResult = Boolean(result.status || result.scoreHome || result.scoreAway);
                  return (
                    <View key={fixture.id} style={[styles.simulateFixtureCard, hasResult ? styles.simulateFixtureCardActive : null, simulateDensity === 'compact' ? styles.simulateFixtureCardCompact : null]}>
                      <View style={styles.simulateFixtureTop}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.simulateFixtureTeams, simulateDensity === 'compact' ? styles.simulateFixtureTeamsCompact : null]} numberOfLines={simulateDensity === 'compact' ? 1 : 2}>{fixture.homeTeamName} {hasResult && result.status === 'FINISHED' ? `${result.scoreHome || 0} - ${result.scoreAway || 0}` : 'vs'} {fixture.awayTeamName}</Text>
                          {simulateDensity === 'comfortable' || hasResult || fixture.hasOverride ? <Text style={styles.simulateFixtureTime}>{formatAdminDate(fixture.kickoffAt)}{fixture.hasOverride ? ' - Override' : ''}</Text> : null}
                        </View>
                      </View>
                      <View style={[styles.simulateQuickActions, simulateDensity === 'compact' ? styles.simulateQuickActionsCompact : null]}>
                        <TouchableOpacity style={[styles.simulateQuickBtn, simulateDensity === 'compact' ? styles.simulateQuickBtnCompact : null]} onPress={() => setHomeWin(fixture)}><Text style={styles.simulateQuickText}>{simulateDensity === 'compact' ? fixture.homeTeamShortName : `${fixture.homeTeamShortName} Win`}</Text></TouchableOpacity>
                        <TouchableOpacity style={[styles.simulateQuickBtnNeutral, simulateDensity === 'compact' ? styles.simulateQuickBtnCompact : null]} onPress={() => setDraw(fixture)}><Text style={styles.simulateQuickTextNeutral}>Draw</Text></TouchableOpacity>
                        <TouchableOpacity style={[styles.simulateQuickBtn, simulateDensity === 'compact' ? styles.simulateQuickBtnCompact : null]} onPress={() => setAwayWin(fixture)}><Text style={styles.simulateQuickText}>{simulateDensity === 'compact' ? fixture.awayTeamShortName : `${fixture.awayTeamShortName} Win`}</Text></TouchableOpacity>
                        <TouchableOpacity style={[styles.simulateQuickBtnWarn, simulateDensity === 'compact' ? styles.simulateQuickBtnCompact : null]} onPress={() => setPostponed(fixture)}><Text style={styles.simulateQuickTextWarn}>{simulateDensity === 'compact' ? 'PP' : 'Postpone'}</Text></TouchableOpacity>
                        <TouchableOpacity style={[styles.simulateQuickBtnBrand, simulateDensity === 'compact' ? styles.simulateQuickBtnCompact : null]} onPress={() => randomiseFixture(fixture)}><Text style={styles.simulateQuickTextBrand}>{simulateDensity === 'compact' ? 'Rnd' : 'Random'}</Text></TouchableOpacity>
                      </View>
                      {simulateDensity === 'comfortable' || hasResult ? (
                      <View style={styles.simulateManualGrid}>
                        <View style={styles.simulateManualField}>
                          <Text style={styles.fieldLabelSmall}>Status</Text>
                          <View style={styles.simulateStatusRow}>{(['', 'FINISHED', 'POSTPONED', 'CANCELLED'] as const).map((status) => (
                            <TouchableOpacity key={status || 'blank'} style={[styles.simulateStatusPill, result.status === status ? styles.simulateStatusPillActive : null]} onPress={() => setFixtureResult(fixture.id, 'status', status)}>
                              <Text style={[styles.simulateStatusPillText, result.status === status ? styles.simulateStatusPillTextActive : null]}>{status || '-'}</Text>
                            </TouchableOpacity>
                          ))}</View>
                        </View>
                        <View style={styles.twoCol}>
                          <TextInput value={result.scoreHome} onChangeText={(value) => setFixtureResult(fixture.id, 'scoreHome', value)} keyboardType="number-pad" placeholder="Home" placeholderTextColor={colors.textMuted} style={[styles.input, styles.half]} />
                          <TextInput value={result.scoreAway} onChangeText={(value) => setFixtureResult(fixture.id, 'scoreAway', value)} keyboardType="number-pad" placeholder="Away" placeholderTextColor={colors.textMuted} style={[styles.input, styles.half]} />
                        </View>
                      </View>
                      ) : null}
                    </View>
                  );
                })}

                {(selectedGameweek.fixtures ?? []).length > 0 ? (
                  <View style={styles.simulateSubmitArea}>
                    {!isCorrectionMode && selectedCompetition && (selectedCompetition.participantCount ?? 0) > 1 ? (
                      <View style={styles.simulateWarningPanel}>
                        <Text style={styles.simulateWarningTitle}>Auto-Completion Behavior</Text>
                        <Text style={styles.simulateWarningText}>Competitions automatically end when only 1 participant remains or all are eliminated. Current participants: {selectedCompetition.participantCount}{selectedCompetition.activeCount !== selectedCompetition.participantCount ? ` (${selectedCompetition.activeCount} active)` : ''}.</Text>
                      </View>
                    ) : null}
                    {!isCorrectionMode ? (
                      <TouchableOpacity style={styles.simulateCheckboxRow} onPress={() => setSkipAutoComplete((value) => !value)}>
                        <View style={[styles.simulateCheckbox, skipAutoComplete ? styles.simulateCheckboxActive : null]}><Text style={styles.simulateCheckboxMark}>{skipAutoComplete ? 'x' : ''}</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.simulateCheckboxTitle}>Skip auto-complete</Text>
                          <Text style={styles.simulateCheckboxHelp}>Use this to test multiple gameweeks in sequence.</Text>
                        </View>
                      </TouchableOpacity>
                    ) : null}
                    <PrimaryButton label={simulateResult.isPending ? 'Processing...' : isCorrectionMode ? 'Save Correction & Reprocess' : 'Process Results & Eliminate Participants'} onPress={() => simulateResult.mutate()} disabled={simulateResult.isPending || !hasFixtureResults} />
                    {!hasFixtureResults ? <Text style={styles.simulateNeedResult}>Set at least one fixture result to continue</Text> : null}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.simulateInfoCard}>
              <Text style={styles.simulateInfoTitle}>How it works</Text>
              <Text style={styles.simulateInfoText}>Select a competition and gameweek, use quick buttons or manual scores, then process results to apply overrides and resolve eliminations.</Text>
            </View>
          </View>
        )}

        {tab === 'testdata' && (
          <View style={styles.testDataRoot}>
            {(generateTestData.isPending || cleanupTestData.isPending) ? <AdminActionNotice tone="info" title={generateTestData.isPending ? 'Generating test data' : 'Cleaning up test data'} message={activeOperation?.message ?? 'Working on test data...'} busy /> : null}
            <View style={styles.testDataIntro}>
              <Text style={styles.sectionHeading}>Generate Test Data</Text>
              <Text style={styles.sectionDescription}>Create hundreds of test users to test UI scaling and performance.</Text>
            </View>

            <View style={styles.testDataCard}>
              <Text style={styles.simulateStepTitle}>1. Generate Test Users</Text>
              <Text style={styles.fieldLabel}>Select Competition</Text>
              <TouchableOpacity style={styles.simulateDropdownButton} onPress={() => setTestDataCompetitionDropdownOpen((open) => !open)}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={selectedTestDataCompetition ? styles.simulateDropdownTitle : styles.simulateDropdownPlaceholder} numberOfLines={1}>{selectedTestDataCompetition?.name ?? 'Choose a competition...'}</Text>
                  {selectedTestDataCompetition ? <Text style={styles.simulateDropdownMeta}>{selectedTestDataCompetition.status} - {selectedTestDataCompetition.participantCount ?? 0} participants</Text> : null}
                </View>
                <Text style={styles.simulateDropdownChevron}>{testDataCompetitionDropdownOpen ? '^' : 'v'}</Text>
              </TouchableOpacity>
              {testDataCompetitionDropdownOpen ? (
                <View style={styles.simulateDropdownMenu}>{(competitionsQuery.data ?? []).map((c) => (
                  <TouchableOpacity key={c.id} style={[styles.simulateDropdownItem, testDataCompetitionId === c.id ? styles.simulateDropdownItemActive : null]} onPress={() => { setTestDataCompetitionId(c.id); setTestDataCompetitionDropdownOpen(false); }}>
                    <Text style={styles.simulateSelectTitle}>{c.name}</Text>
                    <Text style={styles.simulateSelectMeta}>{c.status} - {c.participantCount ?? 0} participants</Text>
                  </TouchableOpacity>
                ))}</View>
              ) : null}

              <Text style={styles.fieldLabel}>Number of Test Users</Text>
              <TextInput value={testDataUserCount} onChangeText={setTestDataUserCount} keyboardType="number-pad" placeholder="100" placeholderTextColor={colors.textMuted} style={styles.input} />
              <Text style={styles.fieldHelp}>Recommended: 50-200 for testing. Higher numbers may take longer to generate.</Text>

              <Text style={styles.fieldLabel}>Gameweeks to Seed Picks</Text>
              <TextInput value={testDataGameweeks} onChangeText={setTestDataGameweeks} placeholder="e.g. 1-8 or 1-4,7,9" placeholderTextColor={colors.textMuted} style={styles.input} />
              <Text style={styles.fieldHelp}>Creates random picks for these gameweeks. Supports ranges like 1-8, comma lists like 1,3,5, or mixed 1-4,7,9.</Text>

              <View style={styles.testDataInfoCard}>
                <Text style={styles.testDataInfoTitle}>What this does</Text>
                <Text style={styles.testDataInfoText}>Creates {Number(testDataUserCount || '0')} users named testuser001, testuser002, etc.</Text>
                <Text style={styles.testDataInfoText}>All users use password: password123.</Text>
                <Text style={styles.testDataInfoText}>Joins users to the selected competition and creates random picks for the selected gameweeks/ranges.</Text>
              </View>

              <PrimaryButton label={generateTestData.isPending ? `Generating ${testDataUserCount || '0'} users...` : `Generate ${testDataUserCount || '0'} Test Users`} onPress={() => generateTestData.mutate()} disabled={!testDataCompetitionId || generateTestData.isPending || Number(testDataUserCount || '0') < 1} />
            </View>

            <View style={styles.testDataDangerCard}>
              <Text style={styles.testDataDangerTitle}>2. Cleanup Test Users</Text>
              <Text style={styles.sectionDescription}>Remove all test users and their associated picks and participations.</Text>
              <View style={styles.testDataWarningCard}>
                <Text style={styles.testDataWarningText}>Warning: this permanently deletes all users with usernames starting with testuser and all their competition data.</Text>
              </View>
              <TouchableOpacity style={styles.delBtnWide} onPress={() => setConfirmDialog({ title: 'Delete All Test Users?', message: 'All users with usernames starting with testuser and all their data will be permanently removed.', items: ['All testuser accounts deleted', 'All their picks and results deleted', 'All their competition participations removed'], confirmText: 'Yes, Delete All', onConfirm: () => cleanupTestData.mutateAsync() })} disabled={cleanupTestData.isPending}>
                <Text style={styles.delBtnText}>{cleanupTestData.isPending ? 'Cleaning up...' : 'Delete All Test Users'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.testDataScalingCard}>
              <Text style={styles.testDataScalingTitle}>How to test scaling</Text>
              <Text style={styles.testDataInfoText}>1. Select a competition.</Text>
              <Text style={styles.testDataInfoText}>2. Set user count to 100-200.</Text>
              <Text style={styles.testDataInfoText}>3. Set gameweeks to 3,4,5.</Text>
              <Text style={styles.testDataInfoText}>4. Generate users, then simulate a gameweek and review results/table performance.</Text>
              <Text style={styles.testDataInfoText}>5. Cleanup test users when finished.</Text>
            </View>
          </View>
        )}

        {tab === 'audit' && (
          <View style={styles.auditRoot}>
            <View style={styles.auditIntro}>
              <Text style={styles.sectionEyebrow}>Traceability</Text>
              <Text style={styles.sectionHeading}>Audit Log</Text>
              <Text style={styles.sectionDescription}>Review who changed what, when it happened, and how entity values moved over time.</Text>
            </View>

            <View style={styles.auditFilterCard}>
              <Text style={styles.fieldLabel}>Search</Text>
              <TextInput value={auditSearch} onChangeText={(value) => { setAuditSearch(value); setAuditPage(0); }} placeholder="Search admin, action, entity, field, values" placeholderTextColor={colors.textMuted} style={styles.input} autoCapitalize="none" />

              <Text style={styles.fieldLabel}>Action</Text>
              <TouchableOpacity style={styles.simulateDropdownButton} onPress={() => setAuditDropdownOpen((open) => open === 'action' ? null : 'action')}>
                <Text style={auditActionFilter === 'all' ? styles.simulateDropdownPlaceholder : styles.simulateDropdownTitle}>{auditActionFilter === 'all' ? 'All actions' : auditActionFilter}</Text>
                <Text style={styles.simulateDropdownChevron}>{auditDropdownOpen === 'action' ? '^' : 'v'}</Text>
              </TouchableOpacity>
              {auditDropdownOpen === 'action' ? <View style={styles.simulateDropdownMenu}><TouchableOpacity style={[styles.simulateDropdownItem, auditActionFilter === 'all' ? styles.simulateDropdownItemActive : null]} onPress={() => { setAuditFilterAndResetPage(setAuditActionFilter, 'all'); setAuditDropdownOpen(null); }}><Text style={styles.simulateSelectTitle}>All actions</Text></TouchableOpacity>{auditActions.map((action) => <TouchableOpacity key={action} style={[styles.simulateDropdownItem, auditActionFilter === action ? styles.simulateDropdownItemActive : null]} onPress={() => { setAuditFilterAndResetPage(setAuditActionFilter, action); setAuditDropdownOpen(null); }}><Text style={styles.simulateSelectTitle}>{action}</Text></TouchableOpacity>)}</View> : null}

              <Text style={styles.fieldLabel}>Entity</Text>
              <TouchableOpacity style={styles.simulateDropdownButton} onPress={() => setAuditDropdownOpen((open) => open === 'entity' ? null : 'entity')}>
                <Text style={auditEntityFilter === 'all' ? styles.simulateDropdownPlaceholder : styles.simulateDropdownTitle}>{auditEntityFilter === 'all' ? 'All entities' : auditEntityFilter}</Text>
                <Text style={styles.simulateDropdownChevron}>{auditDropdownOpen === 'entity' ? '^' : 'v'}</Text>
              </TouchableOpacity>
              {auditDropdownOpen === 'entity' ? <View style={styles.simulateDropdownMenu}><TouchableOpacity style={[styles.simulateDropdownItem, auditEntityFilter === 'all' ? styles.simulateDropdownItemActive : null]} onPress={() => { setAuditFilterAndResetPage(setAuditEntityFilter, 'all'); setAuditDropdownOpen(null); }}><Text style={styles.simulateSelectTitle}>All entities</Text></TouchableOpacity>{auditEntities.map((entity) => <TouchableOpacity key={entity} style={[styles.simulateDropdownItem, auditEntityFilter === entity ? styles.simulateDropdownItemActive : null]} onPress={() => { setAuditFilterAndResetPage(setAuditEntityFilter, entity); setAuditDropdownOpen(null); }}><Text style={styles.simulateSelectTitle}>{entity}</Text></TouchableOpacity>)}</View> : null}

              <Text style={styles.fieldLabel}>Admin</Text>
              <TouchableOpacity style={styles.simulateDropdownButton} onPress={() => setAuditDropdownOpen((open) => open === 'admin' ? null : 'admin')}>
                <Text style={auditAdminFilter === 'all' ? styles.simulateDropdownPlaceholder : styles.simulateDropdownTitle}>{auditAdminFilter === 'all' ? 'All admins' : auditAdminFilter}</Text>
                <Text style={styles.simulateDropdownChevron}>{auditDropdownOpen === 'admin' ? '^' : 'v'}</Text>
              </TouchableOpacity>
              {auditDropdownOpen === 'admin' ? <View style={styles.simulateDropdownMenu}><TouchableOpacity style={[styles.simulateDropdownItem, auditAdminFilter === 'all' ? styles.simulateDropdownItemActive : null]} onPress={() => { setAuditFilterAndResetPage(setAuditAdminFilter, 'all'); setAuditDropdownOpen(null); }}><Text style={styles.simulateSelectTitle}>All admins</Text></TouchableOpacity>{auditAdmins.map((admin) => <TouchableOpacity key={admin} style={[styles.simulateDropdownItem, auditAdminFilter === admin ? styles.simulateDropdownItemActive : null]} onPress={() => { setAuditFilterAndResetPage(setAuditAdminFilter, admin); setAuditDropdownOpen(null); }}><Text style={styles.simulateSelectTitle}>{admin}</Text></TouchableOpacity>)}</View> : null}

              <Text style={styles.fieldLabel}>Field</Text>
              <TouchableOpacity style={styles.simulateDropdownButton} onPress={() => setAuditDropdownOpen((open) => open === 'field' ? null : 'field')}>
                <Text style={auditFieldFilter === 'all' ? styles.simulateDropdownPlaceholder : styles.simulateDropdownTitle}>{auditFieldFilter === 'all' ? 'All fields' : auditFieldFilter}</Text>
                <Text style={styles.simulateDropdownChevron}>{auditDropdownOpen === 'field' ? '^' : 'v'}</Text>
              </TouchableOpacity>
              {auditDropdownOpen === 'field' ? <View style={styles.simulateDropdownMenu}><TouchableOpacity style={[styles.simulateDropdownItem, auditFieldFilter === 'all' ? styles.simulateDropdownItemActive : null]} onPress={() => { setAuditFilterAndResetPage(setAuditFieldFilter, 'all'); setAuditDropdownOpen(null); }}><Text style={styles.simulateSelectTitle}>All fields</Text></TouchableOpacity>{auditFields.map((field) => <TouchableOpacity key={field} style={[styles.simulateDropdownItem, auditFieldFilter === field ? styles.simulateDropdownItemActive : null]} onPress={() => { setAuditFilterAndResetPage(setAuditFieldFilter, field); setAuditDropdownOpen(null); }}><Text style={styles.simulateSelectTitle}>{field}</Text></TouchableOpacity>)}</View> : null}

              <View style={styles.twoCol}>
                <TextInput value={auditEntityIdFilter} onChangeText={(value) => { setAuditEntityIdFilter(value); setAuditPage(0); }} placeholder="Entity ID" keyboardType="number-pad" placeholderTextColor={colors.textMuted} style={[styles.input, styles.half]} />
                <TextInput value={String(auditPageSize)} onChangeText={(value) => { setAuditPageSize(Math.max(1, Math.min(100, Number(value || '50')))); setAuditPage(0); }} placeholder="Page size" keyboardType="number-pad" placeholderTextColor={colors.textMuted} style={[styles.input, styles.half]} />
              </View>
              <View style={styles.twoCol}>
                <TextInput value={auditDateFrom} onChangeText={(value) => { setAuditDateFrom(value); setAuditPage(0); }} placeholder="From YYYY-MM-DD" placeholderTextColor={colors.textMuted} style={[styles.input, styles.half]} />
                <TextInput value={auditDateTo} onChangeText={(value) => { setAuditDateTo(value); setAuditPage(0); }} placeholder="To YYYY-MM-DD" placeholderTextColor={colors.textMuted} style={[styles.input, styles.half]} />
              </View>

              <View style={styles.auditToolbar}>
                <Text style={styles.auditCount}>{auditTotalElements} entries</Text>
                <View style={styles.auditDensityToggle}>{(['comfortable', 'compact'] as const).map((mode) => (
                  <TouchableOpacity key={mode} style={[styles.simulateDensityOption, auditDensity === mode ? styles.simulateDensityOptionActive : null]} onPress={() => setAuditDensity(mode)}><Text style={[styles.simulateDensityText, auditDensity === mode ? styles.simulateDensityTextActive : null]}>{mode}</Text></TouchableOpacity>
                ))}</View>
              </View>
              {auditActiveFilters.length > 0 ? <View style={styles.auditActiveFilters}>{auditActiveFilters.map((filter) => <Text key={filter} style={styles.auditActiveFilter}>{filter}</Text>)}<TouchableOpacity onPress={clearAuditFilters}><Text style={styles.auditClearText}>Clear all</Text></TouchableOpacity></View> : null}
              <PrimaryButton label={auditQuery.isFetching ? 'Loading...' : 'Reload Audit'} onPress={() => auditQuery.refetch()} />
            </View>

            <View style={styles.auditListCard}>
              {auditQuery.isLoading ? <MetaText>Loading audit log...</MetaText> : null}
              {!auditQuery.isLoading && filteredAuditLogs.length === 0 ? <MetaText>No audit entries yet</MetaText> : null}
              {filteredAuditLogs.map((log, idx) => (
                <View key={`${log.id ?? idx}-${String(log.createdAt ?? '')}`} style={[styles.auditEventCard, auditDensity === 'compact' ? styles.auditEventCardCompact : null]}>
                  <View style={styles.auditEventTop}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.auditEventTime}>{formatAdminDate(log.createdAt)}</Text>
                      <Text style={styles.auditEventUser} numberOfLines={1}>{log.username ?? '-'}</Text>
                    </View>
                    <StatusPill text={log.action ?? 'ACTION'} tone="brand" />
                  </View>
                  <View style={styles.auditEventGrid}>
                    <View style={styles.auditEventCell}><Text style={styles.auditEventLabel}>Entity</Text><Text style={styles.auditEventValue}>{log.entityType ?? 'Entity'} #{log.entityId ?? '-'}</Text></View>
                    <View style={styles.auditEventCell}><Text style={styles.auditEventLabel}>Field</Text><Text style={styles.auditEventValue}>{log.fieldName ?? '-'}</Text></View>
                  </View>
                  {auditDensity === 'comfortable' || log.oldValue || log.newValue ? (
                    <Text style={styles.auditChangeText}><Text style={styles.auditOldValue}>{log.oldValue ?? '-'}</Text>{' -> '}<Text style={styles.auditNewValue}>{log.newValue ?? '-'}</Text></Text>
                  ) : null}
                </View>
              ))}
            </View>

            <View style={styles.auditPaginationCard}>
              <Text style={styles.auditPageText}>Page {auditCurrentPage + 1} of {auditTotalPages}</Text>
              <View style={styles.auditPaginationActions}>
                <TouchableOpacity style={[styles.auditPageButton, auditCurrentPage <= 0 ? styles.auditPageButtonDisabled : null]} onPress={() => setAuditPage(0)} disabled={auditCurrentPage <= 0}><Text style={styles.auditPageButtonText}>First</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.auditPageButton, auditCurrentPage <= 0 ? styles.auditPageButtonDisabled : null]} onPress={() => setAuditPage((page) => Math.max(page - 1, 0))} disabled={auditCurrentPage <= 0}><Text style={styles.auditPageButtonText}>Previous</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.auditPageButton, auditCurrentPage >= auditTotalPages - 1 ? styles.auditPageButtonDisabled : null]} onPress={() => setAuditPage((page) => Math.min(page + 1, auditTotalPages - 1))} disabled={auditCurrentPage >= auditTotalPages - 1}><Text style={styles.auditPageButtonText}>Next</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.auditPageButton, auditCurrentPage >= auditTotalPages - 1 ? styles.auditPageButtonDisabled : null]} onPress={() => setAuditPage(Math.max(auditTotalPages - 1, 0))} disabled={auditCurrentPage >= auditTotalPages - 1}><Text style={styles.auditPageButtonText}>Last</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {(operationInProgress || opStatus) ? (
        <View style={styles.operationToast}>
          {operationInProgress ? (
            <AdminActionNotice
              tone={visibleStatus?.tone ?? 'info'}
              title="Action in progress"
              message={visibleStatus?.message ?? 'Working...'}
              busy
              compact
            />
          ) : (
            <TouchableOpacity activeOpacity={0.9} onPress={() => setOpStatus(null)}>
              <AdminActionNotice
                tone={visibleStatus?.tone ?? 'info'}
                title={visibleStatus?.tone === 'error' ? 'Action failed' : 'Action complete'}
                message={`${visibleStatus?.message ?? 'Done.'} Tap to dismiss.`}
                compact
              />
            </TouchableOpacity>
          )}
        </View>
      ) : null}

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
              <TouchableOpacity style={[styles.confirmCancelButton, confirmBusy ? styles.actionBtnDisabled : null]} onPress={() => setConfirmDialog(null)} disabled={confirmBusy}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmDeleteButton, confirmBusy ? styles.actionBtnDisabled : null]} onPress={runConfirmedAction} disabled={confirmBusy}>
                <Text style={styles.confirmDeleteText}>{confirmBusy ? 'Working...' : confirmDialog?.confirmText ?? 'Confirm'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showUserModal} animationType="slide" transparent onRequestClose={() => { setShowUserModal(false); setUserFormErrors({}); }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Add User</Text>
                <Text style={styles.modalSubtitle}>Create an account and choose the initial platform role.</Text>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => { setShowUserModal(false); setUserFormErrors({}); }}>
                <Text style={styles.modalCloseText}>X</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <View style={styles.modalSection}>
                <Text style={styles.fieldLabel}>Email *</Text>
                <TextInput value={newUserEmail} onChangeText={(value) => { setNewUserEmail(value); if (userFormErrors.email) setUserFormErrors((current) => ({ ...current, email: undefined })); }} placeholder="Email" placeholderTextColor={colors.textMuted} style={[styles.input, userFormErrors.email ? styles.inputError : null]} autoCapitalize="none" keyboardType="email-address" />
                {userFormErrors.email ? <Text style={styles.fieldErrorText}>{userFormErrors.email}</Text> : null}
                <Text style={styles.fieldLabel}>Username *</Text>
                <TextInput value={newUserName} onChangeText={(value) => { setNewUserName(value); if (userFormErrors.username) setUserFormErrors((current) => ({ ...current, username: undefined })); }} placeholder="Username" placeholderTextColor={colors.textMuted} style={[styles.input, userFormErrors.username ? styles.inputError : null]} autoCapitalize="none" />
                {userFormErrors.username ? <Text style={styles.fieldErrorText}>{userFormErrors.username}</Text> : null}
                <Text style={styles.fieldLabel}>Password *</Text>
                <TextInput value={newUserPassword} onChangeText={(value) => { setNewUserPassword(value); if (userFormErrors.password) setUserFormErrors((current) => ({ ...current, password: undefined })); }} placeholder="Password" placeholderTextColor={colors.textMuted} style={[styles.input, userFormErrors.password ? styles.inputError : null]} secureTextEntry />
                {userFormErrors.password ? <Text style={styles.fieldErrorText}>{userFormErrors.password}</Text> : null}
              </View>
              <View style={styles.modalSection}>
                <Text style={styles.fieldLabel}>Role</Text>
                <View style={styles.userRolePicker}>
                  {(['USER', 'CLUB_ADMIN', 'ADMIN'] as const).map((role) => (
                    <TouchableOpacity key={role} style={[styles.userRoleBtn, newUserRole === role ? styles.userRoleBtnActive : null]} onPress={() => setNewUserRole(role)}>
                      <Text style={[styles.userRoleBtnText, newUserRole === role ? styles.userRoleBtnTextActive : null]}>{role}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancelButton} onPress={() => { setShowUserModal(false); setUserFormErrors({}); }}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSaveButton} onPress={submitUserForm} disabled={createUser.isPending}>
                  <Text style={styles.modalSaveText}>{createUser.isPending ? 'Creating...' : 'Create User'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showClubModal} animationType="slide" transparent onRequestClose={() => setShowClubModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Onboard New Club</Text>
                <Text style={styles.modalSubtitle}>Create a club and optionally assign a club admin to manage its competitions.</Text>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowClubModal(false)}>
                <Text style={styles.modalCloseText}>X</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <View style={styles.modalSection}>
                <Text style={styles.fieldLabel}>Club Name *</Text>
                <TextInput value={clubName} onChangeText={(value) => { setClubName(value); if (clubFormErrors.name) setClubFormErrors({}); }} placeholder="Club name" placeholderTextColor={colors.textMuted} style={[styles.input, clubFormErrors.name ? styles.inputError : null]} />
                {clubFormErrors.name ? <Text style={styles.fieldErrorText}>{clubFormErrors.name}</Text> : null}
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput value={clubDescription} onChangeText={setClubDescription} placeholder="Optional" placeholderTextColor={colors.textMuted} style={styles.input} />
              </View>
              <View style={styles.modalSection}>
                <Text style={styles.fieldLabel}>Assign Club Admin</Text>
                <Text style={styles.fieldHelp}>Search by username or email. This user will manage the club's competitions.</Text>
                <TextInput value={clubAdminSearch} onChangeText={(value) => { setClubAdminSearch(value); setClubAdminUserId(''); }} placeholder="Type at least 2 characters..." placeholderTextColor={colors.textMuted} style={styles.input} autoCapitalize="none" />
                <TouchableOpacity style={[styles.optionCard, !clubAdminUserId ? styles.optionCardActive : null]} onPress={() => { setClubAdminUserId(''); setClubAdminSearch(''); }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>No admin yet</Text>
                    <Text style={styles.optionDesc}>Create the club and assign ownership later.</Text>
                  </View>
                </TouchableOpacity>
                {selectedClubAdmin ? (
                  <View style={styles.selectedAdminBox}>
                    <Text style={styles.selectedAdminLabel}>Selected admin</Text>
                    <Text style={styles.selectedAdminName}>{selectedClubAdmin.username}</Text>
                    <Text style={styles.selectedAdminEmail}>{selectedClubAdmin.email}</Text>
                  </View>
                ) : null}
                {clubAdminSearch.trim().length > 0 && clubAdminSearch.trim().length < 2 ? <MetaText>Type at least 2 characters to search.</MetaText> : null}
                {clubAdminSearch.trim().length >= 2 && filteredClubAdminOptions.length === 0 ? <MetaText>No matching users found.</MetaText> : null}
                {filteredClubAdminOptions.map((admin) => (
                  <TouchableOpacity key={admin.id} style={[styles.typeaheadOption, clubAdminUserId === String(admin.id) ? styles.optionCardActive : null]} onPress={() => { setClubAdminUserId(String(admin.id)); setClubAdminSearch(admin.username); }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionTitle}>{admin.username}</Text>
                      <Text style={styles.optionDesc}>{admin.email}{admin.role === 'CLUB_ADMIN' ? ' · already a Club Admin' : ''}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
                {clubAdminUserId ? <Text style={styles.warnHelp}>This user will be promoted to Club Admin automatically.</Text> : null}
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancelButton} onPress={() => setShowClubModal(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSaveButton} onPress={submitClubForm} disabled={createClub.isPending}>
                  <Text style={styles.modalSaveText}>{createClub.isPending ? 'Creating...' : 'Create Club'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={assigningClub !== null} animationType="slide" transparent onRequestClose={() => { setAssigningClub(null); setAssignUserId(''); }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Assign Admin</Text>
                <Text style={styles.modalSubtitle}>{assigningClub ? `Choose a club admin for "${assigningClub.name}".` : 'Choose a club admin.'}</Text>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => { setAssigningClub(null); setAssignUserId(''); }}>
                <Text style={styles.modalCloseText}>X</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <View style={styles.modalSection}>
                <Text style={styles.fieldLabel}>Club Admin</Text>
                <TextInput value={assignAdminSearch} onChangeText={(value) => { setAssignAdminSearch(value); setAssignUserId(''); }} placeholder="Search users..." placeholderTextColor={colors.textMuted} style={styles.input} autoCapitalize="none" />
                {selectedAssignAdmin ? (
                  <View style={styles.selectedAdminBox}>
                    <Text style={styles.selectedAdminLabel}>Selected admin</Text>
                    <Text style={styles.selectedAdminName}>{selectedAssignAdmin.username}</Text>
                    <Text style={styles.selectedAdminEmail}>{selectedAssignAdmin.email}</Text>
                  </View>
                ) : null}
                {assignAdminSearch.trim().length > 0 && assignAdminSearch.trim().length < 2 ? <MetaText>Type at least 2 characters to search.</MetaText> : null}
                {assignAdminSearch.trim().length >= 2 && filteredAssignAdminOptions.length === 0 ? <MetaText>No matching users found.</MetaText> : null}
                {filteredAssignAdminOptions.map((admin) => (
                  <TouchableOpacity key={admin.id} style={[styles.typeaheadOption, assignUserId === String(admin.id) ? styles.optionCardActive : null]} onPress={() => { setAssignUserId(String(admin.id)); setAssignAdminSearch(admin.username); }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionTitle}>{admin.username}</Text>
                      <Text style={styles.optionDesc}>{admin.email}{admin.role === 'CLUB_ADMIN' ? ' · Club Admin' : ''}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
                {eligibleClubAdmins.length === 0 ? <MetaText>No eligible users found.</MetaText> : null}
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancelButton} onPress={() => { setAssigningClub(null); setAssignUserId(''); }}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSaveButton} onPress={() => assigningClub && assignClubAdmin.mutate({ clubId: assigningClub.id, userId: Number(assignUserId) })} disabled={assignClubAdmin.isPending || !assigningClub || !assignUserId}>
                  <Text style={styles.modalSaveText}>{assignClubAdmin.isPending ? 'Assigning...' : 'Assign'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={competitionModalMode !== null} animationType="slide" transparent onRequestClose={closeCompetitionModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{competitionModalMode === 'create' ? 'New Competition' : 'Edit Competition'}</Text>
                <Text style={styles.modalSubtitle}>{competitionModalMode === 'create' ? 'Create and configure a competition from the admin dashboard.' : `Update competition #${editCompId ?? ''} settings.`}</Text>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={closeCompetitionModal}>
                <Text style={styles.modalCloseText}>X</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody}>
              <View style={styles.modalSection}>
                <Text style={styles.fieldLabel}>Name *</Text>
                <TextInput
                  value={competitionModalMode === 'create' ? compName : editName}
                  onChangeText={(value) => {
                    if (competitionModalMode === 'create') setCompName(value);
                    else setEditName(value);
                    clearCompetitionFieldError('name');
                  }}
                  placeholder="Competition name"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, competitionFormErrors.name ? styles.inputError : null]}
                />
                {competitionFormErrors.name ? <Text style={styles.fieldErrorText}>{competitionFormErrors.name}</Text> : null}
                <Text style={styles.fieldLabel}>Start Date *</Text>
                <TouchableOpacity style={[styles.datePickerButton, competitionFormErrors.startDate ? styles.inputError : null]} onPress={() => setShowStartDatePicker(true)}>
                  <Text style={editStartDate ? styles.datePickerValue : styles.datePickerPlaceholder}>{editStartDate || 'Select start date'}</Text>
                  <Text style={styles.datePickerIcon}>📅</Text>
                </TouchableOpacity>
                {showStartDatePicker ? (
                  <DateTimePicker
                    value={dateFromInput(editStartDate)}
                    mode="date"
                    display="default"
                    minimumDate={competitionModalMode === 'create' ? new Date() : undefined}
                    onChange={handleStartDateChange}
                  />
                ) : null}
                {competitionFormErrors.startDate ? <Text style={styles.fieldErrorText}>{competitionFormErrors.startDate}</Text> : null}
                <Text style={styles.fieldHelp}>The first gameweek starts from the next unstarted fixture week on or after this date.</Text>
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput value={editDescription} onChangeText={setEditDescription} placeholder="Optional description" placeholderTextColor={colors.textMuted} style={[styles.input, styles.textArea]} multiline />
              </View>

              <View style={styles.modalSection}>
                <Text style={styles.fieldLabel}>Visibility</Text>
                <View style={styles.optionGridTwo}>
                  {([
                    { value: 'PRIVATE', label: 'Private', icon: '🔐', desc: 'Hidden from browse. Join by code or invite link.' },
                    { value: 'PUBLIC', label: 'Public', icon: '🌍', desc: 'Visible in the main competitions list.' },
                  ] as const).map((option) => (
                    <TouchableOpacity key={option.value} style={[styles.optionCard, editVisibility === option.value ? styles.optionCardActive : null]} onPress={() => setEditVisibility(option.value)}>
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
                <View style={styles.optionGridThree}>
                  {([
                    { value: 'FREE', label: 'Free', icon: '🎉', desc: 'No entry fee' },
                    { value: 'MANUAL', label: 'Manual', icon: '💸', desc: 'Revolut / cash / bank transfer' },
                    { value: 'STRIPE', label: 'Online', icon: '💳', desc: 'Players pay by card via Stripe' },
                  ] as const).map((option) => (
                    <TouchableOpacity key={option.value} style={[styles.paymentOptionCard, editPaymentMode === option.value ? styles.optionCardActive : null]} onPress={() => { setEditPaymentMode(option.value); if (option.value === 'FREE') { setEditEntryFee('0'); setEditPassFeeToParticipant(false); } }}>
                      <Text style={styles.optionIcon}>{option.icon}</Text>
                      <Text style={styles.optionTitle}>{option.label}</Text>
                      <Text style={styles.optionDescCentered}>{option.desc}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {editPaymentMode === 'MANUAL' ? (
                  <View style={styles.warningPanel}>
                    <Text style={styles.warningText}>Players register themselves then pay directly. Confirm payment in the Participants panel.</Text>
                    <Text style={styles.fieldLabelSmall}>Manual Payment Policy</Text>
                    <View style={styles.optionGridTwo}>
                      {([
                        { value: 'STRICT', label: 'Strict', desc: 'Unpaid cannot pick and are removed at lock.' },
                        { value: 'LENIENT', label: 'Lenient', desc: 'Allow picks while still awaiting payment.' },
                      ] as const).map((option) => (
                        <TouchableOpacity key={option.value} style={[styles.optionCard, editManualPaymentPolicy === option.value ? styles.optionCardActive : null]} onPress={() => setEditManualPaymentPolicy(option.value)}>
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

              {editPaymentMode !== 'FREE' ? (
                <View style={styles.modalSection}>
                  <Text style={styles.fieldLabel}>Entry Fee (€)</Text>
                  <TextInput value={editEntryFee} onChangeText={setEditEntryFee} placeholder="0" keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} style={styles.input} />
                  <View style={styles.presetRow}>{[5, 10, 20, 50].map((value) => <TouchableOpacity key={value} style={[styles.presetBtn, editEntryFee === String(value) ? styles.presetBtnActive : null]} onPress={() => setEditEntryFee(String(value))}><Text style={[styles.presetText, editEntryFee === String(value) ? styles.presetTextActive : null]}>€{value}</Text></TouchableOpacity>)}</View>
                  {editPaymentMode === 'STRIPE' ? <FilterPill label={editPassFeeToParticipant ? 'Pass fee to participant: ON' : 'Pass fee to participant: OFF'} active={editPassFeeToParticipant} onPress={() => setEditPassFeeToParticipant((v) => !v)} /> : null}
                </View>
              ) : null}

              <View style={styles.modalSection}>
                <Text style={styles.fieldLabel}>Prize Pool (€) <Text style={styles.optionalText}>optional</Text></Text>
                <TextInput value={editPrizePool} onChangeText={setEditPrizePool} placeholder={editPaymentMode !== 'FREE' && editEntryFee ? 'e.g. 200' : 'Optional'} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} style={styles.input} />
                <View style={styles.presetRow}>{[50, 100, 200, 500].map((value) => <TouchableOpacity key={value} style={[styles.presetBtn, editPrizePool === String(value) ? styles.presetBtnActive : null]} onPress={() => setEditPrizePool(String(value))}><Text style={[styles.presetText, editPrizePool === String(value) ? styles.presetTextActive : null]}>€{value}</Text></TouchableOpacity>)}</View>
              </View>

              <View style={styles.modalSection}>
                <Text style={styles.fieldLabel}>Fixture Source</Text>
                <View style={styles.optionGridTwo}>
                  {([
                    { value: 'PL', label: 'Premier League', desc: 'Use Premier League fixture weeks.' },
                    { value: 'WC', label: 'World Cup', desc: 'Use World Cup fixture groups.' },
                  ] as const).map((option) => (
                    <TouchableOpacity key={option.value} style={[styles.optionCard, editFixtureCompetitionCode === option.value ? styles.optionCardActive : null]} onPress={() => setEditFixtureCompetitionCode(option.value)}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.optionTitle}>{option.label}</Text>
                        <Text style={styles.optionDesc}>{option.desc}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.modalSection}>
                <Text style={styles.fieldLabel}>Competition Rules</Text>
                <View style={styles.optionGridTwo}>
                  {([
                    { value: 'ELIMINATE', label: 'Eliminate missed picks', desc: 'No pick means the entry is out.' },
                    { value: 'ALLOW', label: 'Allow missed picks', desc: 'No pick does not immediately eliminate.' },
                  ] as const).map((option) => (
                    <TouchableOpacity key={option.value} style={[styles.optionCard, editMissedPickMode === option.value ? styles.optionCardActive : null]} onPress={() => setEditMissedPickMode(option.value)}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.optionTitle}>{option.label}</Text>
                        <Text style={styles.optionDesc}>{option.desc}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.tabWrap}>
                  <FilterPill label={editPostponedConsumesTeam ? 'Postponed consumes team' : 'Postponed does not consume'} active={editPostponedConsumesTeam} onPress={() => setEditPostponedConsumesTeam((v) => !v)} />
                  <FilterPill label={editLifelineEnabled ? 'Lifeline: ON' : 'Lifeline: OFF'} active={editLifelineEnabled} onPress={() => setEditLifelineEnabled((v) => !v)} />
                </View>
                <Text style={styles.fieldLabel}>Max Entries Per User</Text>
                <TextInput value={editMaxEntries} onChangeText={setEditMaxEntries} placeholder="1" keyboardType="number-pad" placeholderTextColor={colors.textMuted} style={styles.input} />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancelButton} onPress={closeCompetitionModal}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalSaveButton}
                  onPress={submitCompetitionForm}
                  disabled={competitionModalMode === 'create' ? createCompetition.isPending : updateCompetition.isPending}
                >
                  <Text style={styles.modalSaveText}>{competitionModalMode === 'create' ? (createCompetition.isPending ? 'Creating...' : 'Create Competition') : (updateCompetition.isPending ? 'Saving...' : 'Save Changes')}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}


type ParticipantStatusFilter = 'ALL' | 'ACTIVE' | 'ELIMINATED' | 'WINNER';

function formatParticipantDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function AdminActionNotice({ tone, title, message, busy = false, compact = false }: { tone: OpStatusTone; title: string; message: string; busy?: boolean; compact?: boolean }) {
  return (
    <View style={[
      styles.actionNotice,
      tone === 'success' ? styles.actionNoticeSuccess : tone === 'error' ? styles.actionNoticeError : styles.actionNoticeInfo,
      compact ? styles.actionNoticeCompact : null,
    ]}>
      <View style={styles.actionNoticeIcon}>
        {busy ? <ActivityIndicator size="small" color="#bae6fd" /> : <Text style={styles.actionNoticeIconText}>{tone === 'success' ? '✓' : tone === 'error' ? '!' : 'i'}</Text>}
      </View>
      <View style={styles.actionNoticeCopy}>
        <Text style={styles.actionNoticeTitle}>{title}</Text>
        <Text style={styles.actionNoticeMessage}>{message}</Text>
      </View>
    </View>
  );
}

function AdminParticipantsPanel({
  competition,
  setConfirmDialog,
}: {
  competition: Competition;
  setConfirmDialog: Dispatch<SetStateAction<ConfirmDialogState>>;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ParticipantStatusFilter>('ALL');

  const participantsQuery = useQuery({
    queryKey: ['admin', 'participants', competition.id],
    queryFn: async () => {
      const data = (await api.get<Participant[]>(`/admin/competitions/${competition.id}/participants`)).data;
      return Array.isArray(data) ? data : [];
    },
  });

  const removeParticipant = useMutation({
    mutationFn: async (participantId: number) => api.delete(`/admin/competitions/${competition.id}/participants/${participantId}`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'participants', competition.id] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'competitions'] }),
        queryClient.invalidateQueries({ queryKey: ['competitions-upcoming'] }),
        queryClient.invalidateQueries({ queryKey: ['competitions-my-details'] }),
      ]);
    },
  });

  const declareWinner = useMutation({
    mutationFn: async (participantId: number) => api.post(`/admin/competitions/${competition.id}/declare-winner/${participantId}`, {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'participants', competition.id] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'competitions'] }),
        queryClient.invalidateQueries({ queryKey: ['competitions-upcoming'] }),
        queryClient.invalidateQueries({ queryKey: ['competitions-my-details'] }),
      ]);
    },
  });

  const participants = participantsQuery.data ?? [];

  const counts = useMemo(() => ({
    ALL: participants.length,
    ACTIVE: participants.filter((p) => p.status === 'ACTIVE').length,
    ELIMINATED: participants.filter((p) => p.status === 'ELIMINATED').length,
    WINNER: participants.filter((p) => p.status === 'WINNER').length,
  }), [participants]);

  const entryCountByUserId = useMemo(() => {
    const entries = new Map<number, number>();
    participants.forEach((participant) => entries.set(participant.userId, (entries.get(participant.userId) ?? 0) + 1));
    return entries;
  }, [participants]);

  const participantLabel = (participant: Participant) => (
    (entryCountByUserId.get(participant.userId) ?? 0) > 1
      ? `${participant.username} • Entry #${participant.entryNumber ?? 1}`
      : participant.username
  );

  const filteredParticipants = useMemo(() => {
    let rows = participants;
    if (statusFilter !== 'ALL') rows = rows.filter((p) => p.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((p) => participantLabel(p).toLowerCase().includes(q));
    }
    return rows;
  }, [participants, statusFilter, search, entryCountByUserId]);

  const setFilter = (next: ParticipantStatusFilter) => setStatusFilter(next);

  const statusLabel = (status: ParticipantStatusFilter) => status === 'ALL' ? 'All' : status.charAt(0) + status.slice(1).toLowerCase();

  const rowStyleFor = (participant: Participant) => {
    if (participant.status === 'ACTIVE') return [styles.adminParticipantRow, styles.adminParticipantActive];
    if (participant.status === 'ELIMINATED') return [styles.adminParticipantRow, styles.adminParticipantEliminated];
    return [styles.adminParticipantRow, styles.adminParticipantWinner];
  };

  return (
    <View style={styles.adminParticipantsPanel}>
      <View style={styles.adminParticipantsHeader}>
        <View style={styles.adminParticipantsHeaderTop}>
          <Text style={styles.adminParticipantsTitle}>Participants ({participants.length})</Text>
          {(statusFilter !== 'ALL' || search.trim()) ? <Text style={styles.adminParticipantsShown}>{filteredParticipants.length} shown</Text> : null}
        </View>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search username..."
          placeholderTextColor={colors.textMuted}
          style={styles.adminParticipantsSearch}
          autoCapitalize="none"
        />
        <View style={styles.adminParticipantsFilters}>
          {(['ALL', 'ACTIVE', 'ELIMINATED', 'WINNER'] as const).map((status) => (
            counts[status] > 0 || status === 'ALL' ? (
              <FilterPill key={status} label={`${statusLabel(status)} (${counts[status]})`} active={statusFilter === status} onPress={() => setFilter(status)} />
            ) : null
          ))}
        </View>
      </View>

      {participantsQuery.isLoading ? <Text style={styles.adminParticipantsEmpty}>Loading participants...</Text> : null}
      {!participantsQuery.isLoading && participants.length === 0 ? <Text style={styles.adminParticipantsEmpty}>No participants yet</Text> : null}
      {!participantsQuery.isLoading && participants.length > 0 && filteredParticipants.length === 0 ? <Text style={styles.adminParticipantsEmpty}>No participants match your filter</Text> : null}

      {filteredParticipants.map((participant) => {
        const label = participantLabel(participant);
        const joined = formatParticipantDate(participant.joinedAt);
        const declaringThis = declareWinner.isPending && declareWinner.variables === participant.id;
        const removingThis = removeParticipant.isPending && removeParticipant.variables === participant.id;
        return (
          <View key={participant.id} style={rowStyleFor(participant)}>
            <View style={styles.adminParticipantTop}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.adminParticipantName} numberOfLines={1}>{label}</Text>
                <View style={styles.adminParticipantMetaRow}>
                  {joined ? <Text style={styles.adminParticipantMeta}>Joined {joined}</Text> : null}
                  {participant.eliminatedWeek ? <Text style={styles.adminParticipantMeta}>GW{participant.eliminatedWeek}</Text> : null}
                </View>
              </View>
              <StatusPill text={participant.status} tone={participant.status === 'ACTIVE' ? 'success' : participant.status === 'WINNER' ? 'warn' : 'danger'} />
            </View>
            <View style={styles.adminParticipantActions}>
              {participant.status === 'ACTIVE' && counts.ACTIVE > 1 ? (
                <TouchableOpacity
                  style={styles.adminWinnerBtn}
                  onPress={() => setConfirmDialog({
                    title: `Declare ${label} as Winner?`,
                    message: `This will end "${competition.name}" and crown this participant as the champion.`,
                    items: [`${label} will be marked as WINNER`, 'All other active participants will be eliminated', 'The competition will be marked as COMPLETED'],
                    confirmText: 'Yes, Declare Winner',
                    onConfirm: () => declareWinner.mutateAsync(participant.id),
                  })}
                  disabled={declaringThis}
                >
                  <Text style={styles.adminWinnerBtnText}>{declaringThis ? 'Declaring...' : 'Winner'}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.adminRemoveBtn}
                onPress={() => setConfirmDialog({
                  title: `Remove ${label}?`,
                  message: `This will remove them from "${competition.name}" and delete all their picks and results.`,
                  confirmText: 'Yes, Remove',
                  onConfirm: () => removeParticipant.mutateAsync(participant.id),
                })}
                disabled={removingThis}
              >
                <Text style={styles.adminRemoveBtnText}>{removingThis ? 'Removing...' : 'Remove'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingBottom: spacing.screen, paddingTop: 8 },
  successText: { color: '#86efac', fontSize: 12, fontWeight: '700' },
  errorText: { color: '#fca5a5', fontSize: 12, fontWeight: '700' },
  infoText: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },

  hero: { position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: '#ffffff14', borderRadius: 30, backgroundColor: '#0b1220', padding: 18, marginBottom: 12, shadowColor: '#020617', shadowOpacity: 0.45, shadowRadius: 28, shadowOffset: { width: 0, height: 18 } },
  heroGlowOne: { position: 'absolute', width: 250, height: 250, borderRadius: 999, backgroundColor: '#38bdf82b', top: -112, left: -88 },
  heroGlowTwo: { position: 'absolute', width: 220, height: 220, borderRadius: 999, backgroundColor: '#f8717118', top: -84, right: -92 },
  heroContent: { position: 'relative' },
  heroBadge: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#38bdf840', backgroundColor: '#0ea5e91a', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 10 },
  heroBadgeText: { color: '#bae6fd', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.7 },
  heroCopy: { color: '#cbd5e1', fontSize: 13, lineHeight: 20, marginTop: 4 },
  heroStatsGrid: { flexDirection: 'row', gap: 8, marginTop: 16 },
  heroStat: { flex: 1, borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#ffffff0b', borderRadius: 16, paddingVertical: 9, paddingHorizontal: 8, alignItems: 'center' },
  heroStatValue: { color: '#bae6fd', fontSize: 16, fontWeight: '900' },
  heroStatValueAlt: { color: '#a5f3fc', fontSize: 16, fontWeight: '900' },
  heroStatValueWarn: { color: '#fde68a', fontSize: 16, fontWeight: '900' },
  heroStatLabel: { color: '#94a3b8', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.0, marginTop: 2 },

  statusPanel: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#ffffff08', borderRadius: 18, padding: 12, marginBottom: 14, gap: 7 },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  statusDot: { width: 8, height: 8, borderRadius: 999 },
  statusDotOk: { backgroundColor: '#22c55e' },
  statusDotInfo: { backgroundColor: '#38bdf8' },
  statusDotError: { backgroundColor: '#ef4444' },
  statusLabel: { color: '#e5e7eb', fontSize: 12, fontWeight: '900' },
  statusMessage: { color: '#9ca3af', fontSize: 12, flexShrink: 1 },
  statusHelper: { color: '#64748b', fontSize: 11 },
  operationToast: { position: 'absolute', left: 10, right: 10, bottom: 10, zIndex: 30 },
  actionNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: 16, padding: 12, shadowColor: '#020617', shadowOpacity: 0.42, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  actionNoticeCompact: { padding: 10 },
  actionNoticeInfo: { borderColor: '#38bdf855', backgroundColor: '#0f2438f2' },
  actionNoticeSuccess: { borderColor: '#22c55e55', backgroundColor: '#10291df2' },
  actionNoticeError: { borderColor: '#ef444455', backgroundColor: '#2b1218f2' },
  actionNoticeIcon: { width: 28, height: 28, borderRadius: 999, borderWidth: 1, borderColor: '#ffffff26', backgroundColor: '#ffffff12', alignItems: 'center', justifyContent: 'center' },
  actionNoticeIconText: { color: '#f8fafc', fontSize: 13, fontWeight: '900' },
  actionNoticeCopy: { flex: 1, minWidth: 0 },
  actionNoticeTitle: { color: '#f8fafc', fontSize: 12, fontWeight: '900' },
  actionNoticeMessage: { color: '#cbd5e1', fontSize: 11, lineHeight: 16, marginTop: 2 },

  sectionSelectorBlock: { marginBottom: 12 },
  selectorLabel: { color: '#64748b', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 7 },
  selectorButton: { borderWidth: 1, borderColor: '#26354d', backgroundColor: '#0b1324', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  selectorButtonOpen: { borderColor: '#0ea5e980', backgroundColor: '#0e1b2f' },
  selectorButtonCopy: { flex: 1, minWidth: 0 },
  selectorKicker: { color: '#7dd3fc', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 3 },
  selectorButtonText: { color: '#f8fafc', fontSize: 16, fontWeight: '900' },
  selectorButtonMeta: { color: '#64748b', fontSize: 11, fontWeight: '700', marginTop: 3 },
  selectorChevronBox: { width: 34, height: 34, borderRadius: 12, borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  selectorChevronBoxOpen: { borderColor: '#0ea5e966', backgroundColor: '#0ea5e922' },
  selectorChevron: { color: '#bae6fd', fontSize: 10, fontWeight: '900' },
  selectorMenu: { marginTop: 7, borderWidth: 1, borderColor: '#26354d', backgroundColor: '#0b1220', borderRadius: 18, overflow: 'hidden' },
  selectorItem: { paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#ffffff0d' },
  selectorItemActive: { backgroundColor: '#0ea5e922' },
  selectorItemText: { color: '#cbd5e1', fontSize: 13, fontWeight: '800' },
  selectorItemTextActive: { color: '#ffffff' },

  webCard: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#111827', borderRadius: 22, padding: 14, marginBottom: 12 },
  sectionSummaryRow: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 12 },
  summaryChip: { flex: 1, borderWidth: 1, borderColor: '#253247', backgroundColor: '#0b1220', borderRadius: 14, paddingVertical: 9, alignItems: 'center' },
  summaryValue: { color: '#f8fafc', fontSize: 15, fontWeight: '900' },
  summaryLabel: { color: '#94a3b8', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 },

  tabWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  input: { backgroundColor: '#0f172a', color: colors.text, borderRadius: 12, borderWidth: 1, borderColor: '#334155', paddingHorizontal: 12, paddingVertical: 11, marginBottom: 9, fontSize: 13 },
  hr: { height: 1, backgroundColor: '#253247', marginVertical: 13 },
  rowCard: { borderWidth: 1, borderColor: '#253247', borderRadius: 16, backgroundColor: '#0f172a', padding: 12, marginBottom: 9, gap: 10 },
  title: { color: '#fff', fontWeight: '900', marginBottom: 4, fontSize: 15 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  adminCompetitionBlock: { marginBottom: 10 },
  adminCompetitionCard: { borderWidth: 1, borderColor: '#253247', borderRadius: 16, backgroundColor: '#0f172a', padding: 12, gap: 10 },
  adminCompetitionTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  adminCompetitionName: { color: '#f8fafc', fontSize: 15, fontWeight: '900' },
  adminCompetitionDate: { color: '#94a3b8', fontSize: 11, marginTop: 3 },
  adminJoinCodePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e91a', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 },
  adminJoinCodeLabel: { color: '#7dd3fc', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  adminJoinCodeText: { color: '#bae6fd', fontFamily: 'monospace', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  adminCompetitionMetaRow: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  adminCompetitionMeta: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  adminCompetitionActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  adminEditBtn: { borderWidth: 1, borderColor: '#06b6d455', backgroundColor: '#06b6d422', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  adminEditBtnText: { color: '#67e8f9', fontSize: 11, fontWeight: '900' },
  adminSyncBtn: { borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e922', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  adminSyncBtnText: { color: '#7dd3fc', fontSize: 11, fontWeight: '900' },
  adminManageBtn: { borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  adminManageBtnText: { color: '#d1d5db', fontSize: 11, fontWeight: '900' },
  adminDeleteBtn: { borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#ef444422', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  adminDeleteBtnText: { color: '#f87171', fontSize: 11, fontWeight: '900' },
  adminParticipantsPanel: { borderWidth: 1, borderColor: '#253247', borderTopWidth: 0, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, backgroundColor: '#0b1220', overflow: 'hidden' },
  adminParticipantsHeader: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#253247', gap: 9 },
  adminParticipantsHeaderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  adminParticipantsTitle: { color: '#d1d5db', fontSize: 13, fontWeight: '900' },
  adminParticipantsShown: { color: '#64748b', fontSize: 11, fontWeight: '800' },
  adminParticipantsSearch: { backgroundColor: '#111827', color: colors.text, borderWidth: 1, borderColor: '#334155', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12 },
  adminParticipantsFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  adminParticipantsEmpty: { color: '#94a3b8', fontSize: 12, textAlign: 'center', paddingVertical: 18, paddingHorizontal: 12 },
  adminParticipantRow: { borderLeftWidth: 2, padding: 11, borderBottomWidth: 1, borderBottomColor: '#253247', gap: 8 },
  adminParticipantActive: { borderLeftColor: '#4ade80', backgroundColor: '#22c55e18' },
  adminParticipantEliminated: { borderLeftColor: '#f87171', backgroundColor: '#ef444418' },
  adminParticipantWinner: { borderLeftColor: '#fde047', backgroundColor: '#eab30818' },
  adminParticipantTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  adminParticipantName: { color: '#e5e7eb', fontSize: 13, fontWeight: '900' },
  adminParticipantMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 },
  adminParticipantMeta: { color: '#94a3b8', fontSize: 11 },
  adminParticipantActions: { flexDirection: 'row', gap: 6, justifyContent: 'flex-end' },
  adminWinnerBtn: { borderWidth: 1, borderColor: '#eab30855', backgroundColor: '#eab30822', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  adminWinnerBtnText: { color: '#fde68a', fontSize: 10, fontWeight: '900' },
  adminRemoveBtn: { borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#ef444422', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  adminRemoveBtnText: { color: '#fca5a5', fontSize: 10, fontWeight: '900' },
  stackActions: { gap: 7, marginTop: 8 },
  badges: { flexDirection: 'row', gap: 6, marginTop: 5, flexWrap: 'wrap' },
  syncBtn: { alignSelf: 'flex-start', backgroundColor: '#0ea5e922', borderWidth: 1, borderColor: '#0ea5e966', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8, alignItems: 'center' },
  syncBtnText: { color: '#7dd3fc', fontWeight: '900', fontSize: 11 },
  delBtn: { alignSelf: 'flex-start', backgroundColor: '#ef444422', borderWidth: 1, borderColor: '#ef444455', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8, alignItems: 'center' },
  delBtnWide: { backgroundColor: '#ef444422', borderWidth: 1, borderColor: '#ef444455', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  delBtnText: { color: '#fca5a5', fontWeight: '900', fontSize: 12 },
  twoCol: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  competitionHeader: { gap: 12 },
  sectionHeading: { color: '#f8fafc', fontSize: 20, fontWeight: '900' },
  sectionDescription: { color: '#94a3b8', fontSize: 13, lineHeight: 19, marginTop: 4 },
  headerActionBtn: { borderWidth: 1, borderColor: '#0ea5e966', backgroundColor: '#0ea5e926', borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  headerActionBtnText: { color: '#bae6fd', fontSize: 13, fontWeight: '900' },
  sectionEyebrow: { color: '#7dd3fc', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 5 },
  emptyStateCard: { borderWidth: 1, borderColor: '#253247', backgroundColor: '#0f172a', borderRadius: 18, paddingVertical: 28, paddingHorizontal: 14, alignItems: 'center', marginTop: 8 },
  emptyStateIcon: { color: '#94a3b8', fontSize: 32, fontWeight: '900', marginBottom: 8 },
  emptyStateText: { color: '#94a3b8', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  clubListCard: { borderWidth: 1, borderColor: '#253247', backgroundColor: '#0f172a', borderRadius: 18, overflow: 'hidden', marginTop: 8 },
  clubListHeader: { borderBottomWidth: 1, borderBottomColor: '#253247', paddingHorizontal: 12, paddingVertical: 11 },
  clubListHeaderText: { color: '#94a3b8', fontSize: 12, fontWeight: '800' },
  clubRowCard: { padding: 13, borderBottomWidth: 1, borderBottomColor: '#253247' },
  clubRowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  clubName: { color: '#f8fafc', fontSize: 14, fontWeight: '900' },
  clubDescription: { color: '#94a3b8', fontSize: 12, lineHeight: 17, marginTop: 3 },
  clubAdminBadge: { borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e922', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, maxWidth: 120 },
  clubAdminBadgeText: { color: '#7dd3fc', fontSize: 10, fontWeight: '900' },
  noAdminText: { color: '#64748b', fontSize: 11, fontStyle: 'italic', marginTop: 1 },
  clubActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 11 },
  clubGhostBtn: { borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  clubGhostBtnText: { color: '#d1d5db', fontSize: 11, fontWeight: '900' },
  clubDeleteBtn: { borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#ef444422', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  clubDeleteBtnText: { color: '#f87171', fontSize: 11, fontWeight: '900' },
  userRowCard: { padding: 13, borderBottomWidth: 1, borderBottomColor: '#253247', gap: 10 },
  userJoinedText: { color: '#64748b', fontSize: 11, marginTop: 3 },
  userStatusBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  userStatusActive: { borderColor: '#22c55e55', backgroundColor: '#22c55e22' },
  userStatusDisabled: { borderColor: '#ef444455', backgroundColor: '#ef444422' },
  userStatusText: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  userStatusTextActive: { color: '#86efac' },
  userStatusTextDisabled: { color: '#fca5a5' },
  userRolePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  userRoleBtn: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8 },
  userRoleBtnActive: { borderColor: '#0ea5e980', backgroundColor: '#0ea5e922' },
  userRoleBtnText: { color: '#94a3b8', fontSize: 10, fontWeight: '900' },
  userRoleBtnTextActive: { color: '#bae6fd' },
  userActionBtn: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  userDisableBtn: { borderColor: '#f59e0b55', backgroundColor: '#f59e0b22' },
  userEnableBtn: { borderColor: '#22c55e55', backgroundColor: '#22c55e22' },
  userActionText: { fontSize: 11, fontWeight: '900' },
  userDisableText: { color: '#fcd34d' },
  userEnableText: { color: '#86efac' },
  loadMoreUsersButton: { margin: 12, borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e91a', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  loadMoreUsersText: { color: '#bae6fd', fontSize: 12, fontWeight: '900' },
  modalBackdrop: { flex: 1, backgroundColor: '#020617dd', paddingHorizontal: 12, paddingTop: 34, paddingBottom: 18, justifyContent: 'flex-start' },
  modalCard: { maxHeight: '94%', borderWidth: 1, borderColor: '#334155', backgroundColor: '#0b1220', borderRadius: 24, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10 },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  modalTitle: { color: '#f8fafc', fontSize: 19, fontWeight: '900' },
  modalSubtitle: { color: '#94a3b8', fontSize: 12, lineHeight: 17, marginTop: 4 },
  modalCloseButton: { borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  modalCloseText: { color: '#cbd5e1', fontSize: 11, fontWeight: '900' },
  modalBody: { paddingBottom: 18 },
  modalSection: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#ffffff05', borderRadius: 16, padding: 11, marginBottom: 10 },
  fieldLabel: { color: '#cbd5e1', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 7 },
  modalIntroRow: { marginBottom: 10 },
  modalInnerTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '900' },
  modalInnerCopy: { color: '#94a3b8', fontSize: 12, lineHeight: 17, marginTop: 3 },
  textArea: { minHeight: 76, textAlignVertical: 'top' },
  inputError: { borderColor: '#ef4444', backgroundColor: '#ef444414' },
  fieldErrorText: { color: '#fca5a5', fontSize: 11, fontWeight: '700', marginTop: -4, marginBottom: 8 },
  fieldHelp: { color: '#64748b', fontSize: 11, lineHeight: 15, marginTop: -4, marginBottom: 8 },
  fieldLabelSmall: { color: '#94a3b8', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 10, marginBottom: 7 },
  optionalText: { color: '#64748b', fontWeight: '600' },
  optionGridTwo: { gap: 8 },
  optionGridThree: { gap: 8 },
  optionCard: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', borderRadius: 12, padding: 11, flexDirection: 'row', gap: 9, alignItems: 'center' },
  typeaheadOption: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', borderRadius: 12, padding: 11, flexDirection: 'row', gap: 9, alignItems: 'center', marginTop: 7 },
  selectedAdminBox: { borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e91a', borderRadius: 12, padding: 10, marginBottom: 8 },
  selectedAdminLabel: { color: '#7dd3fc', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.1 },
  selectedAdminName: { color: '#f8fafc', fontSize: 13, fontWeight: '900', marginTop: 3 },
  selectedAdminEmail: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  paymentOptionCard: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', borderRadius: 12, padding: 11, alignItems: 'center', gap: 5 },
  optionCardActive: { borderColor: '#0ea5e980', backgroundColor: '#0ea5e922' },
  optionIcon: { color: '#7dd3fc', fontSize: 22, fontWeight: '900' },
  optionTitle: { color: '#f8fafc', fontSize: 12, fontWeight: '900' },
  optionDesc: { color: '#94a3b8', fontSize: 11, lineHeight: 15, marginTop: 2 },
  optionDescCentered: { color: '#94a3b8', fontSize: 10, lineHeight: 14, textAlign: 'center' },
  warningPanel: { borderWidth: 1, borderColor: '#f59e0b33', backgroundColor: '#f59e0b12', borderRadius: 12, padding: 10, marginTop: 9 },
  warningText: { color: '#fde68a', fontSize: 11, lineHeight: 16 },
  warnHelp: { color: '#fcd34d', fontSize: 11, lineHeight: 15, marginTop: 7 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 1, marginBottom: 8 },
  presetBtn: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  presetBtnActive: { borderColor: '#0ea5e980', backgroundColor: '#0ea5e922' },
  presetText: { color: '#cbd5e1', fontSize: 11, fontWeight: '800' },
  presetTextActive: { color: '#bae6fd' },
  datePickerButton: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  datePickerValue: { color: colors.text, fontSize: 13, fontWeight: '700' },
  datePickerPlaceholder: { color: colors.textMuted, fontSize: 13 },
  datePickerIcon: { fontSize: 16 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  modalCancelButton: { flex: 1, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  modalCancelText: { color: '#cbd5e1', fontSize: 12, fontWeight: '900' },
  modalSaveButton: { flex: 1.4, borderWidth: 1, borderColor: '#0ea5e966', backgroundColor: '#0ea5e930', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  modalSaveText: { color: '#bae6fd', fontSize: 12, fontWeight: '900' },
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
  actionBtnDisabled: { opacity: 0.55 },
  confirmCancelButton: { flex: 1, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  confirmCancelText: { color: '#cbd5e1', fontWeight: '900', fontSize: 12 },
  confirmDeleteButton: { flex: 1.3, borderWidth: 1, borderColor: '#ef444466', backgroundColor: '#ef444426', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  confirmDeleteText: { color: '#fca5a5', fontWeight: '900', fontSize: 12 },
  simulateRoot: { gap: 12 },
  simulateIntro: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#111827', borderRadius: 22, padding: 14 },
  simulateDensityBar: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#ffffff08', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  simulateDensityLabel: { color: '#e5e7eb', fontSize: 12, fontWeight: '900' },
  simulateDensityToggle: { flexDirection: 'row', borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#ffffff08', borderRadius: 10, padding: 3 },
  simulateDensityOption: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  simulateDensityOptionActive: { backgroundColor: '#0ea5e94d' },
  simulateDensityText: { color: '#94a3b8', fontSize: 10, fontWeight: '900' },
  simulateDensityTextActive: { color: '#ffffff' },
  simulateStepCard: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#111827', borderRadius: 18, padding: 12, gap: 11 },
  simulateStepTitle: { color: '#e5e7eb', fontSize: 14, fontWeight: '900' },
  simulateOptionList: { gap: 8 },
  simulateSelectOption: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a', borderRadius: 12, padding: 10, gap: 3 },
  simulateSelectOptionActive: { borderColor: '#0ea5e980', backgroundColor: '#0ea5e922' },
  simulateSelectTitle: { color: '#f8fafc', fontSize: 12, fontWeight: '900' },
  simulateSelectMeta: { color: '#94a3b8', fontSize: 11, lineHeight: 15 },
  simulateDropdownButton: { borderWidth: 1, borderColor: '#26354d', backgroundColor: '#0b1324', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12, minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  simulateDropdownTitle: { color: '#f8fafc', fontSize: 13, fontWeight: '900' },
  simulateDropdownPlaceholder: { color: '#94a3b8', fontSize: 13, fontWeight: '800' },
  simulateDropdownMeta: { color: '#64748b', fontSize: 11, lineHeight: 15, marginTop: 3 },
  simulateDropdownChevron: { width: 30, height: 30, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', color: '#bae6fd', fontSize: 10, lineHeight: 28, textAlign: 'center', fontWeight: '900' },
  simulateDropdownMenu: { marginTop: -4, borderWidth: 1, borderColor: '#26354d', backgroundColor: '#0b1220', borderRadius: 16, overflow: 'hidden' },
  simulateDropdownItem: { paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#ffffff0d' },
  simulateDropdownItemActive: { backgroundColor: '#0ea5e922' },
  simulateFixtureHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  simulateBulkActions: { gap: 8 },
  simulatePrimaryBtn: { borderWidth: 1, borderColor: '#0ea5e966', backgroundColor: '#0ea5e930', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  simulatePrimaryText: { color: '#bae6fd', fontSize: 12, fontWeight: '900' },
  simulateSecondaryBtn: { borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  simulateSecondaryText: { color: '#d1d5db', fontSize: 12, fontWeight: '900' },
  simulateGhostBtn: { borderWidth: 1, borderColor: '#ffffff1a', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  simulateGhostText: { color: '#94a3b8', fontSize: 12, fontWeight: '900' },
  simulateFixtureCard: { borderWidth: 1, borderColor: '#253247', backgroundColor: '#0f172a', borderRadius: 14, padding: 12, gap: 10 },
  simulateFixtureCardCompact: { padding: 7, gap: 6, borderRadius: 10 },
  simulateFixtureCardActive: { borderColor: '#0ea5e955', backgroundColor: '#0ea5e91a' },
  simulateFixtureTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  simulateFixtureTeams: { color: '#e5e7eb', fontSize: 13, fontWeight: '900', lineHeight: 18 },
  simulateFixtureTeamsCompact: { fontSize: 11, lineHeight: 15 },
  simulateFixtureTime: { color: '#64748b', fontSize: 10, marginTop: 3 },
  simulateQuickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  simulateQuickActionsCompact: { gap: 4 },
  simulateQuickBtn: { borderWidth: 1, borderColor: '#22c55e55', backgroundColor: '#22c55e22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  simulateQuickBtnCompact: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6 },
  simulateQuickText: { color: '#86efac', fontSize: 10, fontWeight: '900' },
  simulateQuickBtnNeutral: { borderWidth: 1, borderColor: '#64748b55', backgroundColor: '#64748b22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  simulateQuickTextNeutral: { color: '#cbd5e1', fontSize: 10, fontWeight: '900' },
  simulateQuickBtnWarn: { borderWidth: 1, borderColor: '#f59e0b55', backgroundColor: '#f59e0b22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  simulateQuickTextWarn: { color: '#fcd34d', fontSize: 10, fontWeight: '900' },
  simulateQuickBtnBrand: { borderWidth: 1, borderColor: '#0ea5e955', backgroundColor: '#0ea5e922', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  simulateQuickTextBrand: { color: '#7dd3fc', fontSize: 10, fontWeight: '900' },
  simulateManualGrid: { gap: 8 },
  simulateManualField: { gap: 6 },
  simulateStatusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  simulateStatusPill: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  simulateStatusPillActive: { borderColor: '#0ea5e980', backgroundColor: '#0ea5e922' },
  simulateStatusPillText: { color: '#94a3b8', fontSize: 10, fontWeight: '900' },
  simulateStatusPillTextActive: { color: '#bae6fd' },
  simulateSubmitArea: { borderTopWidth: 1, borderTopColor: '#253247', paddingTop: 12, gap: 10 },
  simulateWarningPanel: { borderWidth: 1, borderColor: '#f59e0b55', backgroundColor: '#f59e0b18', borderRadius: 12, padding: 10, gap: 4 },
  simulateWarningTitle: { color: '#fde68a', fontSize: 12, fontWeight: '900' },
  simulateWarningText: { color: '#fcd34d', fontSize: 11, lineHeight: 16 },
  simulateCheckboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  simulateCheckbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: '#64748b', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  simulateCheckboxActive: { borderColor: '#0ea5e9', backgroundColor: '#0ea5e933' },
  simulateCheckboxMark: { color: '#bae6fd', fontSize: 10, fontWeight: '900' },
  simulateCheckboxTitle: { color: '#e5e7eb', fontSize: 12, fontWeight: '900' },
  simulateCheckboxHelp: { color: '#94a3b8', fontSize: 11, lineHeight: 15, marginTop: 2 },
  simulateNeedResult: { color: '#fcd34d', fontSize: 11, textAlign: 'center' },
  simulateInfoCard: { borderWidth: 1, borderColor: '#2563eb55', backgroundColor: '#2563eb18', borderRadius: 16, padding: 12, gap: 5 },
  simulateInfoTitle: { color: '#93c5fd', fontSize: 13, fontWeight: '900' },
  simulateInfoText: { color: '#cbd5e1', fontSize: 12, lineHeight: 17 },
  testDataRoot: { gap: 12 },
  testDataIntro: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#111827', borderRadius: 22, padding: 14 },
  testDataCard: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#111827', borderRadius: 18, padding: 12, gap: 10 },
  testDataInfoCard: { borderWidth: 1, borderColor: '#2563eb55', backgroundColor: '#2563eb18', borderRadius: 12, padding: 10, gap: 5 },
  testDataInfoTitle: { color: '#93c5fd', fontSize: 12, fontWeight: '900' },
  testDataInfoText: { color: '#cbd5e1', fontSize: 11, lineHeight: 16 },
  testDataDangerCard: { borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#ef44440d', borderRadius: 18, padding: 12, gap: 10 },
  testDataDangerTitle: { color: '#f87171', fontSize: 14, fontWeight: '900' },
  testDataWarningCard: { borderWidth: 1, borderColor: '#f59e0b55', backgroundColor: '#f59e0b18', borderRadius: 12, padding: 10 },
  testDataWarningText: { color: '#fcd34d', fontSize: 11, lineHeight: 16 },
  testDataScalingCard: { borderWidth: 1, borderColor: '#22c55e55', backgroundColor: '#22c55e14', borderRadius: 18, padding: 12, gap: 5 },
  testDataScalingTitle: { color: '#86efac', fontSize: 13, fontWeight: '900' },
  auditRoot: { gap: 12 },
  auditIntro: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#111827', borderRadius: 22, padding: 14 },
  auditFilterCard: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#111827', borderRadius: 18, padding: 12, gap: 9 },
  auditPillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 4 },
  auditToolbar: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#ffffff08', borderRadius: 12, padding: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  auditCount: { color: '#94a3b8', fontSize: 11, fontWeight: '800' },
  auditDensityToggle: { flexDirection: 'row', borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#ffffff08', borderRadius: 10, padding: 3 },
  auditActiveFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  auditActiveFilter: { color: '#d1d5db', fontSize: 10, borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  auditClearText: { color: '#94a3b8', fontSize: 10, fontWeight: '900', borderWidth: 1, borderColor: '#ffffff1a', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  auditListCard: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#0f172a', borderRadius: 18, overflow: 'hidden', padding: 10, gap: 8 },
  auditEventCard: { borderWidth: 1, borderColor: '#253247', backgroundColor: '#111827', borderRadius: 14, padding: 11, gap: 9 },
  auditEventCardCompact: { padding: 8, gap: 6, borderRadius: 10 },
  auditEventTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 9 },
  auditEventTime: { color: '#64748b', fontSize: 10 },
  auditEventUser: { color: '#f8fafc', fontSize: 13, fontWeight: '900', marginTop: 3 },
  auditEventGrid: { flexDirection: 'row', gap: 8 },
  auditEventCell: { flex: 1 },
  auditEventLabel: { color: '#64748b', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.0 },
  auditEventValue: { color: '#cbd5e1', fontSize: 11, marginTop: 3 },
  auditPaginationCard: { borderWidth: 1, borderColor: '#ffffff14', backgroundColor: '#111827', borderRadius: 14, padding: 10, gap: 9 },
  auditPageText: { color: '#94a3b8', fontSize: 11, fontWeight: '800' },
  auditPaginationActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  auditPageButton: { borderWidth: 1, borderColor: '#ffffff1a', backgroundColor: '#ffffff08', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  auditPageButtonDisabled: { opacity: 0.4 },
  auditPageButtonText: { color: '#d1d5db', fontSize: 11, fontWeight: '900' },
  auditChangeText: { color: '#94a3b8', fontSize: 11, lineHeight: 16 },
  auditOldValue: { color: '#f87171' },
  auditNewValue: { color: '#86efac' },
  auditRow: { borderWidth: 1, borderColor: '#253247', borderRadius: 14, backgroundColor: '#0f172a', padding: 11, marginBottom: 8 },
  auditTitle: { color: '#e2e8f0', fontWeight: '900', fontSize: 12 },
});
