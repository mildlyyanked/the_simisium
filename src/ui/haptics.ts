/**
 * Haptics wrapper — safe on web and respects the user's haptics setting.
 */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

let enabled = true;
export function setHapticsEnabled(v: boolean): void {
  enabled = v;
}

const canHaptic = () => enabled && Platform.OS !== 'web';

export const haptic = {
  light(): void {
    if (!canHaptic()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  },
  medium(): void {
    if (!canHaptic()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  },
  heavy(): void {
    if (!canHaptic()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
  },
  select(): void {
    if (!canHaptic()) return;
    Haptics.selectionAsync().catch(() => undefined);
  },
  success(): void {
    if (!canHaptic()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  },
  warning(): void {
    if (!canHaptic()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  },
  error(): void {
    if (!canHaptic()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
  },
};
