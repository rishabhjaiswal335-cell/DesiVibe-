import { useRouter } from 'expo-router';
import { ArrowLeft, Info, Lock, LogOut, Star } from 'lucide-react-native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';

export default function MobileSettingsScreen() {
  const { profile, fetchProfile, signOut } = useAuthStore();
  const router = useRouter();

  const togglePrivacy = async () => {
    if (!profile?.id) return;
    await supabase.from('profiles').update({ is_private: !profile.is_private }).eq('id', profile.id);
    await fetchProfile(profile.id);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.title}>Settings & App Info</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.rowTitle}>
          <Info size={16} color="#00F0FF" />
          <Text style={styles.cardHeading}>About DesiVibe</Text>
        </View>
        <Text style={styles.meta}>App: DesiVibe v1.0.0</Text>
        <Text style={styles.meta}>Created by: Rishabh Jaiswal</Text>
        <Text style={styles.metaHighlight}>Super Admin: rishabhjaiswal335@gmail.com</Text>
        <Text style={styles.metaDesc}>
          Real creator network with Firebase Google Sign-In, Supabase real-time sync, and 24-hour expiring VibeStories.
        </Text>
      </View>

      {profile && (
        <View style={styles.card}>
          <TouchableOpacity onPress={togglePrivacy} style={styles.actionRow}>
            <View style={styles.rowTitle}>
              <Lock size={16} color="#FF007F" />
              <Text style={styles.actionText}>Account Privacy</Text>
            </View>
            <Text style={styles.badgeText}>{profile.is_private ? 'Private' : 'Public'}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/rating')} style={styles.actionRow}>
            <View style={styles.rowTitle}>
              <Star size={16} color="#FF6B00" />
              <Text style={styles.actionText}>Update App Rating</Text>
            </View>
            <Text style={styles.badgeText}>Rate</Text>
          </TouchableOpacity>
        </View>
      )}

      {profile && (
        <TouchableOpacity
          onPress={async () => {
            await signOut();
            router.replace('/(tabs)');
          }}
          style={styles.logoutBtn}
        >
          <LogOut size={16} color="#FDA4AF" />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', paddingTop: 56, paddingHorizontal: 18, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#15151F', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  card: { backgroundColor: '#15151F', borderRadius: 20, padding: 16, gap: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardHeading: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  meta: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  metaHighlight: { color: '#FF6B00', fontSize: 13, fontWeight: '600' },
  metaDesc: { color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 18 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  actionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  badgeText: { color: '#00F0FF', fontSize: 12, fontWeight: '700' },
  logoutBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 16, backgroundColor: 'rgba(244,63,94,0.18)' },
  logoutText: { color: '#FDA4AF', fontWeight: '700' },
});
