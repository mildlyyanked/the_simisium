import React from 'react';
import { ScrollView, View } from 'react-native';
import type { Interrupt, Sim } from '@engine/core/types';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Dialog } from './Sheet';
import { Button } from './Button';
import { Icon } from '../icons';
import { SimAvatar } from '../avatar/Avatar';

const KIND_META: Record<Interrupt['kind'], { icon: string; color: string; label: string }> = {
  need_critical: { icon: 'alert-circle', color: '#FF8A5B', label: 'Critical need' },
  phone_call: { icon: 'phone-in-talk', color: '#6EA8FE', label: 'Incoming call' },
  text: { icon: 'message-text', color: '#6EA8FE', label: 'New message' },
  visitor: { icon: 'door', color: '#F5B84A', label: 'At the door' },
  emergency: { icon: 'ambulance', color: '#FF6B6B', label: 'Emergency' },
  police: { icon: 'police-badge', color: '#6EA8FE', label: 'Police' },
  event: { icon: 'calendar-star', color: '#F5B84A', label: 'Event' },
  death: { icon: 'candle', color: '#9AA6B8', label: 'Loss' },
  birth: { icon: 'baby-face', color: '#F28482', label: 'New life' },
  weather: { icon: 'weather-lightning', color: '#5BC0EB', label: 'Weather alert' },
  fire: { icon: 'fire', color: '#FF6B6B', label: 'Fire' },
  accident: { icon: 'car-emergency', color: '#FF6B6B', label: 'Accident' },
  delivery: { icon: 'package-variant', color: '#4CD4A0', label: 'Delivery' },
  reminder: { icon: 'bell', color: '#F5B84A', label: 'Reminder' },
};

export function InterruptModal({ interrupt, fromSim, onResolve }: { interrupt: Interrupt | null; fromSim?: Sim | null; onResolve: (id: string, actionId?: string, params?: Record<string, unknown>) => void }): React.ReactElement | null {
  const t = useTheme();
  const meta = interrupt ? KIND_META[interrupt.kind] ?? KIND_META.event : KIND_META.event;
  return (
    <Dialog visible={!!interrupt} onClose={() => interrupt && onResolve(interrupt.id)} dismissable={false}>
      {interrupt ? (
        <View style={{ gap: 14 }} accessibilityLiveRegion="assertive">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {fromSim ? (
              <SimAvatar sim={fromSim} size={52} ring={meta.color} />
            ) : (
              <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: `${meta.color}22`, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={meta.icon} size={26} color={meta.color} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text variant="label" color={meta.color}>
                {meta.label}
              </Text>
              <Text variant="title">{interrupt.title}</Text>
            </View>
          </View>
          <ScrollView style={{ maxHeight: 220 }}>
            <Text variant="prose">{interrupt.body}</Text>
          </ScrollView>
          <View style={{ gap: 8 }}>
            {interrupt.options.map((o, i) => (
              <Button key={`${o.actionId}_${i}`} title={o.label} full variant={i === 0 ? 'primary' : 'secondary'} onPress={() => onResolve(interrupt.id, o.actionId, o.params)} />
            ))}
            {interrupt.options.length === 0 ? <Button title="Okay" full onPress={() => onResolve(interrupt.id)} /> : <Button title="Ignore" full variant="ghost" onPress={() => onResolve(interrupt.id)} />}
          </View>
          <Text variant="caption" faint center>
            Time is paused.
          </Text>
        </View>
      ) : null}
    </Dialog>
  );
}

export default InterruptModal;
