import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/useAuthStore';

type UploadFormat = 'reel' | 'video' | 'image';

export default function MobileCreateStudio() {
  const { session } = useAuthStore();
  const [format, setFormat] = useState<UploadFormat>('reel');
  const [caption, setCaption] = useState('');
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [pickedType, setPickedType] = useState<'video' | 'image'>('video');
  const [status, setStatus] = useState('');

  const pickMedia = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: format === 'image' ? ['images', 'videos'] : ['videos', 'images'],
      allowsEditing: true,
      quality: 0.85,
    });
    if (!res.canceled && res.assets[0]) {
      setMediaUri(res.assets[0].uri);
      setPickedType(res.assets[0].type === 'video' ? 'video' : 'image');
    }
  };

  const publish = async () => {
    if (!session?.user?.id || !mediaUri) return;
    setStatus('Uploading...');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const defaultExt = pickedType === 'video' ? 'mp4' : 'jpg';
    const ext = mediaUri.split('.').pop() || defaultExt;
    const bucket = format === 'reel' ? 'reels' : 'posts';
    const path = `${session.user.id}/${Date.now()}.${ext}`;
    const blob = await (await fetch(mediaUri)).blob();
    await supabase.storage.from(bucket).upload(path, blob);
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    const finalType = format === 'reel' ? 'reel' : format === 'video' || pickedType === 'video' ? 'video' : 'image';
    await supabase.from('posts').insert({
      user_id: session.user.id,
      media_type: finalType,
      media_urls: [pub.publicUrl],
      thumbnail_url: pub.publicUrl,
      aspect_ratio: format === 'reel' ? '9:16' : '4:5',
      caption,
    });
    setStatus(format === 'reel' ? 'VibeReel Published!' : 'Published!');
    setCaption('');
    setMediaUri(null);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>DesiVibe Studio</Text>
      <View style={styles.tabRow}>
        {(
          [
            ['reel', 'VibeReel'],
            ['video', 'Video'],
            ['image', 'Photo'],
          ] as const
        ).map(([id, label]) => (
          <TouchableOpacity
            key={id}
            onPress={() => setFormat(id)}
            style={[styles.tabBtn, format === id && styles.tabBtnActive]}
          >
            <Text style={styles.btnText}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity onPress={pickMedia} style={styles.pickerBtn}>
        <Text style={styles.btnText}>
          {mediaUri
            ? `${format === 'reel' ? 'VibeReel' : format === 'video' ? 'Video' : 'Media'} Selected`
            : format === 'reel' || format === 'video'
              ? 'Upload VibeReel / Video First'
              : 'Pick Photo / Video'}
        </Text>
      </TouchableOpacity>
      <TextInput
        value={caption}
        onChangeText={setCaption}
        placeholder="Write a caption..."
        placeholderTextColor="#71717A"
        style={styles.input}
      />
      <TouchableOpacity onPress={publish} style={styles.publishBtn}>
        <Text style={styles.btnText}>
          {format === 'reel' ? 'Publish VibeReel' : format === 'video' ? 'Publish Video' : 'Publish Post'}
        </Text>
      </TouchableOpacity>
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', paddingTop: 64, paddingHorizontal: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  tabRow: { flexDirection: 'row', gap: 10 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: '#15151F', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  tabBtnActive: { backgroundColor: '#FF007F', borderColor: '#FF6B00' },
  pickerBtn: { backgroundColor: '#15151F', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#00F0FF' },
  publishBtn: { backgroundColor: '#FF6B00', padding: 16, borderRadius: 16, alignItems: 'center' },
  btnText: { color: '#FFFFFF', fontWeight: '600', textAlign: 'center' },
  input: { backgroundColor: '#15151F', color: '#FFFFFF', padding: 14, borderRadius: 14 },
  status: { color: '#00F0FF', textAlign: 'center' },
});
