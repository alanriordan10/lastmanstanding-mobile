import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';

export default function OAuth2CallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; error?: string }>();
  const { loginWithToken } = useAuth();

  useEffect(() => {
    const finish = async () => {
      if (params.error) {
        router.replace('/login');
        return;
      }

      if (!params.token) {
        return;
      }

      try {
        await loginWithToken(String(params.token));
        router.replace('/competitions');
      } catch {
        router.replace('/login');
      }
    };

    void finish();
  }, [loginWithToken, params.error, params.token, router]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Signing you in...</Text>
      <Text style={styles.copy}>Completing Google sign in.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b1220', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#f8fafc', fontSize: 22, fontWeight: '900' },
  copy: { color: '#94a3b8', fontSize: 13, marginTop: 8 },
});
