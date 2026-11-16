import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FlatList, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../lib/supabase';

export default function MobileExploreScreen() {
  const [search, setSearch] = useState('');

  const { data: posts = [] } = useQuery({
    queryKey: ['mobile-explore', search],
    queryFn: async () => {
      let query = supabase.from('posts').select('*').eq('is_removed', false).limit(30);
      if (search.trim()) query = query.ilike('caption', `%${search.trim()}%`);
      const { data } = await query;
      return data || [];
    },
  });

  return (
    <View style={styles.container}>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search creators, #hashtags, audio..."
        placeholderTextColor="#71717A"
        style={styles.search}
      />
      <FlatList
        data={posts}
        numColumns={2}
        keyExtractor={(item: any) => item.id}
        columnWrapperStyle={{ gap: 8 }}
        contentContainerStyle={{ gap: 8, paddingBottom: 100 }}
        renderItem={({ item }: any) => (
          <View style={styles.tile}>
            {item.thumbnail_url ? (
              <Image source={{ uri: item.thumbnail_url }} style={styles.img} />
            ) : (
              <Text style={styles.caption}>{item.caption}</Text>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', paddingTop: 54, paddingHorizontal: 14 },
  search: { backgroundColor: '#15151F', color: '#FFF', padding: 13, borderRadius: 14, marginBottom: 14 },
  tile: { flex: 1, height: 180, borderRadius: 16, overflow: 'hidden', backgroundColor: '#15151F' },
  img: { width: '100%', height: '100%' },
  caption: { color: '#FFF', padding: 10, fontSize: 12 },
});
