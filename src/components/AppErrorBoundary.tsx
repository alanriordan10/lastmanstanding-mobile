import type { PropsWithChildren, ReactNode } from 'react';
import { Component } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

type State = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error('Mobile app render error', error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  goToLogin = () => {
    this.setState({ error: null }, () => router.replace('/login'));
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.badge}><Text style={styles.badgeText}>App Recovery</Text></View>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.copy}>The app hit an unexpected screen error. You can retry, or return to login and continue from there.</Text>
          <Text style={styles.errorText} numberOfLines={3}>{this.state.error.message}</Text>
          <TouchableOpacity onPress={this.reset} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={this.goToLogin} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Go To Login</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b1220', padding: 18, justifyContent: 'center' },
  card: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827', borderRadius: 24, padding: 18, gap: 12 },
  badge: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#f59e0b55', backgroundColor: '#f59e0b22', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { color: '#fde68a', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.1 },
  title: { color: '#f8fafc', fontSize: 26, fontWeight: '900', letterSpacing: -0.4 },
  copy: { color: '#cbd5e1', fontSize: 13, lineHeight: 20 },
  errorText: { color: '#fca5a5', fontSize: 11, lineHeight: 16, borderWidth: 1, borderColor: '#7f1d1d66', backgroundColor: '#450a0a33', borderRadius: 12, padding: 10 },
  primaryButton: { backgroundColor: '#0284c7', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  primaryButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  secondaryButton: { borderWidth: 1, borderColor: '#ffffff24', backgroundColor: '#ffffff0d', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  secondaryButtonText: { color: '#cbd5e1', fontSize: 13, fontWeight: '900' },
});
