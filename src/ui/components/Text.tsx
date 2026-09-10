import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type StyleProp, type TextStyle } from 'react-native';
import { typography, useTheme, type TextVariant } from '../theme';
import { useSettings } from '@/store/settings';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: string;
  muted?: boolean;
  faint?: boolean;
  accent?: boolean;
  center?: boolean;
  right?: boolean;
  weight?: '400' | '500' | '600' | '700' | '800';
  size?: number;
  style?: StyleProp<TextStyle>;
}

/**
 * Themed text. Variants: display | title | heading | body | bodyStrong | prose | caption | mono | label.
 * Honors the user's text size setting for body-ish variants.
 */
export function Text({ variant = 'body', color, muted, faint, accent, center, right, weight, size, style, children, ...rest }: TextProps): React.ReactElement {
  const t = useTheme();
  const scale = useSettings((s) => s.textSize);
  const v = typography[variant];
  const scalable = variant === 'body' || variant === 'bodyStrong' || variant === 'prose' || variant === 'caption';
  const factor = scalable ? scale : 1;
  const fontSize = (size ?? v.fontSize) * factor;
  const lineHeight = (size ? size * (v.lineHeight / v.fontSize) : v.lineHeight) * factor;
  const c = color ?? (accent ? t.colors.accent : faint ? t.colors.textFaint : muted ? t.colors.textMuted : t.colors.text);
  return (
    <RNText
      {...rest}
      style={[
        {
          fontFamily: v.fontFamily,
          fontSize,
          lineHeight,
          fontWeight: weight ?? v.fontWeight,
          letterSpacing: v.letterSpacing,
          textTransform: v.textTransform,
          color: c,
          textAlign: center ? 'center' : right ? 'right' : undefined,
        },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}

export default Text;
