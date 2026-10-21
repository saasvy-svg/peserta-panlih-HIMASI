import { getWIBDate } from '@/lib/utils';
import { ExtraTexts } from '@/types/database';

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

export interface DayResolution {
  activeDay: 1 | 2;
  isAuto: boolean;
  day1Date: string;
  day2Date: string;
  effectiveDate: string;
}

/**
 * Resolves whether the current attendance session is Day 1 or Day 2.
 * Supports automatic date-based switching or manual admin override.
 */
export function resolveActiveDay(
  extraTexts?: ExtraTexts,
  explicitTargetDate?: string
): DayResolution {
  const today = getWIBDate();
  const day1Date = extraTexts?.day1_date || today;
  const day2Date = extraTexts?.day2_date || getNextWIBDate(day1Date);
  const activeSetting = extraTexts?.active_day || 'auto';

  if (activeSetting === 1) {
    return {
      activeDay: 1,
      isAuto: false,
      day1Date,
      day2Date,
      effectiveDate: day1Date,
    };
  }

  if (activeSetting === 2) {
    return {
      activeDay: 2,
      isAuto: false,
      day1Date,
      day2Date,
      effectiveDate: day2Date,
    };
  }

  // Automatic mode (based on date)
  const compareDate = explicitTargetDate || today;
  const isDay2 = compareDate >= day2Date;

  return {
    activeDay: isDay2 ? 2 : 1,
    isAuto: true,
    day1Date,
    day2Date,
    effectiveDate: isDay2 ? day2Date : day1Date,
  };
}
