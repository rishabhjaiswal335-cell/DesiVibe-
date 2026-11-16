import { create } from 'zustand';
import { supabase } from '../lib/supabase';

interface MobileAuthState {
  session: any | null;
  profile: any | null;
  hasRated: boolean;
  setSession: (session: any | null) => void;
  fetchProfile: (userId: string) => Promise<void>;
  syncFirebaseIdToken: (idToken: string) => Promise<void>;
  setHasRated: (val: boolean) => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<MobileAuthState>((set) => ({
  session: null,
  profile: null,
  hasRated: true,
  setSession: (session) => set({ session }),
  setHasRated: (hasRated) => set({ hasRated }),
  fetchProfile: async (userId) => {
    const [{ data: profile }, { data: rating }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('app_ratings').select('id').eq('user_id', userId).maybeSingle(),
    ]);
    set({ profile: profile || null, hasRated: Boolean(rating) || profile?.role === 'super_admin' });
  },
  syncFirebaseIdToken: async (idToken: string) => {
    const { data, error } = await supabase.functions.invoke('firebase-auth-sync', {
      body: { idToken },
    });
    if (error) throw error;
    if (data?.profile) {
      set({
        profile: data.profile,
        hasRated: !data.isNewUser || data.profile.role === 'super_admin',
      });
    }
  },
  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, profile: null, hasRated: true });
  },
}));
