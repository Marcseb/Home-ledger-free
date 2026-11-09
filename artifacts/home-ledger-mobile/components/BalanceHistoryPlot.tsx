import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { formatCurrency, useI18n, type Locale } from '@/lib/i18n';
import type { BalanceHistoryPoint, HistoryAccount, HistoryInterval } from '@/lib/balance-history';

export type HistoryView = 'trend' | 'composition';

type Props = {
  points: BalanceHistoryPoint[];
  accounts: HistoryAccount[];
  view: HistoryView;
  interval: HistoryInterval;
  selectedIndex: number;
  onSelect: (index: number) => void;
  currency: string;
  locale: Locale;
};

const HEIGHT = 186;
const TOP = 15;
const BOTTOM = 169;
const LEFT = 56;
const RIGHT = 8;

function bandPath(upper: number[], lower: number[], x: (index: number) => number, y: (value: number) => number): string {
  const top = upper.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`);
  const bottom = lower.map((_, index) => {
    const reversed = lower.length - index - 1;
    return `L${x(reversed).toFixed(1)},${y(lower[reversed]).toFixed(1)}`;
  });
  return `${top.join(' ')} ${bottom.join(' ')} Z`;
}

function dateLabel(iso: string, locale: Locale, interval: 'day' | 'week' | 'month'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'short',
    ...(interval === 'month' ? { year: '2-digit' as const } : { day: 'numeric' as const }),
  }).format(new Date(`${iso}T12:00:00Z`));
}

export function BalanceHistoryPlot({ points, accounts, view, interval, selectedIndex, onSelect, currency, locale }: Props) {
  const c = useColors();
  const { t } = useI18n();
  const [width, setWidth] = useState(0);
  const plotWidth = Math.max(1, width - LEFT - RIGHT);
  const x = (index: number) => LEFT + index / Math.max(1, points.length - 1) * plotWidth;
  const totals = points.map((point) => point.totalMinor);

  const positive = Array<number>(points.length).fill(0);
  const negative = Array<number>(points.length).fill(0);
  const layers = accounts.map((account, index) => {
    const positiveBase = [...positive];
    const negativeBase = [...negative];
    points.forEach((point, pointIndex) => {
      const amount = point.balances[account.id] ?? 0;
      positive[pointIndex] += Math.max(0, amount);
      negative[pointIndex] += Math.min(0, amount);
    });
    return {
      color: c.historySeries[index % c.historySeries.length],
      positiveBase,
      positiveTop: [...positive],
      negativeBase,
      negativeBottom: [...negative],
    };
  });

  let min = view === 'composition' ? Math.min(0, ...negative) : Math.min(...totals);
  let max = view === 'composition' ? Math.max(0, ...positive) : Math.max(...totals);
  if (min === max) {
    const padding = Math.max(100, Math.abs(min) * 0.08);
    min -= padding;
    max += padding;
  } else if (view === 'trend') {
    const padding = (max - min) * 0.1;
    min -= padding;
    max += padding;
  }
  const y = (value: number) => BOTTOM - (value - min) / (max - min) * (BOTTOM - TOP);
  const selected = points[selectedIndex];
  const compact = (amount: number) => new Intl.NumberFormat(locale, {
    style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1,
  }).format(amount / 100);
  const fullDate = selected ? new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(selected.closingAt)) : '';

  return (
    <View>
      <View
        style={{ height: HEIGHT }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 ? <>
          <Svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`}>
            {[TOP, (TOP + BOTTOM) / 2, BOTTOM].map((gridY) => (
              <Line key={gridY} x1={LEFT} x2={width - RIGHT} y1={gridY} y2={gridY} stroke={c.border} strokeWidth={1} />
            ))}
            {min < 0 && max > 0 ? <Line x1={LEFT} x2={width - RIGHT} y1={y(0)} y2={y(0)} stroke={c.mutedForeground} strokeWidth={1.2} strokeDasharray="4 4" /> : null}
            <SvgText x={2} y={TOP + 3} fontSize={10} fill={c.mutedForeground}>{compact(max)}</SvgText>
            <SvgText x={2} y={BOTTOM} fontSize={10} fill={c.mutedForeground}>{compact(min)}</SvgText>
            {view === 'composition' ? layers.map((layer, index) => (
              <G key={accounts[index].id}>
                {layer.positiveTop.some((value, pointIndex) => value !== layer.positiveBase[pointIndex]) ? (
                  <Path d={bandPath(layer.positiveTop, layer.positiveBase, x, y)} fill={layer.color} fillOpacity={0.82} stroke={layer.color} strokeWidth={0.7} />
                ) : null}
                {layer.negativeBottom.some((value, pointIndex) => value !== layer.negativeBase[pointIndex]) ? (
                  <Path d={bandPath(layer.negativeBase, layer.negativeBottom, x, y)} fill={layer.color} fillOpacity={0.82} stroke={layer.color} strokeWidth={0.7} />
                ) : null}
              </G>
            )) : <>
              {points.slice(1).map((point, index) => (
                <Line
                  key={point.startDate}
                  x1={x(index)}
                  y1={y(points[index].totalMinor)}
                  x2={x(index + 1)}
                  y2={y(point.totalMinor)}
                  stroke={c.primary}
                  strokeWidth={2.7}
                  strokeLinecap="round"
                  strokeDasharray={points[index].unverifiedStart || point.unverifiedStart ? '4 4' : undefined}
                />
              ))}
              {points.map((point, index) => (
                <Circle key={point.startDate} cx={x(index)} cy={y(point.totalMinor)} r={index === selectedIndex ? 5 : 2.8} fill={c.primary} stroke={c.card} strokeWidth={index === selectedIndex ? 2 : 0.8} />
              ))}
            </>}
            <Line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={TOP} y2={BOTTOM} stroke={c.mutedForeground} strokeWidth={1} strokeDasharray="3 4" />
            {view === 'composition' ? layers.map((layer, index) => {
              const amount = selected?.balances[accounts[index].id] ?? 0;
              const edge = amount >= 0 ? layer.positiveTop[selectedIndex] : layer.negativeBottom[selectedIndex];
              return amount !== 0 ? <Circle key={accounts[index].id} cx={x(selectedIndex)} cy={y(edge)} r={4} fill={layer.color} stroke={c.card} strokeWidth={1.5} /> : null;
            }) : null}
          </Svg>
          <Pressable
            testID="balance-history-plot"
            style={StyleSheet.absoluteFill}
            accessibilityRole="adjustable"
            accessibilityLabel={t('balanceHistory')}
            accessibilityValue={{ text: selected ? `${fullDate}, ${formatCurrency(selected.totalMinor, currency, locale)}` : '' }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(event) => onSelect(Math.min(points.length - 1, Math.max(0, selectedIndex + (event.nativeEvent.actionName === 'increment' ? 1 : -1))))}
            onPress={(event) => {
              // Native presses expose locationX; React Native Web's click
              // event can expose only offsetX. Never send NaN into selection.
              const native = event.nativeEvent as typeof event.nativeEvent & { offsetX?: number };
              const pressedX = Number.isFinite(native.locationX) ? native.locationX : native.offsetX;
              if (typeof pressedX !== 'number' || !Number.isFinite(pressedX)) return;
              onSelect(Math.min(points.length - 1, Math.max(0, Math.round((pressedX - LEFT) / plotWidth * (points.length - 1)))));
            }}
          />
        </> : null}
      </View>
      <View style={{ marginLeft: LEFT, marginRight: RIGHT, flexDirection: 'row', justifyContent: 'space-between', marginTop: 1 }}>
        {[points[0], points[Math.floor((points.length - 1) / 2)], points[points.length - 1]]
          .filter((point): point is BalanceHistoryPoint => Boolean(point)).map((point, index) => (
          <Text key={`${point.startDate}-${index}`} style={{ color: c.mutedForeground, fontSize: 10, fontFamily: 'Inter_500Medium' }}>
            {dateLabel(point.startDate, locale, interval)}
          </Text>
          ))}
      </View>
    </View>
  );
}