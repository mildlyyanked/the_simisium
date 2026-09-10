import React from 'react';
import { useTheme, type TextVariant } from '../theme';
import { Text } from './Text';
import { money } from '../format';

export function MoneyText({ amount, variant = 'bodyStrong', signed, cents = true, compact, color, colorize = true, style }: { amount: number; variant?: TextVariant; signed?: boolean; cents?: boolean; compact?: boolean; color?: string; colorize?: boolean; style?: object }): React.ReactElement {
  const t = useTheme();
  const c = color ?? (colorize ? (amount < 0 ? t.colors.danger : signed && amount > 0 ? t.colors.success : t.colors.text) : t.colors.text);
  return (
    <Text variant={variant} color={c} style={[{ fontVariant: ['tabular-nums'] }, style]}>
      {money(amount, { sign: signed, cents, compact })}
    </Text>
  );
}

export default MoneyText;
