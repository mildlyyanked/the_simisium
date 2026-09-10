import React, { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { Text } from './Text';

/** The app mark: a warm sun/coin over a horizon line — used on the title screen and app icon. */
export function LogoMark({ size = 88 }: { size?: number }): React.ReactElement {
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(withTiming(360, { duration: 60000, easing: Easing.linear }), -1, false);
  }, [rot]);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: size, height: size }, a]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Circle cx={50} cy={50} r={46} stroke="rgba(245,184,74,0.25)" strokeWidth={1} fill="none" strokeDasharray="3 6" />
        </Svg>
      </Animated.View>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <SvgGradient id="sun" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFD37A" />
            <Stop offset="1" stopColor="#F5B84A" />
          </SvgGradient>
        </Defs>
        <Circle cx={50} cy={46} r={26} fill="url(#sun)" />
        <Path d="M18 62 H82" stroke="#0B0E14" strokeWidth={6} strokeLinecap="round" />
        <Path d="M22 70 H78" stroke="#6EA8FE" strokeWidth={3} strokeLinecap="round" opacity={0.9} />
        <Path d="M30 78 H70" stroke="#6EA8FE" strokeWidth={2} strokeLinecap="round" opacity={0.5} />
        <Circle cx={40} cy={40} r={3} fill="#0B0E14" />
        <Circle cx={60} cy={40} r={3} fill="#0B0E14" />
        <Path d="M42 50 C46 55 54 55 58 50" stroke="#0B0E14" strokeWidth={3} fill="none" strokeLinecap="round" />
      </Svg>
    </View>
  );
}

export function Wordmark({ size = 34 }: { size?: number }): React.ReactElement {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center' }}>
      <Text variant="label" color={t.colors.accent} style={{ letterSpacing: 4, marginBottom: 2 }}>
        The
      </Text>
      <Text variant="display" style={{ fontSize: size, lineHeight: size * 1.15, letterSpacing: 3 }} accessibilityRole="header">
        SIMISIUM
      </Text>
    </View>
  );
}

export default Wordmark;
