import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import type { Venue } from '@engine/core/types';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Icon, ARCHETYPE_ICON } from '../icons';
import { Pill } from './Chip';
import { km, openStatus, priceLevel, titleCase } from '../format';
import { haptic } from '../haptics';

export interface VenueCardProps {
  venue: Venue;
  epoch: string;
  minute: number;
  isOpen: boolean;
  distanceKm?: number;
  travelMinutes?: number;
  favorite?: boolean;
  here?: boolean;
  onPress?: () => void;
  onFavorite?: () => void;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  knownCount?: number;
}

export function VenueCard({ venue, epoch, minute, isOpen, distanceKm, travelMinutes, favorite, here, onPress, onFavorite, style, compact, knownCount }: VenueCardProps): React.ReactElement {
  const t = useTheme();
  const g = venue.google;
  const status = openStatus(g?.openingPeriods, epoch, minute, isOpen);
  const holidayClosed = venue.tags.includes('holiday_closed');
  const statusColor = holidayClosed ? t.colors.warning : status.open ? t.colors.success : t.colors.textMuted;
  const statusLabel = holidayClosed ? 'Closed for the holiday' : status.label;
  const alwaysOpen = venue.archetype === 'home' || venue.archetype === 'park' || venue.archetype === 'atm' || venue.archetype === 'transit_stop' || venue.archetype === 'parking';
  return (
    <Pressable
      onPress={() => {
        haptic.select();
        onPress?.();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${venue.name}, ${titleCase(venue.archetype)}, ${statusLabel}`}
      style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }, style]}
    >
      <View style={[{ backgroundColor: t.colors.surface, borderRadius: t.radii.lg, borderWidth: 1, borderColor: here ? t.colors.accent : t.colors.border, padding: compact ? 10 : 14, flexDirection: 'row', gap: 12 }, t.shadows.card]}>
        <View style={{ width: compact ? 40 : 48, height: compact ? 40 : 48, borderRadius: 14, backgroundColor: here ? t.colors.accentSoft : t.colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={ARCHETYPE_ICON[venue.archetype]} size={compact ? 20 : 24} color={here ? t.colors.accent : t.colors.text} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {venue.name}
            </Text>
            {onFavorite ? (
              <Pressable onPress={onFavorite} hitSlop={8} accessibilityLabel={favorite ? 'Remove favorite' : 'Add favorite'} accessibilityRole="button">
                <Icon name={favorite ? 'bookmark' : 'bookmark-outline'} size={18} color={favorite ? t.colors.accent : t.colors.textFaint} />
              </Pressable>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text variant="caption" muted>
              {titleCase(venue.archetype)}
            </Text>
            {g?.rating ? (
              <>
                <Text variant="caption" faint>
                  ·
                </Text>
                <Icon name="star" size={11} color={t.colors.accent} />
                <Text variant="caption" muted>
                  {g.rating.toFixed(1)}
                  {g.userRatingCount ? ` (${g.userRatingCount.toLocaleString('en-US')})` : ''}
                </Text>
              </>
            ) : null}
            {g?.priceLevel !== undefined && g.priceLevel > 0 ? (
              <>
                <Text variant="caption" faint>
                  ·
                </Text>
                <Text variant="caption" muted>
                  {priceLevel(g.priceLevel)}
                </Text>
              </>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {here ? <Pill label="You’re here" color={t.colors.accent} icon="map-marker" /> : alwaysOpen && !holidayClosed ? <Pill label="Open" color={t.colors.success} /> : <Pill label={statusLabel} color={statusColor} />}
            {distanceKm !== undefined && !here ? (
              <Text variant="caption" muted>
                {km(distanceKm)}
                {travelMinutes !== undefined ? ` · ~${Math.max(1, Math.round(travelMinutes))} min` : ''}
              </Text>
            ) : null}
            {knownCount ? (
              <Text variant="caption" muted>
                · {knownCount} you know
              </Text>
            ) : null}
          </View>
          {!compact && g?.reviewThemes?.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 3 }}>
              {g.reviewThemes.slice(0, 3).map((th) => (
                <Pill key={th} label={th} size="xs" />
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default VenueCard;
