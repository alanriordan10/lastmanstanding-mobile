import { Redirect } from 'expo-router';
import { useAuth } from '../../../src/auth/AuthContext';
import SurvivorTableScreen from '../../../src/screens/SurvivorTableScreen';

export default function SurvivorTableRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect href="/login" />;
  return <SurvivorTableScreen />;
}
