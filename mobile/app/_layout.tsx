import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';

const queryClient = new QueryClient();

export default function RootLayout() {
  const { setSession, fetchProfile, session, profile, hasRated } = useAuthStore();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user?.id) fetchProfile(session.user.id);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user?.id) fetchProfile(nextSession.user.id);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const inRating = segments[0] === 'rating';
    if (session && profile && !hasRated && !inRating) {
      router.replace('/rating');
    }
  }, [session, profile, hasRated, segments]);

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0A0A0F' } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="rating" />
        <Stack.Screen name="settings" />
      </Stack>
    </QueryClientProvider>
  );
}
