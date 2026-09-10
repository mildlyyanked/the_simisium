import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { WeatherState } from '@engine/core/types';
import type { ClockInfo } from '@engine/core/clock';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon, WEATHER_ICON } from '../icons';
import { Sheet } from './Sheet';
import { ListRow } from './ListRow';
import { haptic } from '../haptics';
import { titleCase } from '../format';

export interface TimeBarProps {
  clock: ClockInfo;
  weather: WeatherState;
  onWait: (minutes: number) => void;
  onWaitUntilMorning: () => void;
  onSkipToNextEvent: () => void;
  nextEventLabel?: string;
  disabled?: boolean;
  holidays?: string[];
}

export function TimeBar({ clock, weather, onWait, onWaitUntilMorning, onSkipToNextEvent, nextEventLabel, disabled, holidays }: TimeBarProps): React.ReactElement {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const w = weather.current;
  const night = !clock.isDaylight;
  const wIcon = night && (w.condition === 'clear' || w.condition === 'partly_cloudy') ? 'weather-night' : WEATHER_ICON[w.condition] ?? 'weather-sunny';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: t.colors.backgroundElevated, borderTopWidth: 1, borderTopColor: t.colors.border }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text variant="heading" numberOfLines={1} style={{ fontVariant: ["tabular-nums"] }}>
            {clock.timeLabel}
          </Text>
          <Text variant="caption" muted numberOfLines={1} style={{ flexShrink: 1 }}>
            {clock.dateLabel.replace(/, \d{4}$/, '')}
          </Text>
        </View>
        {holidays?.length ? (
          <Text variant="caption" accent numberOfLines={1}>
            {holidays.map((h) => titleCase(h)).join(' · ')}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessible accessibilityLabel={`${titleCase(w.condition)}, ${Math.round(w.tempF)} degrees`}>
        <Icon name={wIcon} size={18} color={t.colors.accent2} />
        <Text variant="body" weight="600">
          {Math.round(w.tempF)}°
        </Text>
      </View>
      <Pressable
        onPress={() => {
          haptic.select();
          setOpen(true);
        }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Pass time"
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 36, borderRadius: t.radii.pill, backgroundColor: t.colors.surfaceRaised, borderWidth: 1, borderColor: t.colors.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 })}
      >
        <Icon name="timer-sand" size={15} color={t.colors.accent} />
        <Text variant="body" weight="600">
          Wait
        </Text>
        <Icon name="chevron-up" size={14} color={t.colors.textMuted} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Pass the time" subtitle={`${clock.dateLabel} · ${clock.timeLabel}`}>
        <View style={{ paddingBottom: 8 }}>
          {[
            { label: '15 minutes', sub: 'A short breather', min: 15, icon: 'clock-fast' },
            { label: '1 hour', sub: 'Let things settle', min: 60, icon: 'clock-outline' },
            { label: '3 hours', sub: 'Half a shift', min: 180, icon: 'clock-time-three-outline' },
          ].map((o) => (
            <ListRow
              key={o.min}
              icon={o.icon}
              title={o.label}
              subtitle={o.sub}
              chevron
              onPress={() => {
                setOpen(false);
                onWait(o.min);
              }}
            />
          ))}
          <ListRow
            icon="weather-sunset-up"
            title="Until morning"
            subtitle="Wait until 7:00 AM"
            chevron
            onPress={() => {
              setOpen(false);
              onWaitUntilMorning();
            }}
          />
          <ListRow
            icon="skip-next"
            title="Skip to next event"
            subtitle={nextEventLabel ?? 'Nothing scheduled soon'}
            chevron
            last
            onPress={() => {
              setOpen(false);
              onSkipToNextEvent();
            }}
          />
          <Text variant="caption" faint style={{ marginTop: 10 }}>
            Time stops if something needs your attention — a call, a knock at the door, a need hitting critical.
          </Text>
        </View>
      </Sheet>
    </View>
  );
}

export default TimeBar;
