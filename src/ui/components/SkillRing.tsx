import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon } from '../icons';

export function SkillRing({ level, progress = 0, label, icon, size = 64, color, style }: { level: number; progress?: number; label?: string; icon?: string; size?: number; color?: string; style?: StyleProp<ViewStyle> }): React.ReactElement {
  const t = useTheme();
  const stroke = Math.max(4, size * 0.09);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const lvl = Math.max(0, Math.min(10, level));
  const frac = lvl >= 10 ? 1 : Math.max(0, Math.min(1, progress));
  const c = color ?? t.colors.accent;
  return (
    <View style={[{ alignItems: 'center', width: size + 8 }, style]} accessible accessibilityLabel={`${label ?? 'Skill'} level ${lvl}`}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={{ position: 'absolute' }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.colors.surfaceOverlay} strokeWidth={stroke} fill="none" />
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c} strokeWidth={stroke} fill="none" strokeDasharray={`${circ}`} strokeDashoffset={circ * (1 - frac)} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        </Svg>
        {icon ? <Icon name={icon} size={size * 0.24} color={t.colors.textMuted} style={{ marginBottom: 1 }} /> : null}
        <Text variant="heading" style={{ fontSize: size * 0.28, lineHeight: size * 0.32 }}>
          {lvl}
        </Text>
      </View>
      {label ? (
        <Text variant="caption" muted numberOfLines={1} center style={{ marginTop: 4, width: size + 8 }}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

/** Round dial 0..1 with a label under it (credit score etc.). */
export function Dial({ value, min, max, label, sublabel, size = 120, color, style }: { value: number; min: number; max: number; label: string; sublabel?: string; size?: number; color?: string; style?: StyleProp<ViewStyle> }): React.ReactElement {
  const t = useTheme();
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const arc = circ * 0.75;
  const c = color ?? t.colors.accent;
  return (
    <View style={[{ alignItems: 'center', width: size }, style]} accessible accessibilityLabel={`${label} ${value}`}>
      <View style={{ width: size, height: size * 0.82, alignItems: 'center', justifyContent: 'flex-end' }}>
        <Svg width={size} height={size} style={{ position: 'absolute', top: 0 }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.colors.surfaceOverlay} strokeWidth={stroke} fill="none" strokeDasharray={`${arc} ${circ}`} strokeLinecap="round" transform={`rotate(135 ${size / 2} ${size / 2})`} />
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c} strokeWidth={stroke} fill="none" strokeDasharray={`${arc * frac} ${circ}`} strokeLinecap="round" transform={`rotate(135 ${size / 2} ${size / 2})`} />
        </Svg>
        <Text variant="display" style={{ fontSize: size * 0.28, lineHeight: size * 0.32, marginBottom: size * 0.08 }}>
          {Math.round(value)}
        </Text>
      </View>
      <Text variant="label" muted>
        {label}
      </Text>
      {sublabel ? (
        <Text variant="caption" color={c}>
          {sublabel}
        </Text>
      ) : null}
    </View>
  );
}

export default SkillRing;
