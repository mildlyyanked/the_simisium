/**
 * Procedural SVG avatar. Deterministic from AvatarParams; flat, warm, charming style.
 * Layers: backdrop → back hair → body → neck → head → ears → features → facial hair → front hair → glasses → accessory.
 */
import React, { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import type { AvatarParams, Sim } from '@engine/core/types';
import { mix, shade } from './avatarParams';
import { useTheme } from '../theme';

export interface AvatarProps {
  params?: AvatarParams | null;
  size?: number;
  /** ring color (e.g. accent for active sim) */
  ring?: string | null;
  ringWidth?: number;
  /** grey out (e.g. deceased / far away) */
  dim?: boolean;
  style?: StyleProp<ViewStyle>;
  /** small status dot color at the bottom-right */
  badge?: string | null;
  backdrop?: string;
}

const DEFAULT_PARAMS: AvatarParams = { skin: '#D9A579', hair: '#3B2A20', hairStyle: 1, eye: '#3A2A1D', faceShape: 0, accessory: 0, clothing: '#3B82F6', facialHair: 0, glasses: false };

const HEAD_CX = 50;
const HEAD_CY = 44;

function headPath(shape: number): { rx: number; ry: number; el?: boolean; path?: string } {
  switch (shape % 4) {
    case 0:
      return { rx: 22, ry: 23.5, el: true };
    case 1:
      return { rx: 20, ry: 25.5, el: true };
    case 2:
      // soft square jaw
      return { rx: 21, ry: 24, path: 'M29 30 C29 20 37 18 50 18 C63 18 71 20 71 30 L71 52 C71 63 62 69 50 69 C38 69 29 63 29 52 Z' };
    default:
      // heart: wider forehead, tapered chin
      return { rx: 22, ry: 24, path: 'M27 36 C27 22 37 18 50 18 C63 18 73 22 73 36 C73 50 64 66 50 69 C36 66 27 50 27 36 Z' };
  }
}

export const Avatar = memo(function Avatar({ params, size = 40, ring, ringWidth = 2, dim, style, badge, backdrop }: AvatarProps) {
  const t = useTheme();
  const p = params ?? DEFAULT_PARAMS;
  const skin = p.skin;
  const skinShadow = shade(skin, -0.18);
  const hair = p.hair;
  const hairDark = shade(hair, -0.2);
  const clothing = p.clothing;
  const clothingDark = shade(clothing, -0.25);
  const bg = backdrop ?? mix(clothing, t.colors.surfaceRaised, 0.72);
  const head = headPath(p.faceShape);
  const blush = mix(skin, '#FF6B8A', 0.45);
  const mouth = shade(skin, -0.45);
  const style_ = p.hairStyle % 8;
  const backHair = style_ === 3 || style_ === 4 || style_ === 6 || style_ === 7;
  const beanie = p.accessory === 3;

  return (
    <View
      style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', opacity: dim ? 0.45 : 1, borderWidth: ring ? ringWidth : 0, borderColor: ring ?? 'transparent' }, style]}
      accessible
      accessibilityRole="image"
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Circle cx={50} cy={50} r={50} fill={bg} />
        {/* subtle vignette */}
        <Circle cx={50} cy={50} r={50} fill="rgba(0,0,0,0.12)" />
        <Circle cx={50} cy={46} r={46} fill={bg} />

        {/* back hair */}
        {backHair && !beanie && (
          <G>
            {style_ === 3 && <Path d="M24 40 C24 20 36 12 50 12 C64 12 76 20 76 40 L78 84 C78 90 72 92 66 92 L34 92 C28 92 22 90 22 84 Z" fill={hair} />}
            {style_ === 4 && <Path d="M25 40 C25 18 37 12 50 12 C63 12 75 18 75 40 L75 60 C75 70 68 72 60 72 L40 72 C32 72 25 70 25 60 Z" fill={hair} />}
            {style_ === 6 && <Circle cx={50} cy={38} r={34} fill={hair} />}
            {style_ === 7 && <Path d="M66 30 C82 30 84 44 80 56 C77 66 74 74 76 84 C72 82 66 76 68 62 C70 52 70 44 66 40 Z" fill={hair} />}
            {style_ === 7 && <Path d="M74 58 C76 66 74 74 76 84" stroke={hairDark} strokeWidth={2} fill="none" strokeLinecap="round" />}
          </G>
        )}

        {/* body */}
        <Path d="M18 100 C18 82 30 74 42 72 L58 72 C70 74 82 82 82 100 Z" fill={clothing} />
        <Path d="M42 72 L50 84 L58 72 Z" fill={clothingDark} opacity={0.5} />
        {/* neck */}
        <Rect x={43} y={58} width={14} height={18} rx={5} fill={skinShadow} />
        <Rect x={44} y={56} width={12} height={16} rx={5} fill={skin} />

        {/* ears */}
        <Circle cx={HEAD_CX - head.rx + 1} cy={HEAD_CY + 2} r={4.2} fill={skin} />
        <Circle cx={HEAD_CX + head.rx - 1} cy={HEAD_CY + 2} r={4.2} fill={skin} />
        <Circle cx={HEAD_CX - head.rx + 1} cy={HEAD_CY + 2} r={2} fill={skinShadow} opacity={0.6} />
        <Circle cx={HEAD_CX + head.rx - 1} cy={HEAD_CY + 2} r={2} fill={skinShadow} opacity={0.6} />

        {/* head */}
        {head.path ? <Path d={head.path} fill={skin} /> : <Ellipse cx={HEAD_CX} cy={HEAD_CY} rx={head.rx} ry={head.ry} fill={skin} />}

        {/* blush */}
        <Ellipse cx={38} cy={51} rx={4.5} ry={2.6} fill={blush} opacity={0.35} />
        <Ellipse cx={62} cy={51} rx={4.5} ry={2.6} fill={blush} opacity={0.35} />

        {/* eyebrows */}
        <Path d="M35.5 38.5 C38 36.5 42 36.5 45 38" stroke={hairDark} strokeWidth={1.8} fill="none" strokeLinecap="round" />
        <Path d="M55 38 C58 36.5 62 36.5 64.5 38.5" stroke={hairDark} strokeWidth={1.8} fill="none" strokeLinecap="round" />

        {/* eyes */}
        <Ellipse cx={40.5} cy={44.5} rx={3.6} ry={3.9} fill="#FFFFFF" />
        <Ellipse cx={59.5} cy={44.5} rx={3.6} ry={3.9} fill="#FFFFFF" />
        <Circle cx={41} cy={45} r={2.4} fill={p.eye} />
        <Circle cx={60} cy={45} r={2.4} fill={p.eye} />
        <Circle cx={41.4} cy={45.4} r={1.3} fill="#15100C" />
        <Circle cx={60.4} cy={45.4} r={1.3} fill="#15100C" />
        <Circle cx={42.2} cy={43.8} r={0.8} fill="#FFFFFF" />
        <Circle cx={61.2} cy={43.8} r={0.8} fill="#FFFFFF" />

        {/* nose */}
        <Path d="M49 47 C47.5 50.5 47.6 52.4 50.4 52.6" stroke={skinShadow} strokeWidth={1.4} fill="none" strokeLinecap="round" />

        {/* mouth */}
        {p.facialHair === 3 ? (
          <Path d="M45 57 C48 59.5 52 59.5 55 57" stroke="#5B2A2A" strokeWidth={1.8} fill="none" strokeLinecap="round" />
        ) : (
          <Path d="M44.5 56.5 C47 60 53 60 55.5 56.5" stroke={mouth} strokeWidth={1.7} fill="none" strokeLinecap="round" />
        )}

        {/* facial hair */}
        {p.facialHair === 1 && <Path d="M31 50 C33 62 40 68 50 68 C60 68 67 62 69 50 C66 60 59 63 50 63 C41 63 34 60 31 50 Z" fill={hairDark} opacity={0.35} />}
        {p.facialHair === 2 && <Path d="M43 54.5 C46 52.5 48.5 53.5 50 54.8 C51.5 53.5 54 52.5 57 54.5 C55 56 52 56.4 50 55.6 C48 56.4 45 56 43 54.5 Z" fill={hairDark} />}
        {p.facialHair === 3 && (
          <G>
            <Path d="M29 46 C30 60 38 71 50 71 C62 71 70 60 71 46 C68 56 62 62 50 62 C38 62 32 56 29 46 Z" fill={hair} />
            <Path d="M42.5 54 C46 52 48.5 53 50 54.5 C51.5 53 54 52 57.5 54 C55 57 52 57.6 50 56.6 C48 57.6 45 57 42.5 54 Z" fill={hair} />
          </G>
        )}

        {/* front hair */}
        {!beanie && (
          <G>
            {style_ === 0 && <Path d="M28.5 40 C28 26 37 19 50 19 C63 19 72 26 71.5 40 C68 32 60 29 50 29 C40 29 32 32 28.5 40 Z" fill={hair} />}
            {style_ === 1 && <Path d="M27.5 44 C27 24 36 16 50 16 C64 16 73.5 24 72.5 40 C70 30 62 27 50 28 C46 28.5 40 30 36 35 C32 39 30 42 27.5 44 Z" fill={hair} />}
            {style_ === 2 && (
              <G>
                <Path d="M28 40 C28 24 37 17 50 17 C63 17 72 24 72 40 C68 31 60 28 50 28 C40 28 32 31 28 40 Z" fill={hair} />
                {[30, 36, 43, 50, 57, 64, 70].map((x, i) => (
                  <Circle key={i} cx={x} cy={i === 0 || i === 6 ? 34 : i === 1 || i === 5 ? 26 : 21} r={i === 3 ? 7 : 6} fill={hair} />
                ))}
                {[33, 47, 60, 67].map((x, i) => (
                  <Circle key={`h${i}`} cx={x} cy={i === 0 ? 24 : i === 3 ? 25 : 18} r={4.5} fill={hair} />
                ))}
              </G>
            )}
            {style_ === 3 && <Path d="M26 44 C25 22 36 14 50 14 C64 14 75 22 74 44 C71 32 63 27 50 27 C37 27 29 32 26 44 Z" fill={hair} />}
            {style_ === 4 && <Path d="M26 44 C25 22 36 14 50 14 C64 14 75 22 74 44 C72 33 66 30 58 30 C52 30 46 32 40 32 C33 32 29 36 26 44 Z" fill={hair} />}
            {style_ === 5 && (
              <G>
                <Path d="M28 40 C28 23 37 16 50 16 C63 16 72 23 72 40 C68 31 60 27 50 27 C40 27 32 31 28 40 Z" fill={hair} />
                <Circle cx={50} cy={15} r={9} fill={hair} />
                <Circle cx={47} cy={12} r={3} fill={hairDark} opacity={0.5} />
              </G>
            )}
            {style_ === 6 && <Path d="M27 42 C27 22 37 15 50 15 C63 15 73 22 73 42 C69 32 61 28 50 28 C39 28 31 32 27 42 Z" fill={hair} />}
            {style_ === 7 && <Path d="M28 42 C28 23 37 16 50 16 C63 16 72 23 72 42 C68 32 60 28 50 28 C40 28 32 32 28 42 Z" fill={hair} />}
            {/* hair sheen */}
            {style_ !== 2 && <Path d="M36 24 C40 20 46 19 52 19" stroke="#FFFFFF" strokeWidth={1.6} opacity={0.18} fill="none" strokeLinecap="round" />}
          </G>
        )}

        {/* glasses */}
        {p.glasses && (
          <G>
            <Circle cx={40.5} cy={45} r={7.2} stroke="#2B2320" strokeWidth={1.7} fill="rgba(255,255,255,0.08)" />
            <Circle cx={59.5} cy={45} r={7.2} stroke="#2B2320" strokeWidth={1.7} fill="rgba(255,255,255,0.08)" />
            <Line x1={47.7} y1={44} x2={52.3} y2={44} stroke="#2B2320" strokeWidth={1.6} />
            <Line x1={33.3} y1={43.5} x2={29} y2={42} stroke="#2B2320" strokeWidth={1.4} />
            <Line x1={66.7} y1={43.5} x2={71} y2={42} stroke="#2B2320" strokeWidth={1.4} />
          </G>
        )}

        {/* accessories */}
        {p.accessory === 1 && (
          <G>
            <Circle cx={HEAD_CX - head.rx + 1} cy={HEAD_CY + 7} r={1.8} fill="#F5B84A" />
            <Circle cx={HEAD_CX + head.rx - 1} cy={HEAD_CY + 7} r={1.8} fill="#F5B84A" />
          </G>
        )}
        {p.accessory === 2 && <Path d="M28 33 C34 27 42 24.5 50 24.5 C58 24.5 66 27 72 33 C66 30 58 28.5 50 28.5 C42 28.5 34 30 28 33 Z" fill={mix(clothing, '#FFFFFF', 0.15)} />}
        {p.accessory === 3 && (
          <G>
            <Path d="M26 42 C26 20 36 13 50 13 C64 13 74 20 74 42 C71 34 62 31 50 31 C38 31 29 34 26 42 Z" fill={clothingDark} />
            <Path d="M27 40 C33 34 41 32 50 32 C59 32 67 34 73 40 L73 44 C67 39 59 37 50 37 C41 37 33 39 27 44 Z" fill={clothing} />
            <Circle cx={50} cy={13} r={4} fill={mix(clothing, '#FFFFFF', 0.4)} />
          </G>
        )}
        {p.accessory === 4 && (
          <G>
            <Path d="M40 76 C44 82 56 82 60 76" stroke="#F5B84A" strokeWidth={1.4} fill="none" />
            <Circle cx={50} cy={81} r={2} fill="#F5B84A" />
          </G>
        )}
      </Svg>
      {badge ? <View style={{ position: 'absolute', right: 0, bottom: 0, width: Math.max(8, size * 0.24), height: Math.max(8, size * 0.24), borderRadius: 99, backgroundColor: badge, borderWidth: 2, borderColor: t.colors.background }} /> : null}
    </View>
  );
});

export function SimAvatar({ sim, ...rest }: Omit<AvatarProps, 'params'> & { sim: Sim | null | undefined }): React.ReactElement {
  return <Avatar params={sim?.identity.appearance.avatar} dim={sim ? !sim.body.alive : false} {...rest} />;
}

export default Avatar;
