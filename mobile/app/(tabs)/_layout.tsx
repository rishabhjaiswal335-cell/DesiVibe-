import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Tabs } from 'expo-router';
import { Compass, Film, Home, Plus, User } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: styles.tabBar,
        tabBarBackground: () => (
          <BlurView intensity={70} tint="dark" style={[StyleSheet.absoluteFill, { borderRadius: 32, overflow: 'hidden' }]} />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        listeners={{ tabPress: () => Haptics.selectionAsync() }}
        options={{ tabBarIcon: ({ focused }) => <Home size={22} color={focused ? '#00F0FF' : '#9CA3AF'} /> }}
      />
      <Tabs.Screen
        name="explore"
        listeners={{ tabPress: () => Haptics.selectionAsync() }}
        options={{ tabBarIcon: ({ focused }) => <Compass size={22} color={focused ? '#00F0FF' : '#9CA3AF'} /> }}
      />
      <Tabs.Screen
        name="create"
        listeners={{ tabPress: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium) }}
        options={{
          tabBarIcon: () => (
            <View style={styles.createPill}>
              <Plus size={22} color="#FFFFFF" />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="reels"
        listeners={{ tabPress: () => Haptics.selectionAsync() }}
        options={{ tabBarIcon: ({ focused }) => <Film size={22} color={focused ? '#00F0FF' : '#9CA3AF'} /> }}
      />
      <Tabs.Screen
        name="profile"
        listeners={{ tabPress: () => Haptics.selectionAsync() }}
        options={{ tabBarIcon: ({ focused }) => <User size={22} color={focused ? '#00F0FF' : '#9CA3AF'} /> }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    bottom: 18,
    left: 16,
    right: 16,
    height: 62,
    borderRadius: 32,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(21,21,31,0.82)',
  },
  createPill: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FF007F',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
