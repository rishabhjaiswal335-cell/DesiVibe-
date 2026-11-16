import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { FlatList, Image, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

export default function MobileHomeFeed() {
  const { data: posts = [], isRefetching, refetch } = useQuery({
    queryKey: ['mobile-feed'],
    queryFn: async () => {
      const { data } = await supabase
        .from('posts')
        .select('*, profiles(username, full_name, avatar_url, is_verified)')
        .eq('is_removed', false)
        .order('created_at', { ascending: false })
        .limit(25);
      return data || [];
    },
  });

  const handleLike = async (postId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('likes').insert({ user_id: user.id, post_id: postId });
    refetch();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>DesiVibe</Text>
      <FlatList
        data={posts}
        keyExtractor={(item: any) => item.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#FF6B00" />}
        renderItem={({ item }: any) => (
          <View style={styles.card}>
            <Text style={styles.username}>@{item.profiles?.username}</Text>
            {item.media_urls?.[0] && <Image source={{ uri: item.media_urls[0] }} style={styles.media} />}
            <View style={styles.actions}>
              <TouchableOpacity onPress={() => handleLike(item.id)}>
                <Text style={styles.likeText}>♥ {item.likes_count}</Text>
              </TouchableOpacity>
              <Text style={styles.caption}>{item.caption}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', paddingTop: 52, paddingHorizontal: 14 },
  brand: { fontSize: 24, fontWeight: '800', color: '#FF6B00', marginBottom: 14 },
  card: { backgroundColor: '#15151F', borderRadius: 20, marginBottom: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  username: { color: '#FFFFFF', fontWeight: '600', padding: 12 },
  media: { width: '100%', height: 340 },
  actions: { padding: 12, gap: 6 },
  likeText: { color: '#FF007F', fontWeight: '700' },
  caption: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
});
