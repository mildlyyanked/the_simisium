/**
 * Design tokens for The Simisium — a premium dark "life journal" aesthetic.
 * Dark theme only for v1, but structured so a light palette can be added by
 * swapping `palette` (all components read colors through `useTheme()`/`theme`).
 */
import { Platform } from 'react-native';
import type { NeedId, EmotionId } from '@engine/core/types';

export interface Palette {
  background: string;
  backgroundElevated: string;
  surface: string;
  surfaceRaised: string;
  surfaceOverlay: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  accent2: string;
  accent2Soft: string;
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  needs: Record<NeedId, string>;
  gradient: [string, string, string];
  glow: string;
  shadow: string;
}

export const darkPalette: Palette = {
  background: '#0B0E14',
  backgroundElevated: '#0F131C',
  surface: '#121826',
  surfaceRaised: '#1A2235',
  surfaceOverlay: '#222C42',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  text: '#EDF1F7',
  textMuted: '#9AA6B8',
  textFaint: '#5F6B7D',
  accent: '#F5B84A',
  accentSoft: 'rgba(245,184,74,0.16)',
  accentText: '#1A1305',
  accent2: '#6EA8FE',
  accent2Soft: 'rgba(110,168,254,0.16)',
  success: '#4CD4A0',
  successSoft: 'rgba(76,212,160,0.16)',
  danger: '#FF6B6B',
  dangerSoft: 'rgba(255,107,107,0.16)',
  warning: '#FFB454',
  warningSoft: 'rgba(255,180,84,0.16)',
  needs: {
    hunger: '#FF8A5B',
    thirst: '#5BC0EB',
    energy: '#B388FF',
    bladder: '#F9C74F',
    hygiene: '#8ECAE6',
    social: '#F28482',
    fun: '#F4A261',
    comfort: '#90BE6D',
  },
  gradient: ['#0B0E14', '#10162A', '#0B0E14'],
  glow: 'rgba(245,184,74,0.25)',
  shadow: '#000000',
};

