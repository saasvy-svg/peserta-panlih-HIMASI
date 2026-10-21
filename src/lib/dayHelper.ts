import { getWIBDate } from '@/lib/utils';
import { ExtraTexts, DayConfigItem } from '@/types/database';

/**
 * Calculates the next day (YYYY-MM-DD) in WIB
 */
export function getNextWIBDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00+07:00');
    d.setDate(d.getDate() + 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (e) {
    return dateStr;
  }
}

/**
 * Returns the normalized list of configured days.
 * Defaults to Day 1 (today) & Day 2 (tomorrow).
 */
export function getDaysList(extraTexts?: ExtraTexts): DayConfigItem[] {
  if (extraTexts?.days && Array.isArray(extraTexts.days) && extraTexts.days.length > 0) {
    return extraTexts.days.map((d, idx) => ({
      dayNumber: idx + 1,
      date: d.date || getWIBDate(),
      label: d.label || `Hari ${idx + 1}`,
    }));
  }

  const today = getWIBDate();
  const day1 = extraTexts?.day1_date || today;
  const day2 = extraTexts?.day2_date || getNextWIBDate(day1);
  return [
    { dayNumber: 1, date: day1, label: 'Hari 1' },
    { dayNumber: 2, date: day2, label: 'Hari 2' },
  ];
}

export interface DayResolution {
  activeDay: number;
  isAuto: boolean;
  days: DayConfigItem[];
  day1Date: string;
  day2Date: string;
  effectiveDate: string;
}

/**
 * Resolves whether the current attendance session is Day 1, Day 2, Day 3, etc.
 * Supports automatic date-based switching or manual admin override.
 */
export function resolveActiveDay(
  extraTexts?: ExtraTexts,
  explicitTargetDate?: string
): DayResolution {
  const days = getDaysList(extraTexts);
  const activeSetting = extraTexts?.active_day || 'auto';
  const today = getWIBDate();

  const day1Date = days[0]?.date || today;
  const day2Date = days[1]?.date || getNextWIBDate(day1Date);

  // Manual override (e.g. 1, 2, 3...)
  if (typeof activeSetting === 'number' && activeSetting >= 1) {
    const matched = days.find((d) => d.dayNumber === activeSetting) || days[0];
    return {
      activeDay: matched.dayNumber,
      isAuto: false,
      days,
      day1Date,
      day2Date,
      effectiveDate: matched.date,
    };
  }

  // Automatic mode based on date
  const compareDate = explicitTargetDate || today;

  // Exact date match
  const matchedDate = days.find((d) => d.date === compareDate);
  if (matchedDate) {
    return {
      activeDay: matchedDate.dayNumber,
      isAuto: true,
      days,
      day1Date,
      day2Date,
      effectiveDate: matchedDate.date,
    };
  }

  // If date is >= last day date
  const lastDay = days[days.length - 1];
  if (compareDate >= lastDay.date) {
    return {
      activeDay: lastDay.dayNumber,
      isAuto: true,
      days,
      day1Date,
      day2Date,
      effectiveDate: lastDay.date,
    };
  }

  // Find the closest day
  for (let i = days.length - 1; i >= 0; i--) {
    if (compareDate >= days[i].date) {
      return {
        activeDay: days[i].dayNumber,
        isAuto: true,
        days,
        day1Date,
        day2Date,
        effectiveDate: days[i].date,
      };
    }
  }

  return {
    activeDay: 1,
    isAuto: true,
    days,
    day1Date,
    day2Date,
    effectiveDate: day1Date,
  };
}
