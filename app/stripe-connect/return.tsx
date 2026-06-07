import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { colors } from '../../src/theme/tokens';

export default function StripeConnectReturnRoute() {
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['club-admin', 'stripe-connect-status'] });
    void queryClient.invalidateQueries({ queryKey: ['club-admin', 'my-club'] });
    const timeout = setTimeout(() => router.replace('/(tabs)/club-admin'), 350);
    return () => clearTimeout(timeout);
  }, [queryClient, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.brand} />
      <Text style={styles.title}>Returning from Stripe</Text>
      <Text style={styles.body}>Refreshing your club payment setup...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900', marginTop: 16 },
  body: { color: colors.textMuted, fontSize: 13, fontWeight: '700', marginTop: 8, textAlign: 'center' },
});
