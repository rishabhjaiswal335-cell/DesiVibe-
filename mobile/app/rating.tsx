import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Star } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';

export default function MobileRatingScreen() {
  const { profile, setHasRated } = useAuthStore();
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);

  const submitRating = async () => {
    if (!profile?.id) return;
    setSaving(true);
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await supabase.from('app_ratings').upsert({
        user_id: profile.id,
        rating,
        feedback: feedback.trim().slice(0, 500),
      });
      setHasRated(true);
      router.replace('/(tabs)');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.badge}>DesiVibe Onboarding</Text>
      <Text style={styles.title}>Rate DesiVibe</Text>
      <Text style={styles.subtitle}>
        You are now following @rishabhjaiswal. Share your quick star rating to enter the Home Feed.
      </Text>

      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity
            key={star}
            onPress={() => {
              Haptics.selectionAsync();
              setRating(star);
            }}
            style={styles.starBtn}
          >
            <Star
              size={30}
              color={star <= rating ? '#FF6B00' : 'rgba(255,255,255,0.25)'}
              fill={star <= rating ? '#FF6B00' : 'transparent'}
            />
          </TouchableOpacity>
        ))}
      </View>

      <TextInput
        value={feedback}
        onChangeText={setFeedback}
        placeholder="Optional feedback..."
        placeholderTextColor="rgba(255,255,255,0.35)"
        multiline
        style={styles.input}
      />

      <TouchableOpacity onPress={submitRating} disabled={saving} style={styles.button}>
        <Text style={styles.buttonText}>{saving ? 'Saving...' : 'Submit Rating & Open Home Feed'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', justifyContent: 'center', padding: 24, gap: 16 },
  badge: { color: '#00F0FF', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  title: { color: '#FFFFFF', fontSize: 28, fontWeight: '800' },
  subtitle: { color: 'rgba(255,255,255,0.65)', fontSize: 14, lineHeight: 20 },
  stars: { flexDirection: 'row', gap: 12, justifyContent: 'center', marginVertical: 12 },
  starBtn: { padding: 8, backgroundColor: '#15151F', borderRadius: 14 },
  input: {
    backgroundColor: '#15151F',
    color: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    minHeight: 90,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  button: { backgroundColor: '#FF007F', paddingVertical: 15, borderRadius: 16, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
