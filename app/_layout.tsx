import { Stack } from 'expo-router';
import { AppProviders } from '../src/providers/AppProviders';
import { AppHeaderTitle } from '../src/components/AppHeaderTitle';
import { AppErrorBoundary } from '../src/components/AppErrorBoundary';

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <AppProviders>
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: '#0b1220',
          },
          headerShadowVisible: false,
          headerTintColor: '#f8fafc',
          headerTitle: ({ children }) => <AppHeaderTitle title={String(children)} />,
          contentStyle: { backgroundColor: '#0b1220' },
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="signup" options={{ headerShown: false }} />
        <Stack.Screen name="forgot-password" options={{ title: 'Forgot Password' }} />
        <Stack.Screen name="reset-password" options={{ title: 'Reset Password' }} />
        <Stack.Screen name="oauth2/callback" options={{ headerShown: false }} />
        <Stack.Screen name="register-club" options={{ title: 'Create Club' }} />
        <Stack.Screen name="create-club" options={{ title: 'Create Club' }} />
        <Stack.Screen name="faq" options={{ title: 'FAQ' }} />
        <Stack.Screen name="contact" options={{ title: 'Contact Us' }} />
        <Stack.Screen name="stripe-connect/return" options={{ title: 'Stripe Connect' }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="competitions/[id]" options={{ title: 'Competition' }} />
        <Stack.Screen name="competitions/[id]/pick" options={{ title: 'Make Pick' }} />
        <Stack.Screen name="competitions/[id]/survivor-table" options={{ title: 'Survivor Table' }} />
        <Stack.Screen name="competitions/[id]/gameweeks/[gwId]/selections" options={{ title: 'Gameweek Selections' }} />
        <Stack.Screen name="competitions/[id]/gameweeks/[gwId]/results" options={{ title: 'Gameweek Results' }} />
      </Stack>
      </AppProviders>
    </AppErrorBoundary>
  );
}