export const radii = { xs: 6, sm: 10, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const fonts = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', web: 'Georgia, "Times New Roman", "Iowan Old Style", serif', default: 'serif' }) as string,
  sans: Platform.select({ ios: undefined, android: 'sans-serif', web: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', default: undefined }) as string | undefined,
  sansMedium: Platform.select({ ios: undefined, android: 'sans-serif-medium', web: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', default: undefined }) as string | undefined,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', web: 'ui-monospace, Menlo, Consolas, monospace', default: 'monospace' }) as string,
};

export type TextVariant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'caption' | 'mono' | 'label' | 'prose';

export const typography: Record<TextVariant, { fontFamily?: string; fontSize: number; lineHeight: number; fontWeight?: '400' | '500' | '600' | '700' | '800'; letterSpacing?: number; textTransform?: 'uppercase' }> = {
  display: { fontFamily: fonts.serif, fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.5 },
  title: { fontFamily: fonts.serif, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.2 },
  heading: { fontFamily: fonts.sansMedium, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodyStrong: { fontFamily: fonts.sansMedium, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  prose: { fontFamily: fonts.serif, fontSize: 16.5, lineHeight: 25, fontWeight: '400' },
  caption: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, fontWeight: '400' },
  mono: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  label: { fontFamily: fonts.sansMedium, fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' },
};

export const shadows = {
  soft: Platform.select({
    web: { boxShadow: '0 6px 24px rgba(0,0,0,0.35)' } as object,
    default: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 } as object,
  }) as object,
  card: Platform.select({
    web: { boxShadow: '0 2px 10px rgba(0,0,0,0.25)' } as object,
    default: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 } as object,
  }) as object,
  glow: Platform.select({
    web: { boxShadow: '0 0 28px rgba(245,184,74,0.28)' } as object,
    default: { shadowColor: '#F5B84A', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 8 } as object,
  }) as object,
};

export interface Theme {
  colors: Palette;
  radii: typeof radii;
  spacing: typeof spacing;
  fonts: typeof fonts;
  typography: typeof typography;
  shadows: typeof shadows;
  isDark: boolean;
}

export const theme: Theme = { colors: darkPalette, radii, spacing, fonts, typography, shadows, isDark: true };

/** Hook-shaped accessor so components can later switch on a ThemeProvider. */
export function useTheme(): Theme {
  return theme;
}

export const NEED_META: Record<NeedId, { label: string; icon: string }> = {
  hunger: { label: 'Hunger', icon: 'silverware-fork-knife' },
  thirst: { label: 'Thirst', icon: 'cup-water' },
  energy: { label: 'Energy', icon: 'lightning-bolt' },
  bladder: { label: 'Bladder', icon: 'toilet' },
  hygiene: { label: 'Hygiene', icon: 'shower-head' },
  social: { label: 'Social', icon: 'account-group' },
  fun: { label: 'Fun', icon: 'party-popper' },
  comfort: { label: 'Comfort', icon: 'sofa' },
};

export const EMOTION_META: Record<EmotionId, { emoji: string; label: string; color: string; icon: string }> = {
  happy: { emoji: '😊', label: 'Happy', color: '#F5B84A', icon: 'emoticon-happy-outline' },
  sad: { emoji: '😢', label: 'Sad', color: '#6EA8FE', icon: 'emoticon-sad-outline' },
  angry: { emoji: '😠', label: 'Angry', color: '#FF6B6B', icon: 'emoticon-angry-outline' },
  anxious: { emoji: '😰', label: 'Anxious', color: '#B388FF', icon: 'emoticon-confused-outline' },
  stressed: { emoji: '😫', label: 'Stressed', color: '#FF8A5B', icon: 'emoticon-frown-outline' },
  bored: { emoji: '😐', label: 'Bored', color: '#9AA6B8', icon: 'emoticon-neutral-outline' },
  energized: { emoji: '⚡', label: 'Energized', color: '#F9C74F', icon: 'lightning-bolt' },
  tired: { emoji: '🥱', label: 'Tired', color: '#8A93A6', icon: 'sleep' },
  inspired: { emoji: '✨', label: 'Inspired', color: '#F4A261', icon: 'lightbulb-on-outline' },
  flirty: { emoji: '😏', label: 'Flirty', color: '#F28482', icon: 'emoticon-wink-outline' },
  embarrassed: { emoji: '😳', label: 'Embarrassed', color: '#FF8A8A', icon: 'emoticon-confused-outline' },
  confident: { emoji: '😎', label: 'Confident', color: '#4CD4A0', icon: 'emoticon-cool-outline' },
  lonely: { emoji: '🫥', label: 'Lonely', color: '#7F8AA3', icon: 'account-outline' },
  grateful: { emoji: '🙏', label: 'Grateful', color: '#90BE6D', icon: 'hand-heart' },
  guilty: { emoji: '😔', label: 'Guilty', color: '#8ECAE6', icon: 'emoticon-sad-outline' },
  proud: { emoji: '🏆', label: 'Proud', color: '#F5B84A', icon: 'trophy' },
  jealous: { emoji: '😒', label: 'Jealous', color: '#8FB339', icon: 'emoticon-devil-outline' },
  grieving: { emoji: '🖤', label: 'Grieving', color: '#6B7280', icon: 'heart-broken' },
  scared: { emoji: '😨', label: 'Scared', color: '#B388FF', icon: 'emoticon-frown-outline' },
  focused: { emoji: '🎯', label: 'Focused', color: '#5BC0EB', icon: 'bullseye-arrow' },
  playful: { emoji: '😜', label: 'Playful', color: '#F4A261', icon: 'emoticon-tongue-outline' },
  sick: { emoji: '🤒', label: 'Sick', color: '#8FB339', icon: 'emoticon-dead-outline' },
  uncomfortable: { emoji: '😣', label: 'Uncomfortable', color: '#FF8A5B', icon: 'emoticon-confused-outline' },
  tense: { emoji: '😬', label: 'Tense', color: '#FFB454', icon: 'emoticon-neutral-outline' },
  relaxed: { emoji: '😌', label: 'Relaxed', color: '#90BE6D', icon: 'emoticon-happy-outline' },
  nostalgic: { emoji: '🍂', label: 'Nostalgic', color: '#D9A579', icon: 'history' },
  hopeful: { emoji: '🌤️', label: 'Hopeful', color: '#8ECAE6', icon: 'weather-partly-cloudy' },
  in_love: { emoji: '😍', label: 'In love', color: '#F28482', icon: 'heart' },
};
