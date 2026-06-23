export type UserRole = 'USER' | 'CLUB_ADMIN' | 'ADMIN';

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  id?: number;
  userId?: number;
  email: string;
  username: string;
  role: UserRole;
  emailResultsOptIn: boolean;
  notificationPickReminders?: boolean;
  notificationResultUpdates?: boolean;
  notificationCompetitionAnnouncements?: boolean;
  notificationPaymentUpdates?: boolean;
}

export interface Club {
  id: number;
  name: string;
  description: string | null;
  clubAdminId: number | null;
  clubAdminUsername: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  logoUrl?: string | null;
}

export interface Competition {
  id: number;
  name: string;
  description?: string;
  status: 'UPCOMING' | 'ACTIVE' | 'COMPLETED';
  paused?: boolean;
  pauseReason?: string | null;
  pausedAt?: string | number[] | null;
  startDate?: string | null;
  firstGameweekDate?: string | null;
  entryFee: number;
  prizePool?: number | null;
  maxEntriesPerUser?: number;
  fixtureCompetitionCode?: 'PL' | 'WC';
  missedPickMode?: 'ELIMINATE' | 'ALLOW';
  postponedConsumesTeam?: boolean;
  lifelineEnabled?: boolean;
  passFeeToParticipant?: boolean;
  participantCount: number;
  activeCount: number;
  winnerUsername?: string | null;
  paymentMode?: 'FREE' | 'MANUAL' | 'STRIPE';
  manualPaymentPolicy?: 'STRICT' | 'LENIENT';
  visibility?: 'PUBLIC' | 'PRIVATE';
  joinCode?: string | null;
}

export interface Participant {
  id: number;
  userId: number;
  username: string;
  entryNumber?: number;
  status: 'ACTIVE' | 'ELIMINATED' | 'WINNER';
  paymentState?: 'NOT_REQUIRED' | 'AWAITING_PAYMENT' | 'PAID';
  lifelineUsed?: boolean;
  lifelineUsedWeek?: number | null;
  eliminatedWeek: number | null;
  joinedAt: string;
}

export interface MyCompetition {
  competition: Competition;
  participantId?: number;
  entryNumber?: number;
  myStatus: 'ACTIVE' | 'ELIMINATED' | 'WINNER';
  paymentState?: 'NOT_REQUIRED' | 'AWAITING_PAYMENT' | 'PAID';
  pickRequired?: boolean;
  eliminatedWeek: number | null;
  joinedAt: string;
}

export interface PickHistoryItem {
  pickId: number;
  gameweekId: number;
  weekNumber: number;
  teamId: number;
  teamName: string;
  teamShortName: string;
  source: 'USER' | 'AUTO';
  locked: boolean;
  useLifeline?: boolean;
  pickedAt: string;
  outcome?: string;
  resolvedAt?: string | null;
}

export interface MyStatusResponse {
  participant: Participant;
  usedTeamIds: number[];
  picks: PickHistoryItem[];
}

export interface GameweekResponse {
  id: number;
  weekNumber: number;
  lockAt: string;
  status: 'UPCOMING' | 'LOCKED' | 'IN_PROGRESS' | 'COMPLETED' | 'VOIDED';
  voided?: boolean;
  voidReason?: string | null;
}

export interface Fixture {
  id: number;
  gameweekId: number;
  weekNumber: number;
  homeTeamId: number;
  homeTeamName: string;
  homeTeamShortName: string;
  awayTeamId: number;
  awayTeamName: string;
  awayTeamShortName: string;
  kickoffAt: string;
  status: 'SCHEDULED' | 'IN_PLAY' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
  scoreHome: number | null;
  scoreAway: number | null;
  gameweekStatus?: 'UPCOMING' | 'LOCKED' | 'IN_PROGRESS' | 'COMPLETED';
  oddsHomeWin?: number | null;
  oddsDraw?: number | null;
  oddsAwayWin?: number | null;
  oddsImpliedHome?: number | null;
  oddsImpliedDraw?: number | null;
  oddsImpliedAway?: number | null;
}

export interface PickResponse {
  id: number;
  gameweekId: number;
  weekNumber: number;
  teamId: number;
  teamName: string;
  teamShortName: string;
  source: 'USER' | 'AUTO';
  locked: boolean;
  pickedAt: string;
}

export interface SurvivorGameweekMeta {
  weekNumber: number;
  status: 'UPCOMING' | 'LOCKED' | 'IN_PROGRESS' | 'COMPLETED' | 'VOIDED';
  voided?: boolean;
  voidReason?: string | null;
}

export interface SurvivorPickCell {
  teamShortName: string;
  outcome: string;
  source?: 'USER' | 'AUTO';
  useLifeline?: boolean;
}

export interface SurvivorRow {
  userId: number;
  username: string;
  entryNumber?: number;
  status: 'ACTIVE' | 'ELIMINATED' | 'WINNER';
  eliminatedWeek?: number | null;
  picks: Record<number, SurvivorPickCell | null>;
  lifelineUsed?: boolean;
  lifelineUsedWeek?: number | null;
}

export interface SurvivorTableResponse {
  gameweeks: SurvivorGameweekMeta[];
  rows: SurvivorRow[];
}

export interface GameweekSelection {
  participantId?: number | null;
  userId: number;
  username: string;
  entryNumber?: number;
  lifelineUsed?: boolean;
  lifelineUsedWeek?: number | null;
  teamId: number;
  teamName: string;
  teamShortName: string;
  source: 'USER' | 'AUTO';
  useLifeline?: boolean;
  outcome: string;
}

export interface GameweekSelectionsData {
  selections: GameweekSelection[];
  byeGranted: boolean;
  voided?: boolean;
  voidReason?: string | null;
  weekNumber: number;
  activeAtStart?: number;
  advancedThisWeek?: number;
  eliminatedThisWeek?: number;
}
