import { useQuery } from '@tanstack/react-query';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Dimensions, FlatList, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';

const { height } = Dimensions.get('window');

function ReelItem({ item }: { item: any }) {
  const player = useVideoPlayer(item.media_urls?.[0] || '', (p) => {
    p.loop = true;
    p.play();
  });

  return (
    <View style={[styles.reel, { height }]}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={styles.overlay}>
        <Text style={styles.author}>@{item.profiles?.username}</Text>
        <Text style={styles.caption}>{item.caption}</Text>
      </View>
    </View>
  );
}

export default function MobileReelsScreen() {
  const { data: reels = [] } = useQuery({
    queryKey: ['mobile-reels'],
    queryFn: async () => {
      const { data } = await supabase
        .from('posts')
        .select('*, profiles(username, is_verified)')
        .eq('media_type', 'reel')
        .eq('is_removed', false)
        .order('created_at', { ascending: false })
        .limit(30);
      return data || [];
    },
  });

  return (
    <FlatList
      data={reels}
      pagingEnabled
      showsVerticalScrollIndicator={false}
      keyExtractor={(item: any) => item.id}
      renderItem={({ item }) => <ReelItem item={item} />}
    />
  );
}

const styles = StyleSheet.create({
  reel: { width: '100%', backgroundColor: '#0A0A0F', justifyContent: 'flex-end' },
  overlay: { padding: 20, paddingBottom: 100, backgroundColor: 'rgba(0,0,0,0.35)' },
  author: { color: '#FFFFFF', fontWeight: '700', fontSize: 16, marginBottom: 4 },
  caption: { color: 'rgba(255,255,255,0.9)', fontSize: 13 },
});
