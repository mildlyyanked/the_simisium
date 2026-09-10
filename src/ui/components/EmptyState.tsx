import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon } from '../icons';
import { Button } from './Button';

export function EmptyState({ icon = 'creation', title, body, action, onAction, style, compact }: { icon?: string; title: string; body?: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle>; compact?: boolean }): React.ReactElement {
  const t = useTheme();
  return (
    <View style={[{ alignItems: 'center', paddingVertical: compact ? 20 : 40, paddingHorizontal: 24, gap: 8 }, style]}>
      <View style={{ width: compact ? 44 : 64, height: compact ? 44 : 64, borderRadius: 20, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
        <Icon name={icon} size={compact ? 22 : 30} color={t.colors.accent} />
      </View>
      <Text variant={compact ? 'heading' : 'title'} center>
        {title}
      </Text>
      {body ? (
        <Text variant="body" muted center style={{ maxWidth: 320 }}>
          {body}
        </Text>
      ) : null}
      {action && onAction ? <Button title={action} onPress={onAction} variant="secondary" style={{ marginTop: 8 }} /> : null}
    </View>
  );
}

export default EmptyState;
