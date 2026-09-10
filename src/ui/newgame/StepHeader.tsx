import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../theme';
import { Text } from '../components/Text';
import { IconButton } from '../components/Button';

export const STEPS = ['City', 'Household', 'Home & money', 'Review'];

export function StepHeader({ step, title, subtitle, onBack }: { step: number; title: string; subtitle?: string; onBack?: () => void }): React.ReactElement {
  const t = useTheme();
  const router = useRouter();
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <IconButton icon="arrow-left" accessibilityLabel="Back" onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))} />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }} accessible accessibilityLabel={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
          {STEPS.map((s, i) => (
            <View key={s} style={{ flex: i === step ? 2.2 : 1, height: 4, borderRadius: 2, backgroundColor: i < step ? t.colors.accent : i === step ? t.colors.accent : t.colors.surfaceOverlay, opacity: i < step ? 0.55 : 1 }} />
          ))}
        </View>
        <Text variant="caption" muted>
          {step + 1}/{STEPS.length}
        </Text>
      </View>
      <Text variant="label" accent>
        {STEPS[step]}
      </Text>
      <Text variant="display" style={{ marginTop: 2 }}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="body" muted style={{ marginTop: 4 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export default StepHeader;
