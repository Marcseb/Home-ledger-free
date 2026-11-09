import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Keyboard, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { translateLiteral, useI18n } from '@/lib/i18n';

type CalendarProps = {
  month: string;
  selectedDate: string;
  today: string;
  onMonthChange: (month: string) => void;
  onClose: () => void;
  onSelect: (date: string) => void;
};

export function DatePickerField({ value, onPress, testID }: { value: string; onPress: () => void; testID: string }) {
  const c = useColors();
  const { locale } = useI18n();
  const label = translateLiteral('Date (YYYY-MM-DD)', locale);
  return <Pressable
    testID={testID}
    accessibilityRole="button"
    accessibilityLabel={`${label}: ${value}`}
    accessibilityHint={translateLiteral('Open the calendar to choose the entry date.', locale)}
    onPress={() => { Keyboard.dismiss(); onPress(); }}
    style={({ pressed }) => [styles.dateInput, { borderColor: c.input, backgroundColor: c.card, opacity: pressed ? 0.8 : 1 }]}
  >
    <View style={styles.dateTextBlock}>
      <Text style={[styles.dateLabel, { color: c.mutedForeground }]}>{label}</Text>
      <Text style={[styles.dateValue, { color: c.foreground }]}>{value}</Text>
    </View>
    <Feather name="calendar" size={19} color={c.primary} />
  </Pressable>;
}

export function DatePickerModal({ visible, ...calendar }: CalendarProps & { visible: boolean }) {
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={calendar.onClose}>
    {visible ? <DatePickerCalendar {...calendar} /> : null}
  </Modal>;
}

export function DatePickerCalendar({ month, selectedDate, today, onMonthChange, onClose, onSelect }: CalendarProps) {
  const c = useColors();
  const { locale } = useI18n();
  const tr = (value: string) => translateLiteral(value, locale);
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const monthStart = new Date(Date.UTC(year, monthNumber - 1, 1, 12));
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(monthStart);
  const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const weekdays = Array.from({ length: 7 }, (_, index) => weekdayFormatter.format(new Date(Date.UTC(2024, 0, 1 + index, 12))));
  const firstDayOffset = (monthStart.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstDayOffset + 1;
    if (day < 1 || day > daysInMonth) return null;
    return `${yearText}-${monthText}-${String(day).padStart(2, '0')}`;
  });

  return <View style={styles.calendarOverlay}>
    <Pressable accessibilityRole="button" accessibilityLabel={tr('Close calendar')} onPress={onClose} style={StyleSheet.absoluteFill} />
    <View accessibilityViewIsModal style={[styles.calendarCard, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.calendarHeader}>
        <Pressable
          testID="date-calendar-previous-month"
          accessibilityRole="button"
          accessibilityLabel={tr('Previous month')}
          onPress={() => onMonthChange(shiftCalendarMonth(month, -1))}
          style={({ pressed }) => [styles.calendarIconButton, { backgroundColor: pressed ? c.secondary : c.muted }]}
        >
          <Feather name="chevron-left" size={19} color={c.foreground} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.calendarMonth, { color: c.foreground }]}>{monthLabel}</Text>
        <Pressable
          testID="date-calendar-next-month"
          accessibilityRole="button"
          accessibilityLabel={tr('Next month')}
          onPress={() => onMonthChange(shiftCalendarMonth(month, 1))}
          style={({ pressed }) => [styles.calendarIconButton, { backgroundColor: pressed ? c.secondary : c.muted }]}
        >
          <Feather name="chevron-right" size={19} color={c.foreground} />
        </Pressable>
      </View>
      <View style={styles.calendarWeek}>
        {weekdays.map((weekday, index) => <Text key={`${weekday}-${index}`} style={[styles.calendarWeekday, { color: c.mutedForeground }]}>{weekday}</Text>)}
      </View>
      {Array.from({ length: 6 }, (_, weekIndex) => <View key={weekIndex} style={styles.calendarWeek}>
        {days.slice(weekIndex * 7, weekIndex * 7 + 7).map((day, dayIndex) => {
          if (!day) return <View key={`empty-${dayIndex}`} style={styles.calendarDayCell} />;
          const selected = day === selectedDate;
          const isToday = day === today;
          return <Pressable
            key={day}
            testID={`date-calendar-day-${day}`}
            accessibilityRole="button"
            accessibilityLabel={day}
            accessibilityState={{ selected }}
            onPress={() => onSelect(day)}
            style={({ pressed }) => [styles.calendarDayCell, {
              backgroundColor: selected ? c.primary : pressed ? c.secondary : 'transparent',
              borderColor: isToday ? c.primary : 'transparent',
            }]}
          >
            <Text style={[styles.calendarDayText, { color: selected ? c.primaryForeground : isToday ? c.primary : c.foreground }]}>{Number(day.slice(-2))}</Text>
          </Pressable>;
        })}
      </View>)}
      <View style={[styles.calendarFooter, { borderTopColor: c.border }]}>
        <Pressable
          testID="date-calendar-today"
          accessibilityRole="button"
          onPress={() => onSelect(today)}
          style={({ pressed }) => [styles.calendarToday, { backgroundColor: pressed ? c.secondary : c.muted }]}
        >
          <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>{tr('Today')}</Text>
        </Pressable>
      </View>
    </View>
  </View>;
}

function shiftCalendarMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  dateInput: { minHeight: 62, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, marginBottom: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateTextBlock: { gap: 4 },
  dateLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  dateValue: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  calendarOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 18, backgroundColor: 'rgba(0,0,0,0.36)' },
  calendarCard: { width: '100%', maxWidth: 360, borderWidth: 1, borderRadius: 22, padding: 17 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  calendarMonth: { flex: 1, textAlign: 'center', fontFamily: 'Inter_700Bold', fontSize: 18, textTransform: 'capitalize' },
  calendarIconButton: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  calendarWeek: { flexDirection: 'row' },
  calendarWeekday: { flex: 1, height: 30, lineHeight: 30, textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  calendarDayCell: { flex: 1, height: 42, margin: 1, borderWidth: 1, borderColor: 'transparent', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  calendarDayText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  calendarFooter: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10, paddingTop: 10, alignItems: 'center' },
  calendarToday: { minHeight: 40, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});