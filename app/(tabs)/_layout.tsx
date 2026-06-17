import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/auth/AuthContext';
import { AppHeaderTitle } from '../../src/components/AppHeaderTitle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const insets = useSafeAreaInsets();
  if (loading) return null;
  if (!user) return <Redirect href="/login" />;

  const isClubAdmin = user.role === 'CLUB_ADMIN' || user.role === 'ADMIN';
  const isAdmin = user.role === 'ADMIN';

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: '#0b1220' },
        headerShadowVisible: false,
        headerTintColor: '#f8fafc',
        headerTitle: ({ children }) => <AppHeaderTitle title={String(children)} />,
        headerTitleAlign: 'left',
        sceneStyle: { backgroundColor: '#0b1220' },
        tabBarActiveTintColor: '#38bdf8',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', paddingBottom: 2 },
        tabBarStyle: {
          backgroundColor: '#0b1220',
          borderTopColor: '#1f2937',
          borderTopWidth: 1,
          height: 62 + Math.max(insets.bottom, 0),
          paddingTop: 6,
          paddingBottom: 8 + Math.max(insets.bottom, 0),
        },
      }}
    >
      <Tabs.Screen
        name="competitions"
        options={{
          title: 'Competitions',
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'compass' : 'compass-outline'} color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="my-competitions"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="club-admin"
        options={{
          title: 'Club Admin',
          href: isClubAdmin ? undefined : null,
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'settings' : 'settings-outline'} color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: 'Admin',
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'shield-checkmark' : 'shield-checkmark-outline'} color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'person-circle' : 'person-circle-outline'} color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
