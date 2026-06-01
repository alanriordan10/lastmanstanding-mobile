import { Redirect } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import CompetitionDetailScreen from '../../src/screens/CompetitionDetailScreen';

export default function CompetitionDetailRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect href="/login" />;
  return <CompetitionDetailScreen />;
}
