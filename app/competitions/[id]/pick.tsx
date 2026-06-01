import { Redirect } from 'expo-router';
import { useAuth } from '../../../src/auth/AuthContext';
import PickScreen from '../../../src/screens/PickScreen';

export default function PickRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect href="/login" />;
  return <PickScreen />;
}
