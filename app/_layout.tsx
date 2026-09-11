import React, { useEffect, useState } from 'react';
import { View, Platform } from 'react-native';
import { Stack, SplashScreen } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useSettings } from '@/store/settings';
import { useGame } from '@/store/gameStore';
import { ToastHost } from '@/ui/components/Toast';
import { theme } from '@/ui/theme';

try {
  SplashScreen.preventAutoHideAsync().catch(() => undefined);
} catch {
  // web / already hidden
}

export default function RootLayout(): React.ReactElement {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([useSettings.getState().hydrate(), useGame.getState().hydrate()]);
      } finally {
        if (!cancelled) setReady(true);
        SplashScreen.hideAsync().catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = theme.colors.background;
      document.title = 'The Simisium';
    }
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <KeyboardProvider>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
          {ready ? (
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background }, animation: 'fade' }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="settings" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
              <Stack.Screen name="new-game" />
              <Stack.Screen name="(game)" options={{ animation: 'fade' }} />
            </Stack>
          ) : null}
          <ToastHost />
        </View>
      </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
