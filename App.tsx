import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, FlatList, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api } from './src/api/client';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import type { Competition } from './src/types';

const queryClient = new QueryClient();

function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onLogin = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Last Man Standing</Text>
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" placeholder="Email" style={styles.input} />
        <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" style={styles.input} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity onPress={onLogin} disabled={submitting} style={styles.button}>
          <Text style={styles.buttonText}>{submitting ? 'Signing in...' : 'Sign in'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function CompetitionsScreen() {
  const { user, logout } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['competitions-upcoming'],
    queryFn: async () => {
      const response = await api.get<Competition[]>('/competitions/upcoming');
      return response.data;
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.subtitle}>Hi, {user?.username}</Text>
        <TouchableOpacity onPress={() => void logout()}>
          <Text style={styles.link}>Logout</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>Available Competitions</Text>

      {isLoading ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>Failed to load competitions</Text> : null}

      <FlatList
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.rowMeta}>{item.status} · {item.participantCount} players</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function Root() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (!user) return <LoginScreen />;
  return <CompetitionsScreen />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    padding: 16,
  },
  card: {
    marginTop: 40,
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: 14,
  },
  input: {
    backgroundColor: '#1f2937',
    color: '#ffffff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: {
    backgroundColor: '#0ea5e9',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  error: {
    color: '#fca5a5',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  link: {
    color: '#38bdf8',
    fontWeight: '600',
  },
  row: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  rowTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  rowMeta: {
    color: '#94a3b8',
    marginTop: 4,
  },
});
