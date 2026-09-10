import React from 'react';
import { Stack } from 'expo-router';
import { theme } from '@/ui/theme';

export default function NewGameLayout(): React.ReactElement {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background }, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="household" />
      <Stack.Screen name="member" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="home" />
      <Stack.Screen name="review" />
      <Stack.Screen name="generating" options={{ gestureEnabled: false, animation: 'fade' }} />
    </Stack>
  );
}
