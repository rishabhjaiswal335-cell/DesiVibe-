import { useRouter } from 'expo-router';
import { Settings } from 'lucide-react-native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuthStore } from '../../store/useAuthStore';

export default function MobileProfileScreen() {
  const { profile, signOut } = useAuthStore();
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.username}>@{profile?.username || 'guest'}</Text>
        <TouchableOpacity onPress={() => router.push('/settings')} style={styles.settingsBtn}>
          <Settings size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
      <Text style={styles.name}>{profile?.full_name || 'Sign in to view your DesiVibe profile'}</Text>
      <Text style={styles.bio}>{profile?.bio || ''}</Text>
      {profile && (
        <View style={styles.stats}>
          <Text style={styles.stat}>{profile.posts_count} Posts</Text>
          <Text style={styles.stat}>{profile.followers_count} Followers</Text>
          <Text style={styles.stat}>{profile.following_count} Following</Text>
        </View>
      )}
      {profile && (
        <TouchableOpacity onPress={signOut} style={styles.logout}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', paddingTop: 64, paddingHorizontal: 20, gap: 10 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  settingsBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#15151F', alignItems: 'center', justifyContent: 'center' },
  username: { color: '#00F0FF', fontSize: 20, fontWeight: '700' },
  name: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  bio: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  stats: { flexDirection: 'row', gap: 18, marginTop: 12 },
  stat: { color: '#FFFFFF', fontWeight: '600' },
  logout: { marginTop: 24, backgroundColor: 'rgba(244,63,94,0.2)', padding: 14, borderRadius: 14, alignItems: 'center' },
  logoutText: { color: '#FDA4AF', fontWeight: '600' },
});
