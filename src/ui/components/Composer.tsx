import React, { useState } from 'react';
import { Pressable, ScrollView, TextInput, View, Platform } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon } from '../icons';
import { Chip } from './Chip';
import { haptic } from '../haptics';

export type ComposerMode = 'do' | 'say';

export interface ComposerProps {
  mode: ComposerMode;
  onModeChange?: (m: ComposerMode) => void;
  /** hide the mode toggle (conversation mode forces 'say') */
  lockMode?: boolean;
  suggestions?: string[];
  onSubmit: (text: string, mode: ComposerMode) => void;
  disabled?: boolean;
  placeholder?: string;
  leftAccessory?: React.ReactNode;
}

export function Composer({ mode, onModeChange, lockMode, suggestions = [], onSubmit, disabled, placeholder, leftAccessory }: ComposerProps): React.ReactElement {
  const t = useTheme();
  const [text, setText] = useState('');
  const canSend = text.trim().length > 0 && !disabled;
  const send = (value?: string) => {
    const v = (value ?? text).trim();
    if (!v || disabled) return;
    haptic.light();
    onSubmit(v, mode);
    setText('');
  };
  const ph = placeholder ?? (mode === 'say' ? 'Say something…' : 'Try anything. "Ask the barista about the job posting"…');
  return (
    <View style={{ backgroundColor: t.colors.backgroundElevated, borderTopWidth: 1, borderTopColor: t.colors.border, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, gap: 8 }}>
      {suggestions.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6, paddingRight: 12 }}>
          {suggestions.map((s, i) => (
            <Chip key={`${i}_${s}`} label={s} size="sm" icon={mode === 'say' ? 'message-reply-text' : 'creation'} onPress={() => send(s)} disabled={disabled} />
          ))}
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        {leftAccessory}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: t.colors.surface, borderRadius: 22, borderWidth: 1, borderColor: t.colors.border, paddingLeft: 6, paddingRight: 6, minHeight: 44 }}>
          {!lockMode ? (
            <Pressable
              onPress={() => {
                haptic.select();
                onModeChange?.(mode === 'do' ? 'say' : 'do');
              }}
              accessibilityRole="button"
              accessibilityLabel={mode === 'do' ? 'Switch to say mode' : 'Switch to do mode'}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 32, borderRadius: 16, backgroundColor: mode === 'say' ? t.colors.accent2Soft : t.colors.accentSoft, marginBottom: 5, marginTop: 5 }}
            >
              <Icon name={mode === 'say' ? 'message-text' : 'creation'} size={13} color={mode === 'say' ? t.colors.accent2 : t.colors.accent} />
              <Text variant="caption" weight="700" color={mode === 'say' ? t.colors.accent2 : t.colors.accent}>
                {mode === 'say' ? 'Say' : 'Do'}
              </Text>
            </Pressable>
          ) : (
            <View style={{ paddingLeft: 8, paddingBottom: 12 }}>
              <Icon name="message-text" size={16} color={t.colors.accent2} />
            </View>
          )}
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={ph}
            placeholderTextColor={t.colors.textFaint}
            multiline
            editable={!disabled}
            blurOnSubmit={Platform.OS !== 'web'}
            onSubmitEditing={() => send()}
            returnKeyType="send"
            onKeyPress={(e) => {
              if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !(e.nativeEvent as unknown as { shiftKey?: boolean }).shiftKey) {
                (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                send();
              }
            }}
            accessibilityLabel={mode === 'say' ? 'Say something' : 'Describe an action'}
            style={{ flex: 1, color: t.colors.text, fontSize: 15 * 1, lineHeight: 20, paddingHorizontal: 8, paddingVertical: Platform.OS === 'ios' ? 12 : 10, maxHeight: 110, fontFamily: t.fonts.sans }}
          />
        </View>
        <Pressable
          onPress={() => send()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send"
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: canSend ? t.colors.accent : t.colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1, borderWidth: 1, borderColor: canSend ? t.colors.accent : t.colors.border })}
        >
          <Icon name="send" size={18} color={canSend ? t.colors.accentText : t.colors.textFaint} />
        </Pressable>
      </View>
    </View>
  );
}

export default Composer;
