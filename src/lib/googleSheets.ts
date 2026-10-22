import { google } from 'googleapis';
import { normalizeAngkatan, getTargetTabName } from '@/utils/angkatan';
import { getWIBDate, getWIBTime, getWIBLocaleString } from '@/lib/utils';
import { getNextWIBDate, getDaysList } from '@/lib/dayHelper';
import { DayConfigItem } from '@/types/database';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/**
 * Converts a 0-based column index to an Excel/Google Sheets column letter.
 * 0 -> 'A', 1 -> 'B', 25 -> 'Z', 26 -> 'AA', etc.
 */
export function getColumnLetter(colIndex: number): string {
  let temp = colIndex + 1;
  let letter = '';
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

/**
 * Builds Model B matrix table headers dynamically based on configured days:
 * [No, NIM / NIP, Nama Lengkap, Angkatan, Hari 1 (tgl), Hari 2 (tgl), ..., Total Hadir, Catatan / Alasan, Sinkron Terakhir]
 */
export function buildModelBHeaders(days: DayConfigItem[]): string[] {
  const baseHeaders = ['No', 'NIM / NIP', 'Nama Lengkap', 'Angkatan'];

  const dayHeaders = days.map((d) => {
    const dateParts = (d.date || '').split('-');
    const shortDate =
      dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}` : d.date;
    return `Hari ${d.dayNumber} (${shortDate})`;
  });

  const trailingHeaders = ['Total Hadir', 'Catatan / Alasan', 'Sinkron Terakhir'];
  return [...baseHeaders, ...dayHeaders, ...trailingHeaders];
}

export const DEFAULT_HEADERS = buildModelBHeaders(getDaysList());

/**
 * Extracts pure Sheet ID from a full Google Sheets URL or raw ID
 */
export function extractSheetId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (trimmed.includes('/d/')) {
    const matches = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (matches && matches[1]) {
      return matches[1];
    }
  }
  return trimmed;
}

/**
 * Parses the service account JSON key from the environment variable.
 */
export function getAuthClient() {
  const keyString = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyString) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY environment variable belum dikonfigurasi.');
  }

  try {
    const credentials = JSON.parse(keyString);
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    return new google.auth.GoogleAuth({
      credentials,
      scopes: SCOPES,
    });
  } catch (err: any) {
    throw new Error('Gagal memproses GOOGLE_SERVICE_ACCOUNT_KEY. Pastikan format JSON valid.');
  }
}

/**
 * Test sheet connection
 */
export async function testSheetConnection(sheetId: string) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
  });
  return response.data;
}

// In-memory cache for sheet numeric IDs to make updates fast
const tabNumericIdCache = new Map<string, number>();

/**
 * Ensure sheet tab exists with Model B headers starting at B4 and stylish formatting.
 */
export async function ensureSheetTab(
  sheetId: string,
  tabName: string,
  days: DayConfigItem[] = getDaysList()
): Promise<{ sheetNumericId: number; createdOrRenamed: boolean }> {
  const cacheKey = `${sheetId}:${tabName}`;
  if (tabNumericIdCache.has(cacheKey)) {
    return { sheetNumericId: tabNumericIdCache.get(cacheKey)!, createdOrRenamed: false };
  }

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const allSheets = meta.data.sheets || [];
  let existingSheet = allSheets.find((s) => s.properties?.title === tabName);
  let sheetNumericId = existingSheet?.properties?.sheetId ?? 0;
  let isNew = false;

  if (!existingSheet) {
    const sheet1 = allSheets.find((s) => s.properties?.title === 'Sheet1');
    if (sheet1 && allSheets.length === 1) {
      const checkData = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'Sheet1!A1:Z10',
      });
      const hasValues = checkData.data.values && checkData.data.values.length > 0;

      if (!hasValues) {
        sheetNumericId = sheet1.properties?.sheetId ?? 0;
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId: sheetNumericId,
                    title: tabName,
                  },
                  fields: 'title',
                },
              },
            ],
          },
        });
        isNew = true;
      }
    }

    if (!isNew) {
      const addRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: tabName },
              },
            },
          ],
        },
      });

      sheetNumericId =
        addRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? Date.now();
      isNew = true;
    }
  }

  const headers = buildModelBHeaders(days);
  const endColLetter = getColumnLetter(headers.length); // Col B is index 1

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!B2:${endColLetter}4`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [`REKAP PRESENSI - ${tabName.toUpperCase()} (MULTI-DAY)`],
        [`Diperbarui otomatis oleh Sistem Absensi • Terkoneksi Realtime`],
        headers,
      ],
    },
  });

  await applyModelBHeaderStyles(sheetId, sheetNumericId, days.length, headers.length);

  tabNumericIdCache.set(cacheKey, sheetNumericId);
  return { sheetNumericId, createdOrRenamed: isNew };
}

/**
 * Apply neat styles to headers and title banner for Model B Matrix Table
 */
export async function applyModelBHeaderStyles(
  sheetId: string,
  sheetNumericId: number,
  daysCount: number,
  totalColumns: number
) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const startColIndex = 1; // Column B is index 1
  const endColIndex = startColIndex + totalColumns;

  const dayStartColIndex = 5; // Column F (index 5) is first Day column
  const dayEndColIndex = dayStartColIndex + daysCount;

  const requests: any[] = [
    {
      updateSheetProperties: {
        properties: {
          sheetId: sheetNumericId,
          gridProperties: {
            frozenRowCount: 4,
          },
        },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex: 1,
          endRowIndex: 2,
          startColumnIndex: 1,
          endColumnIndex: endColIndex,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              bold: true,
              fontSize: 13,
              foregroundColor: { red: 0.12, green: 0.23, blue: 0.54 },
            },
          },
        },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex: 2,
          endRowIndex: 3,
          startColumnIndex: 1,
          endColumnIndex: endColIndex,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              italic: true,
              fontSize: 9,
              foregroundColor: { red: 0.39, green: 0.45, blue: 0.55 },
            },
          },
        },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex: 3,
          endRowIndex: 4,
          startColumnIndex: 1,
          endColumnIndex: endColIndex,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.12, green: 0.16, blue: 0.24 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true,
              fontSize: 10,
            },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
          },
        },
        fields:
          'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex: 3,
          endRowIndex: 4,
          startColumnIndex: dayStartColIndex,
          endColumnIndex: dayEndColIndex,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.04, green: 0.38, blue: 0.27 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true,
              fontSize: 10,
            },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      updateBorders: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex: 3,
          endRowIndex: 4,
          startColumnIndex: 1,
          endColumnIndex: endColIndex,
        },
        top: { style: 'SOLID', color: { red: 0.12, green: 0.16, blue: 0.24 } },
        bottom: { style: 'SOLID_MEDIUM', color: { red: 0.12, green: 0.16, blue: 0.24 } },
        left: { style: 'SOLID', color: { red: 0.12, green: 0.16, blue: 0.24 } },
        right: { style: 'SOLID', color: { red: 0.12, green: 0.16, blue: 0.24 } },
        innerVertical: { style: 'SOLID', color: { red: 0.3, green: 0.35, blue: 0.45 } },
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: sheetNumericId,
          dimension: 'ROWS',
          startIndex: 3,
          endIndex: 4,
        },
        properties: {
          pixelSize: 36,
        },
        fields: 'pixelSize',
      },
    },
  ];

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests },
    });
  } catch (err: any) {
    console.error('Failed applying Model B header styles:', err.message);
  }
}

/**
 * Format data rows for Model B matrix table:
 * - Center: No, NIM, Angkatan, Day columns, Total Hadir, Sync
 * - Left: Nama, Catatan
 */
export async function applyModelBDataRowStyles(
  sheetId: string,
  sheetNumericId: number,
  startRow: number,
  totalRows: number,
  totalColumns: number
) {
  if (totalRows <= 0) return;

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const startRowIndex = startRow - 1;
  const endRowIndex = startRowIndex + totalRows;
  const endColIndex = 1 + totalColumns;

  const requests: any[] = [
    {
      updateBorders: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex,
          endRowIndex,
          startColumnIndex: 1,
          endColumnIndex: endColIndex,
        },
        top: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        bottom: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        left: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        right: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        innerHorizontal: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
        innerVertical: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex,
          endRowIndex,
          startColumnIndex: 1,
          endColumnIndex: endColIndex,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: 'MIDDLE',
            textFormat: {
              fontSize: 10,
              foregroundColor: { red: 0.1, green: 0.12, blue: 0.15 },
            },
          },
        },
        fields: 'userEnteredFormat(verticalAlignment,textFormat.fontSize,textFormat.foregroundColor)',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex,
          endRowIndex,
          startColumnIndex: 1,
          endColumnIndex: 3,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex,
          endRowIndex,
          startColumnIndex: 4,
          endColumnIndex: 5,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            textFormat: { bold: true },
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold)',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex,
          endRowIndex,
          startColumnIndex: 5,
          endColumnIndex: endColIndex - 2,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            textFormat: { bold: true },
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold)',
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: sheetNumericId,
          dimension: 'ROWS',
          startIndex: startRowIndex,
          endIndex: endRowIndex,
        },
        properties: {
          pixelSize: 28,
        },
        fields: 'pixelSize',
      },
    },
  ];

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests },
    });
  } catch (err: any) {
    console.error('Failed applying Model B data row styles:', err.message);
  }
}

/**
 * Finds the best matching tab title in the spreadsheet (e.g. "Angkatan 2025" vs "Angkatan 25").
 */
export async function getExistingTabTitle(
  sheetId: string,
  requestedTabName: string,
  days: DayConfigItem[] = getDaysList()
): Promise<{ title: string; numericId: number }> {
  const cacheKey = `${sheetId}:${requestedTabName}`;
  if (tabNumericIdCache.has(cacheKey)) {
    return { title: requestedTabName, numericId: tabNumericIdCache.get(cacheKey)! };
  }

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const allSheets = meta.data.sheets || [];

  // Exact match
  let found = allSheets.find((s) => s.properties?.title === requestedTabName);

  // Case-insensitive match
  if (!found) {
    found = allSheets.find(
      (s) => s.properties?.title?.toLowerCase() === requestedTabName.toLowerCase()
    );
  }

  // Flexible Angkatan match
  if (!found && requestedTabName.toLowerCase().includes('angkatan')) {
    const digits = requestedTabName.match(/\d+/)?.[0];
    if (digits) {
      const shortYear = digits.slice(-2);
      const longYear = `20${shortYear}`;
      found = allSheets.find((s) => {
        const title = s.properties?.title || '';
        return (
          title.toLowerCase().includes('angkatan') &&
          (title.includes(shortYear) || title.includes(longYear))
        );
      });
    }
  }

  // Flexible Dosen match
  if (!found && requestedTabName.toLowerCase().includes('dosen')) {
    found = allSheets.find((s) =>
      s.properties?.title?.toLowerCase().includes('dosen')
    );
  }

  if (found && found.properties?.title) {
    const numericId = found.properties.sheetId ?? 0;
    tabNumericIdCache.set(cacheKey, numericId);
    return { title: found.properties.title, numericId };
  }

  const { sheetNumericId } = await ensureSheetTab(sheetId, requestedTabName, days);
  tabNumericIdCache.set(cacheKey, sheetNumericId);
  return { title: requestedTabName, numericId: sheetNumericId };
}

/**
 * Updates a student's row in-place in Model B Matrix Table:
 * Updates the specific cell for Day X (Column F for Day 1, G for Day 2, etc.),
 * recalculates Total Hadir, and updates Catatan & Sync timestamp.
 * Also marks the student in the Right Zone (Column N / Column M & P).
 */
export async function updateOrAppendAttendanceInSheet(
  sheetId: string,
  record: {
    nim: string;
    name: string;
    class_name: string;
    lecturer_name?: string | null;
    attendance_date?: string;
    check_in_time?: string;
    status?: string;
    notes?: string | null;
  },
  day: number = 1,
  days: DayConfigItem[] = getDaysList()
) {
  const normalizedDays = days && days.length > 0 ? days : getDaysList();
  const requestedTabName = getTargetTabName(record);
  const { title: tabName, numericId: sheetNumericId } = await getExistingTabTitle(
    sheetId,
    requestedTabName,
    normalizedDays
  );

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Fetch column C (NIM) and column D (Nama) for Left Zone
  const colCD = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!C:D`,
  });

  const rowValues = colCD.data.values || [];
  const targetNim = String(record.nim || '').trim().toUpperCase();
  const targetName = String(record.name || '').trim().toUpperCase();

  let foundRowNumber = -1;
  for (let i = 0; i < rowValues.length; i++) {
    const rowNim = String(rowValues[i]?.[0] || '').trim().toUpperCase();
    const rowName = String(rowValues[i]?.[1] || '').trim().toUpperCase();

    if ((targetNim && rowNim === targetNim) || (targetName && rowName === targetName)) {
      foundRowNumber = i + 1; // 1-indexed row number
      break;
    }
  }

  const rawTime = record.check_in_time || getWIBTime();
  const timeFormatted = rawTime.slice(0, 5) + ' WIB';
  const fullTimeFormatted = rawTime.slice(0, 8) + ' WIB';
  const statusFormatted =
    record.status === 'Hadir'
      ? `Hadir (${timeFormatted})`
      : record.status || 'Hadir';

  const dayIndex = day > 0 ? day : 1;
  const dayColIndex = 4 + dayIndex; // Col F is index 5 for Day 1
  const dayColLetter = getColumnLetter(dayColIndex);

  const totalHadirColIndex = 4 + normalizedDays.length + 1;
  const totalHadirColLetter = getColumnLetter(totalHadirColIndex);

  const catatanColLetter = getColumnLetter(totalHadirColIndex + 1);
  const syncColLetter = getColumnLetter(totalHadirColIndex + 2);
  const syncTime = getWIBLocaleString();

  if (foundRowNumber !== -1) {
    // Update Day cell
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tabName}'!${dayColLetter}${foundRowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[statusFormatted]],
      },
    });

    // Recompute Total Hadir
    const firstDayLetter = getColumnLetter(5);
    const lastDayLetter = getColumnLetter(4 + normalizedDays.length);
    const dayCells = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${tabName}'!${firstDayLetter}${foundRowNumber}:${lastDayLetter}${foundRowNumber}`,
    });

    const values = dayCells.data.values?.[0] || [];
    let attendedCount = 0;
    values.forEach((val: string) => {
      const s = String(val || '').trim();
      if (s && s !== '-' && s !== 'Belum Hadir') attendedCount++;
    });

    const totalHadirText = `${attendedCount} / ${normalizedDays.length} Hari`;

    // Update Total Hadir, Catatan, and Sync Timestamp
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tabName}'!${totalHadirColLetter}${foundRowNumber}:${syncColLetter}${foundRowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[totalHadirText, record.notes || '-', syncTime]],
      },
    });

    // Also look for student in Right Zone (Column N: NIM) to update Jam Masuk & Status
    try {
      const colN = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${tabName}'!N:N`,
      });
      const colNValues = colN.data.values || [];
      for (let j = 0; j < colNValues.length; j++) {
        const nVal = String(colNValues[j]?.[0] || '').trim().toUpperCase();
        if (targetNim && nVal === targetNim) {
          const rightRow = j + 1;
          await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `'${tabName}'!M${rightRow}:P${rightRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [[fullTimeFormatted, record.nim, record.name, record.status || 'Hadir']],
            },
          });
          break;
        }
      }
    } catch (e) {
      // Non-blocking for right zone
    }

    return { action: 'updated_matrix', rowNumber: foundRowNumber, tabName };
  } else {
    // Append to bottom of Left Zone matrix
    const colBData = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${tabName}'!B4:B`,
    });
    const existingCount = colBData.data.values?.length || 1;
    const nextRowNum = 4 + existingCount;
    const nextNo = existingCount;

    const dayValues = normalizedDays.map((d) =>
      d.dayNumber === dayIndex ? statusFormatted : '-'
    );

    const fullRow = [
      nextNo,
      record.nim,
      record.name,
      normalizeAngkatan(record.class_name),
      ...dayValues,
      `1 / ${normalizedDays.length} Hari`,
      record.notes || '-',
      syncTime,
    ];

    const endColLetter = getColumnLetter(fullRow.length);

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tabName}'!B${nextRowNum}:${endColLetter}${nextRowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [fullRow],
      },
    });

    await applyModelBDataRowStyles(sheetId, sheetNumericId, nextRowNum, 1, fullRow.length);
    return { action: 'appended_matrix', tabName };
  }
}

/**
 * Resets a student's day cell in Model B Matrix Table back to "-"
 * and decrements their Total Hadir count.
 */
export async function resetAttendanceInSheet(
  sheetId: string,
  record: {
    nim: string;
    name: string;
    class_name: string;
    attendance_date?: string;
  },
  day: number = 1,
  days: DayConfigItem[] = getDaysList()
) {
  const normalizedDays = days && days.length > 0 ? days : getDaysList();
  const requestedTabName = getTargetTabName(record);
  const { title: tabName, numericId: sheetNumericId } = await getExistingTabTitle(
    sheetId,
    requestedTabName,
    normalizedDays
  );

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const colCD = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!C:D`,
  });

  const rowValues = colCD.data.values || [];
  const targetNim = String(record.nim || '').trim().toUpperCase();
  const targetName = String(record.name || '').trim().toUpperCase();

  let foundRowNumber = -1;
  for (let i = 0; i < rowValues.length; i++) {
    const rowNim = String(rowValues[i]?.[0] || '').trim().toUpperCase();
    const rowName = String(rowValues[i]?.[1] || '').trim().toUpperCase();

    if ((targetNim && rowNim === targetNim) || (targetName && rowName === targetName)) {
      foundRowNumber = i + 1;
      break;
    }
  }

  if (foundRowNumber !== -1) {
    const dayIndex = day > 0 ? day : 1;
    const dayColLetter = getColumnLetter(4 + dayIndex);

    // Reset this day's cell to "-"
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tabName}'!${dayColLetter}${foundRowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['-']],
      },
    });

    // Recompute Total Hadir
    const firstDayLetter = getColumnLetter(5);
    const lastDayLetter = getColumnLetter(4 + normalizedDays.length);
    const dayCells = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${tabName}'!${firstDayLetter}${foundRowNumber}:${lastDayLetter}${foundRowNumber}`,
    });

    const values = dayCells.data.values?.[0] || [];
    let attendedCount = 0;
    values.forEach((val: string) => {
      const s = String(val || '').trim();
      if (s && s !== '-' && s !== 'Belum Hadir') attendedCount++;
    });

    const totalHadirColLetter = getColumnLetter(4 + normalizedDays.length + 1);
    const totalHadirText = `${attendedCount} / ${normalizedDays.length} Hari`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tabName}'!${totalHadirColLetter}${foundRowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[totalHadirText]],
      },
    });

    // In Right Zone, if found, set back to Belum Hadir
    try {
      const colN = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${tabName}'!N:N`,
      });
      const colNValues = colN.data.values || [];
      for (let j = 0; j < colNValues.length; j++) {
        const nVal = String(colNValues[j]?.[0] || '').trim().toUpperCase();
        if (targetNim && nVal === targetNim) {
          const rightRow = j + 1;
          await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `'${tabName}'!M${rightRow}:P${rightRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [['-', record.nim, record.name, 'Belum Hadir']],
            },
          });
          break;
        }
      }
    } catch (e) {}

    return { success: true, rowNumber: foundRowNumber };
  }

  return { success: false, notFound: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL SYNC: Left Zone (Model B Matrix B-K) + Right Zone (Attendance Tables L-P)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full sync for a single angkatan/dosen tab:
 * LEFT ZONE (B-J/K):  Model B Matrix — all roster with multi-day attendance
 * RIGHT ZONE (L-P):   DAFTAR SUDAH PRESENSI (sorted by check_in_time ASC) + DAFTAR BELUM PRESENSI
 */
async function syncSingleTab(
  sheets: any,
  sheetId: string,
  sheetNumericId: number,
  tabName: string,
  roster: { nim: string; name: string; class_name: string }[],
  attendances: any[],
  targetDate: string,
  isDosenTab: boolean,
  days: DayConfigItem[]
) {
  const roleLabel = isDosenTab ? 'Dosen' : 'Mahasiswa';

  // ── 1. Clear content + formatting cleanly ────────────────────────────────
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `'${tabName}'!A1:AZ1000`,
    });
  } catch (e) {}

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          {
            unmergeCells: {
              range: {
                sheetId: sheetNumericId,
                startRowIndex: 0,
                endRowIndex: 500,
                startColumnIndex: 0,
                endColumnIndex: 35,
              },
            },
          },
          {
            repeatCell: {
              range: {
                sheetId: sheetNumericId,
                startRowIndex: 0,
                endRowIndex: 500,
                startColumnIndex: 0,
                endColumnIndex: 35,
              },
              cell: { userEnteredFormat: {} },
              fields: 'userEnteredFormat',
            },
          },
        ],
      },
    });
  } catch (e) {}

  // ── 2. Build attendance lookup across all configured dates ───────────────
  const attByNimByDate = new Map<string, Map<string, any>>();
  for (const att of attendances) {
    const aDate = att.attendance_date;
    if (!aDate) continue;
    if (!attByNimByDate.has(aDate)) attByNimByDate.set(aDate, new Map());
    const dateMap = attByNimByDate.get(aDate)!;
    if (att.nim) dateMap.set(String(att.nim).trim().toUpperCase(), att);
    if (att.name) dateMap.set(String(att.name).trim().toUpperCase(), att);
  }

  // ── 3. LEFT ZONE: Model B Matrix (B → J/K) ───────────────────────────────
  const headers = buildModelBHeaders(days);
  const totalCols = headers.length; // 9 for 2 days
  const matrixEndColLetter = getColumnLetter(totalCols); // Col J for 9 cols
  const matrixEndColIdx = totalCols + 1; // 10 (exclusive)

  // Title (B2) + Subtitle (B3) + Column Headers (B4)
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!B2:${matrixEndColLetter}4`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [`REKAP PRESENSI - ${tabName.toUpperCase()} (MULTI-DAY)`, ...Array(totalCols - 1).fill('')],
        [`Diperbarui otomatis oleh Sistem Absensi • Terkoneksi Realtime`, ...Array(totalCols - 1).fill('')],
        headers,
      ],
    },
  });

  // Build matrix data rows
  const syncTime = getWIBLocaleString();
  const matrixRows: any[][] = [];

  for (let i = 0; i < roster.length; i++) {
    const s = roster[i];
    const nimKey = String(s.nim || '').trim().toUpperCase();
    const nameKey = String(s.name || '').trim().toUpperCase();

    const dayValues = days.map((d) => {
      const dateMap = attByNimByDate.get(d.date);
      if (!dateMap) return '-';
      const att = dateMap.get(nimKey) || dateMap.get(nameKey);
      if (!att) return '-';
      const rawTime = att.check_in_time || '00:00:00';
      const timeStr = rawTime.slice(0, 5) + ' WIB';
      return att.status === 'Hadir' ? `Hadir (${timeStr})` : (att.status || 'Hadir');
    });

    let attendedCount = 0;
    for (const v of dayValues) {
      const sv = String(v || '').trim();
      if (sv && sv !== '-' && sv !== 'Belum Hadir') attendedCount++;
    }

    let notes = '-';
    for (const d of days) {
      const dateMap = attByNimByDate.get(d.date);
      if (dateMap) {
        const att = dateMap.get(nimKey) || dateMap.get(nameKey);
        if (att?.notes) {
          notes = att.notes;
          break;
        }
      }
    }

    matrixRows.push([
      i + 1,
      s.nim,
      s.name,
      normalizeAngkatan(s.class_name),
      ...dayValues,
      `${attendedCount} / ${days.length} Hari`,
      notes,
      syncTime,
    ]);
  }

  // Write matrix data at B5 onwards
  const matrixDataCount = matrixRows.length;
  if (matrixDataCount > 0) {
    const endRow = 4 + matrixDataCount;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tabName}'!B5:${matrixEndColLetter}${endRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: matrixRows },
    });
  }

  // ── 4. RIGHT ZONE: Attendance Tables (L → P) ─────────────────────────────
  const rightStartIdx = 11; // Column L is index 11 (0-indexed: A=0, B=1 ... K=10, L=11)
  const rightCols = 5;      // L=No, M=Jam, N=NIM, O=Nama, P=Status
  const rightEndIdx = rightStartIdx + rightCols; // 16 (exclusive)
  const rightStartLetter = getColumnLetter(rightStartIdx);     // 'L'
  const rightEndLetter = getColumnLetter(rightStartIdx + rightCols - 1); // 'P'
  const gapColIdx = 10; // Column K is index 10 (Gap column)

  // Split roster into present / absent for target date
  const presentList: any[] = [];
  const absentList: any[] = [];
  const targetMap = attByNimByDate.get(targetDate) || new Map();

  for (const item of roster) {
    const nimKey = String(item.nim || '').trim().toUpperCase();
    const nameKey = String(item.name || '').trim().toUpperCase();
    const att = targetMap.get(nimKey) || targetMap.get(nameKey);

    if (att) {
      presentList.push({
        ...item,
        time: (att.check_in_time || '00:00:00').slice(0, 8),
        rawTime: att.check_in_time || '00:00:00',
        status: att.status || 'Hadir',
      });
    } else {
      absentList.push(item);
    }
  }

  // Sort Table 1 by check_in_time ASC (yang paling awal absen di atas)
  presentList.sort((a, b) => a.rawTime.localeCompare(b.rawTime));
  // Sort Table 2 by NIM ASC
  absentList.sort((a, b) => String(a.nim || a.name).localeCompare(String(b.nim || b.name)));

  const nimLabel = isDosenTab ? 'NIDN / NIP' : 'NIM';

  // Table 1: SUDAH PRESENSI — rows 2..R_T1_END
  const R_T1_TITLE = 2;
  const R_T1_SUBTITLE = 3;
  const R_T1_HEADER = 4;
  const R_T1_DATA = 5;
  const t1Headers = ['No', 'Jam Masuk', nimLabel, 'Nama Lengkap', 'Status'];
  const t1Rows =
    presentList.length > 0
      ? presentList.map((p, i) => [i + 1, `${p.time} WIB`, p.nim, p.name, p.status])
      : [['-', '-', '-', `Belum ada ${roleLabel.toLowerCase()} yang presensi hari ini`, '-']];
  const R_T1_END = R_T1_DATA + t1Rows.length - 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!${rightStartLetter}${R_T1_TITLE}:${rightEndLetter}${R_T1_END}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [`DAFTAR SUDAH PRESENSI (${presentList.length} ${roleLabel.toUpperCase()})`, ...Array(rightCols - 1).fill('')],
        [`Urut berdasarkan waktu kehadiran tercepat • Sesi ${targetDate}`, ...Array(rightCols - 1).fill('')],
        t1Headers,
        ...t1Rows,
      ],
    },
  });

  // Table 2: BELUM PRESENSI — rows R_T2_TITLE..R_T2_END (2 empty rows gap)
  const R_T2_TITLE = R_T1_END + 3;
  const R_T2_SUBTITLE = R_T2_TITLE + 1;
  const R_T2_HEADER = R_T2_SUBTITLE + 1;
  const R_T2_DATA = R_T2_HEADER + 1;
  const t2Headers = ['No', 'Jam Masuk', nimLabel, 'Nama Lengkap', 'Status'];
  const t2Rows =
    absentList.length > 0
      ? absentList.map((a, i) => [i + 1, '-', a.nim, a.name, 'Belum Hadir'])
      : [['-', '-', '-', `Semua ${roleLabel.toLowerCase()} sudah hadir! 🎉`, 'Lengkap']];
  const R_T2_END = R_T2_DATA + t2Rows.length - 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!${rightStartLetter}${R_T2_TITLE}:${rightEndLetter}${R_T2_END}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [`DAFTAR BELUM PRESENSI (${absentList.length} ${roleLabel.toUpperCase()})`, ...Array(rightCols - 1).fill('')],
        [`Mahasiswa yang belum melakukan presensi pada hari ini`, ...Array(rightCols - 1).fill('')],
        t2Headers,
        ...t2Rows,
      ],
    },
  });

  // ── 5. FORMATTING (Explicit Column Widths, Clean Heights, Crisp Colors) ──
  const daysCount = days.length;
  const dayStartIdx = 5; // Column F (first day)
  const dayEndIdx = dayStartIdx + daysCount;
  const dataStart0 = 4; // row 5 -> 0-indexed = 4
  const dataEnd0 = dataStart0 + matrixDataCount;

  const requests: any[] = [
    // Freeze top 4 rows
    {
      updateSheetProperties: {
        properties: { sheetId: sheetNumericId, gridProperties: { frozenRowCount: 4 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },

    // ── Explicit Column Widths (Prevents any columns from being squished!) ──
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 25 }, fields: 'pixelSize' } },   // A: Margin
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 45 }, fields: 'pixelSize' } },   // B: No
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } },  // C: NIM
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 240 }, fields: 'pixelSize' } },  // D: Nama Lengkap
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } },  // E: Angkatan
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 125 }, fields: 'pixelSize' } },  // F: Hari 1
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 125 }, fields: 'pixelSize' } },  // G: Hari 2
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 95 }, fields: 'pixelSize' } },   // H: Total Hadir
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } },  // I: Catatan / Alasan
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } }, // J: Rekam Terakhir
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: gapColIdx, endIndex: gapColIdx + 1 }, properties: { pixelSize: 30 }, fields: 'pixelSize' } }, // K: Gap
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: rightStartIdx, endIndex: rightStartIdx + 1 }, properties: { pixelSize: 45 }, fields: 'pixelSize' } },      // L: No
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: rightStartIdx + 1, endIndex: rightStartIdx + 2 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } },  // M: Jam Masuk
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: rightStartIdx + 2, endIndex: rightStartIdx + 3 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } },  // N: NIM
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: rightStartIdx + 3, endIndex: rightStartIdx + 4 }, properties: { pixelSize: 240 }, fields: 'pixelSize' } },  // O: Nama Lengkap
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: rightStartIdx + 4, endIndex: rightStartIdx + 5 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },  // P: Status

    // ── LEFT ZONE FORMATTING ──

    // Left Title Banner B2 (Navy text)
    { mergeCells: { range: { sheetId: sheetNumericId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: matrixEndColIdx }, mergeType: 'MERGE_ALL' } },
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: matrixEndColIdx },
        cell: { userEnteredFormat: {
          textFormat: { bold: true, fontSize: 13, foregroundColor: { red: 0.12, green: 0.23, blue: 0.54 } },
        }},
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // Left Subtitle B3 (Italic gray)
    { mergeCells: { range: { sheetId: sheetNumericId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: matrixEndColIdx }, mergeType: 'MERGE_ALL' } },
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: matrixEndColIdx },
        cell: { userEnteredFormat: {
          textFormat: { italic: true, fontSize: 9, foregroundColor: { red: 0.39, green: 0.45, blue: 0.55 } },
        }},
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // Left Table Headers B4 (Dark Slate #1E293B)
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: matrixEndColIdx },
        cell: { userEnteredFormat: {
          backgroundColor: { red: 0.12, green: 0.16, blue: 0.24 },
          textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 10 },
          horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP',
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },

    // Highlight Day Columns in Left Header (Deep Emerald #065F46)
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: dayStartIdx, endColumnIndex: dayEndIdx },
        cell: { userEnteredFormat: {
          backgroundColor: { red: 0.04, green: 0.38, blue: 0.27 },
        }},
        fields: 'userEnteredFormat.backgroundColor',
      },
    },

    // Left Header Borders
    {
      updateBorders: {
        range: { sheetId: sheetNumericId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: matrixEndColIdx },
        top: { style: 'SOLID', color: { red: 0.12, green: 0.16, blue: 0.24 } },
        bottom: { style: 'SOLID_MEDIUM', color: { red: 0.12, green: 0.16, blue: 0.24 } },
        left: { style: 'SOLID', color: { red: 0.12, green: 0.16, blue: 0.24 } },
        right: { style: 'SOLID', color: { red: 0.12, green: 0.16, blue: 0.24 } },
        innerVertical: { style: 'SOLID', color: { red: 0.3, green: 0.35, blue: 0.45 } },
      },
    },

    // Left Header row height (36px)
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'ROWS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } },
  ];

  // Left Matrix data rows formatting
  if (matrixDataCount > 0) {
    requests.push(
      {
        updateBorders: {
          range: { sheetId: sheetNumericId, startRowIndex: dataStart0, endRowIndex: dataEnd0, startColumnIndex: 1, endColumnIndex: matrixEndColIdx },
          top: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
          bottom: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
          left: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
          right: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
          innerHorizontal: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
          innerVertical: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
        },
      },
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: dataStart0, endRowIndex: dataEnd0, startColumnIndex: 1, endColumnIndex: matrixEndColIdx },
          cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', textFormat: { fontSize: 10 } } },
          fields: 'userEnteredFormat(verticalAlignment,textFormat.fontSize)',
        },
      },
      // Center: No (B=1), NIM (C=2)
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: dataStart0, endRowIndex: dataEnd0, startColumnIndex: 1, endColumnIndex: 3 },
          cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
          fields: 'userEnteredFormat.horizontalAlignment',
        },
      },
      // Center+bold: Angkatan (E=4)
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: dataStart0, endRowIndex: dataEnd0, startColumnIndex: 4, endColumnIndex: 5 },
          cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { bold: true } } },
          fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold)',
        },
      },
      // Center+bold: Day columns (Col F onwards)
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: dataStart0, endRowIndex: dataEnd0, startColumnIndex: dayStartIdx, endColumnIndex: dayEndIdx },
          cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { bold: true } } },
          fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold)',
        },
      },
      // Center: Total Hadir
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: dataStart0, endRowIndex: dataEnd0, startColumnIndex: 7, endColumnIndex: 8 },
          cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { bold: true } } },
          fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold)',
        },
      },
      // Row height (26px)
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'ROWS', startIndex: dataStart0, endIndex: dataEnd0 }, properties: { pixelSize: 26 }, fields: 'pixelSize' } },
    );
  }

  // ── RIGHT ZONE FORMATTING: TABLE 1 (SUDAH PRESENSI) ──

  // Table 1 Title Banner (Emerald #065F46)
  requests.push(
    { mergeCells: { range: { sheetId: sheetNumericId, startRowIndex: R_T1_TITLE - 1, endRowIndex: R_T1_TITLE, startColumnIndex: rightStartIdx, endColumnIndex: rightEndIdx }, mergeType: 'MERGE_ALL' } },
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: R_T1_TITLE - 1, endRowIndex: R_T1_TITLE, startColumnIndex: rightStartIdx, endColumnIndex: rightEndIdx },
        cell: { userEnteredFormat: {
          backgroundColor: { red: 0.04, green: 0.38, blue: 0.27 },
          textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } },
          horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
  );

  // Table 1 Subtitle
  requests.push(
    { mergeCells: { range: { sheetId: sheetNumericId, startRowIndex: R_T1_SUBTITLE - 1, endRowIndex: R_T1_SUBTITLE, startColumnIndex: rightStartIdx, endColumnIndex: rightEndIdx }, mergeType: 'MERGE_ALL' } },
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: R_T1_SUBTITLE - 1, endRowIndex: R_T1_SUBTITLE, startColumnIndex: rightStartIdx, endColumnIndex: rightEndIdx },
        cell: { userEnteredFormat: {
          backgroundColor: { red: 0.93, green: 0.98, blue: 0.95 },
          textFormat: { italic: true, fontSize: 9, foregroundColor: { red: 0.1, green: 0.4, blue: 0.25 } },
          horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
  );

  // Table 1 Column Headers (Bright Emerald #059669)
  requests.push({
    repeatCell: {
      range: { sheetId: sheetNumericId, startRowIndex: R_T1_HEADER - 1, endRowIndex: R_T1_HEADER, startColumnIndex: rightStartIdx, endColumnIndex: rightEndIdx },
      cell: { userEnteredFormat: {
        backgroundColor: { red: 0.06, green: 0.62, blue: 0.45 },
        textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } },
        horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    },
  });

  // Table 1 Data formatting
  const t1DataStart0 = R_T1_DATA - 1;
  const t1DataEnd0 = t1DataStart0 + t1Rows.length;
  requests.push(
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: t1DataStart0, endRowIndex: t1DataEnd0, startColumnIndex: rightStartIdx, endColumnIndex: rightEndIdx },
        cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', textFormat: { fontSize: 10 } } },
        fields: 'userEnteredFormat(verticalAlignment,textFormat.fontSize)',
      },
    },
    // Center: No (L), Jam Masuk (M), NIM (N)
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: t1DataStart0, endRowIndex: t1DataEnd0, startColumnIndex: rightStartIdx, endColumnIndex: rightStartIdx + 3 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    // Left: Nama Lengkap (O)
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: t1DataStart0, endRowIndex: t1DataEnd0, startColumnIndex: rightStartIdx + 3, endColumnIndex: rightStartIdx + 4 },
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', textFormat: { bold: true } } },
        fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold)',
      },
    },
    // Status Badge Green (P)
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: t1DataStart0, endRowIndex: t1DataEnd0, startColumnIndex: rightStartIdx + 4, endColumnIndex: rightStartIdx + 5 },
        cell: { userEnteredFormat: {
          backgroundColor: { red: 0.86, green: 0.98, blue: 0.9 },
          textFormat: { bold: true, foregroundColor: { red: 0.08, green: 0.5, blue: 0.24 } },
          horizontalAlignment: 'CENTER',
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    },
    // Borders
    {
      updateBorders: {
        range: { sheetId: sheetNumericId, startRowIndex: t1DataStart0, endRowIndex: t1DataEnd0, startColumnIndex: rightStartIdx, endColumnIndex: rightEndIdx },
        top: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        bottom: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        left: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        right: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        innerHorizontal: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
        innerVertical: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
      },
    },
    // Row height
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'ROWS', startIndex: t1DataStart0, endIndex: t1DataEnd0 }, properties: { pixelSize: 26 }, fields: 'pixelSize' } },
  );

  // ── RIGHT ZONE FORMATTING: TABLE 2 (BELUM PRESENSI) ──

  // Table 2 Title Banner (Dark Slate #1E293B)
  requests.push(
    { mergeCells: { range: { sheetId: sheetNumericId, startRowIndex: R_T2_TITLE - 1, endRowIndex: R_T2_TITLE, startColumnIndex: rightStartIdx, endColumnIndex: rightEndIdx }, mergeType: 'MERGE_ALL' } },
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: R_T2_TITLE - 1, endRowIndex: R_T2_TITLE, startColumnIndex: rightStartIdx, endColumnIndex: rightEndIdx },
        cell: { userEnteredFormat: {
          backgroundColor: { red: 0.15, green: 0.2, blue: 0.28 },
          textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } },
          horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
  );

  // Table 2 Subtitle
  requests.push(
    { mergeCells: { range: { sheetId: sheetNumericId, startRowIndex: R_T2_SUBTITLE - 1, endRowIndex: R_T2_SUBTITLE, startColumnIndex: rightStartIdx, endColumnIndex: rightEndIdx }, mergeType: 'MERGE_ALL' } },
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: R_T2_SUBTITLE - 1, endRowIndex: R_T2_SUBTITLE, startColumnIndex: rightStartIdx, endColumnIndex: rightEndIdx },
        cell: { userEnteredFormat: {
          backgroundColor: { red: 0.96, green: 0.97, blue: 0.99 },
          textFormat: { italic: true, fontSize: 9, foregroundColor: { red: 0.35, green: 0.4, blue: 0.5 } },
          horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
  );

  // Table 2 Column Headers (Slate #334155)
  requests.push({
    repeatCell: {
      range: { sheetId: sheetNumericId, startRowIndex: R_T2_HEADER - 1, endRowIndex: R_T2_HEADER, startColumnIndex: rightStartIdx, endColumnIndex: rightEndIdx },
      cell: { userEnteredFormat: {
        backgroundColor: { red: 0.25, green: 0.3, blue: 0.4 },
        textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } },
        horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    },
  });

  // Table 2 Data formatting
  const t2DataStart0 = R_T2_DATA - 1;
  const t2DataEnd0 = t2DataStart0 + t2Rows.length;
  requests.push(
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: t2DataStart0, endRowIndex: t2DataEnd0, startColumnIndex: rightStartIdx, endColumnIndex: rightEndIdx },
        cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', textFormat: { fontSize: 10 } } },
        fields: 'userEnteredFormat(verticalAlignment,textFormat.fontSize)',
      },
    },
    // Center: No (L), Jam Masuk (M), NIM (N)
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: t2DataStart0, endRowIndex: t2DataEnd0, startColumnIndex: rightStartIdx, endColumnIndex: rightStartIdx + 3 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    // Left: Nama Lengkap (O)
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: t2DataStart0, endRowIndex: t2DataEnd0, startColumnIndex: rightStartIdx + 3, endColumnIndex: rightStartIdx + 4 },
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', textFormat: { bold: true } } },
        fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold)',
      },
    },
    // Status Badge Soft Red (P)
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: t2DataStart0, endRowIndex: t2DataEnd0, startColumnIndex: rightStartIdx + 4, endColumnIndex: rightStartIdx + 5 },
        cell: { userEnteredFormat: {
          backgroundColor: { red: 0.99, green: 0.9, blue: 0.9 },
          textFormat: { bold: true, foregroundColor: { red: 0.72, green: 0.15, blue: 0.15 } },
          horizontalAlignment: 'CENTER',
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    },
    // Borders
    {
      updateBorders: {
        range: { sheetId: sheetNumericId, startRowIndex: t2DataStart0, endRowIndex: t2DataEnd0, startColumnIndex: rightStartIdx, endColumnIndex: rightEndIdx },
        top: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        bottom: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        left: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        right: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        innerHorizontal: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
        innerVertical: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
      },
    },
    // Row height
    { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'ROWS', startIndex: t2DataStart0, endIndex: t2DataEnd0 }, properties: { pixelSize: 26 }, fields: 'pixelSize' } },
  );

  // Apply all formatting
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests },
    });
  } catch (err: any) {
    console.error(`Failed applying formatting for tab '${tabName}':`, err.message);
  }

  return { presentCount: presentList.length, absentCount: absentList.length };
}

/**
 * Main sync: writes complete dual-zone data for each angkatan + dosen,
 * and clean 2-table view for Rekap Gabungan.
 * Protects 'Quick Count Pemira' or any tab with 'Pemira' in the title.
 */
export async function syncCategorizedWithMasterRoster(
  sheetId: string,
  allStudents: any[],
  attendances: any[],
  date: string,
  lecturers: string[] = [],
  dayOptions?: {
    days?: DayConfigItem[];
    activeDay?: number | 'auto';
  }
) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const days = dayOptions?.days && dayOptions.days.length > 0 ? dayOptions.days : getDaysList();

  tabNumericIdCache.clear();

  // Get metadata of existing sheets
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const allSheetsMeta = meta.data.sheets || [];

  const getOrCreateTab = async (tabName: string, color?: { red: number; green: number; blue: number }) => {
    // 1. Exact match
    let found = allSheetsMeta.find((s) => s.properties?.title === tabName);

    // 2. Case-insensitive match
    if (!found) {
      found = allSheetsMeta.find(
        (s) => s.properties?.title?.toLowerCase() === tabName.toLowerCase()
      );
    }

    // 3. Flexible Angkatan match
    if (!found && tabName.toLowerCase().includes('angkatan')) {
      const digits = tabName.match(/\d+/)?.[0];
      if (digits) {
        const shortYear = digits.slice(-2);
        const longYear = `20${shortYear}`;
        found = allSheetsMeta.find((s) => {
          const t = s.properties?.title || '';
          return t.toLowerCase().includes('angkatan') && (t.includes(shortYear) || t.includes(longYear));
        });
      }
    }

    // 4. Flexible Dosen match
    if (!found && tabName.toLowerCase().includes('dosen')) {
      found = allSheetsMeta.find((s) =>
        s.properties?.title?.toLowerCase().includes('dosen')
      );
    }

    if (found) {
      const numericId = found.properties?.sheetId ?? 0;
      const actualTitle = found.properties?.title ?? tabName;
      tabNumericIdCache.set(`${sheetId}:${actualTitle}`, numericId);
      return { numericId, title: actualTitle };
    }

    // If only 'Sheet1' exists and is blank, rename Sheet1
    const sheet1 = allSheetsMeta.find((s) => s.properties?.title === 'Sheet1');
    if (sheet1 && allSheetsMeta.length === 1) {
      const numericId = sheet1.properties?.sheetId ?? 0;
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId: numericId, title: tabName },
                fields: 'title',
              },
            },
          ],
        },
      });
      tabNumericIdCache.set(`${sheetId}:${tabName}`, numericId);
      return { numericId, title: tabName };
    }

    // Create new tab
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: tabName,
              ...(color ? { tabColor: color } : {}),
            },
          },
        }],
      },
    });
    const numericId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? Date.now();
    tabNumericIdCache.set(`${sheetId}:${tabName}`, numericId);
    return { numericId, title: tabName };
  };

  // ── Group students by Angkatan ──────────────────────────────────────────
  const groups: Record<string, { nim: string; name: string; class_name: string }[]> = {};
  for (const s of allStudents) {
    const tabName = normalizeAngkatan(s.class_name);
    if (!groups[tabName]) groups[tabName] = [];
    groups[tabName].push({ nim: s.nim, name: s.name, class_name: tabName });
  }

  const results: { tabName: string; count: number }[] = [];

  // ── Sync each Angkatan tab ──────────────────────────────────────────────
  for (const [groupName, roster] of Object.entries(groups)) {
    const { numericId, title } = await getOrCreateTab(groupName);
    const res = await syncSingleTab(
      sheets, sheetId, numericId, title, roster, attendances, date, false, days
    );
    results.push({ tabName: title, count: res.presentCount + res.absentCount });
  }

  // ── Sync Dosen tab ──────────────────────────────────────────────────────
  if (lecturers.length > 0) {
    const dosenRoster = lecturers
      .map((n) => n?.trim())
      .filter(Boolean)
      .map((n, i) => ({
        nim: `DOSEN 0${i + 1}`.slice(-8),
        name: n as string,
        class_name: 'Dosen',
      }));

    const { numericId, title } = await getOrCreateTab('Dosen', { red: 0.15, green: 0.35, blue: 0.65 });
    const res = await syncSingleTab(
      sheets, sheetId, numericId, title, dosenRoster, attendances, date, true, days
    );
    results.push({ tabName: title, count: res.presentCount + res.absentCount });
  }

  // ── Sync Rekap Gabungan tab (Angkatan 2025 + 2026 only, no Dosen) ─────────
  const gabunganRes = await syncRekapGabunganTab(sheetId, allStudents, attendances, date);
  results.push({ tabName: gabunganRes.tabName, count: gabunganRes.presentCount + gabunganRes.absentCount });

  return results;
}

/**
 * Rekap Gabungan: Combined Angkatan 2025 + 2026 ONLY (NO DOSEN).
 * Two clean tables placed SIDE-BY-SIDE:
 * - Left Table (Kolom B s/d G): DAFTAR SUDAH PRESENSI (sorted by check_in_time ASC)
 * - Kolom H: Kolom jeda/spasi (30px)
 * - Right Table (Kolom I s/d N): DAFTAR BELUM PRESENSI (sorted by Angkatan, then NIM)
 */
export async function syncRekapGabunganTab(
  sheetId: string,
  allStudents: any[],
  attendances: any[],
  targetDate: string
) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const tabName = 'Rekap Gabungan';

  // 1. Ensure tab exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const allSheets = meta.data.sheets || [];
  let found = allSheets.find((s) => s.properties?.title === tabName);
  let sheetNumericId = found?.properties?.sheetId;

  if (!found) {
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: tabName, tabColor: { red: 0.05, green: 0.6, blue: 0.4 } },
          },
        }],
      },
    });
    sheetNumericId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? Date.now();
  }

  // 2. Clear content + formatting across A1:AZ1000
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `'${tabName}'!A1:AZ1000`,
    });
  } catch (e) {}

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          {
            unmergeCells: {
              range: { sheetId: sheetNumericId!, startRowIndex: 0, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 35 },
            },
          },
          {
            repeatCell: {
              range: { sheetId: sheetNumericId!, startRowIndex: 0, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 35 },
              cell: { userEnteredFormat: {} },
              fields: 'userEnteredFormat',
            },
          },
        ],
      },
    });
  } catch (e) {}

  // 3. Build roster: ONLY Angkatan 2025 and Angkatan 2026 (NO DOSEN)
  const roster: { nim: string; name: string; class_name: string }[] = [];
  for (const s of allStudents) {
    const angkatan = normalizeAngkatan(s.class_name);
    if (angkatan.includes('2025') || angkatan.includes('2026') || angkatan.includes('25') || angkatan.includes('26')) {
      roster.push({ nim: s.nim, name: s.name, class_name: angkatan });
    }
  }

  // 4. Map attendances for target date
  const attByKey = new Map<string, any>();
  for (const att of attendances) {
    if (att.attendance_date !== targetDate) continue;
    if (att.nim) attByKey.set(String(att.nim).trim().toUpperCase(), att);
    if (att.name) attByKey.set(String(att.name).trim().toUpperCase(), att);
  }

  const presentList: any[] = [];
  const absentList: any[] = [];

  for (const item of roster) {
    const nimKey = String(item.nim || '').trim().toUpperCase();
    const nameKey = String(item.name || '').trim().toUpperCase();
    const att = attByKey.get(nimKey) || attByKey.get(nameKey);

    if (att) {
      presentList.push({
        ...item,
        time: (att.check_in_time || '00:00:00').slice(0, 8),
        rawTime: att.check_in_time || '00:00:00',
        status: att.status || 'Hadir',
        notes: att.notes || '-',
      });
    } else {
      absentList.push(item);
    }
  }

  // Sort Left Table by check_in_time ASC
  presentList.sort((a, b) => a.rawTime.localeCompare(b.rawTime));
  // Sort Right Table by class_name then nim
  absentList.sort((a, b) =>
    String(a.class_name).localeCompare(String(b.class_name)) ||
    String(a.nim).localeCompare(String(b.nim))
  );

  // 5. Left Table: DAFTAR SUDAH PRESENSI (Kolom B s/d G)
  const t1ColHeader = ['No', 'Jam Masuk', 'NIM', 'Nama Lengkap', 'Angkatan', 'Status'];
  const t1Rows =
    presentList.length > 0
      ? presentList.map((p, idx) => [idx + 1, `${p.time} WIB`, p.nim, p.name, p.class_name, p.status])
      : [['-', '-', '-', 'Belum ada mahasiswa yang presensi hari ini', '-', '-']];

  const T1_DATA_START = 5;
  const T1_END = T1_DATA_START + t1Rows.length - 1;

  // 6. Right Table: DAFTAR BELUM PRESENSI (Kolom I s/d N)
  const t2ColHeader = ['No', 'Jam Masuk', 'NIM', 'Nama Lengkap', 'Angkatan', 'Status'];
  const t2Rows =
    absentList.length > 0
      ? absentList.map((a, idx) => [idx + 1, '-', a.nim, a.name, a.class_name, 'Belum Hadir'])
      : [['-', '-', '-', 'Seluruh mahasiswa Angkatan 2025 & 2026 sudah hadir! 🎉', '-', 'Lengkap']];

  const T2_DATA_START = 5;
  const T2_END = T2_DATA_START + t2Rows.length - 1;

  // Write Left Table (B2:G...)
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!B2:G${T1_END}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [`DAFTAR SUDAH PRESENSI (${presentList.length} MAHASISWA)`, '', '', '', '', ''],
        [`Urut berdasarkan waktu kehadiran tercepat • Sesi ${targetDate}`, '', '', '', '', ''],
        t1ColHeader,
        ...t1Rows,
      ],
    },
  });

  // Write Right Table (I2:N...)
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!I2:N${T2_END}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [`DAFTAR BELUM PRESENSI (${absentList.length} MAHASISWA)`, '', '', '', '', ''],
        [`Mahasiswa Angkatan 2025 & 2026 yang belum presensi hari ini`, '', '', '', '', ''],
        t2ColHeader,
        ...t2Rows,
      ],
    },
  });

  // 7. Formatting styling
  if (sheetNumericId !== undefined) {
    const leftStartCol = 1; // Col B (index 1)
    const leftEndCol = 7;   // Col G (index 6, exclusive 7)
    const gapCol = 7;       // Col H (index 7, exclusive 8)
    const rightStartCol = 8; // Col I (index 8)
    const rightEndCol = 14;  // Col N (index 13, exclusive 14)

    const requests: any[] = [
      { updateSheetProperties: { properties: { sheetId: sheetNumericId, gridProperties: { frozenRowCount: 4 } }, fields: 'gridProperties.frozenRowCount' } },

      // Column widths
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 25 }, fields: 'pixelSize' } },  // A
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 45 }, fields: 'pixelSize' } },  // B: No
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } }, // C: Jam Masuk
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // D: NIM
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 240 }, fields: 'pixelSize' } }, // E: Nama Lengkap
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 120 }, fields: 'pixelSize' } }, // F: Angkatan
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } }, // G: Status
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: gapCol, endIndex: gapCol + 1 }, properties: { pixelSize: 30 }, fields: 'pixelSize' } }, // H: Gap
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 45 }, fields: 'pixelSize' } },  // I: No
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } }, // J: Jam Masuk
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // K: NIM
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 11, endIndex: 12 }, properties: { pixelSize: 240 }, fields: 'pixelSize' } }, // L: Nama Lengkap
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 12, endIndex: 13 }, properties: { pixelSize: 120 }, fields: 'pixelSize' } }, // M: Angkatan
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 13, endIndex: 14 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } }, // N: Status

      // ── LEFT TABLE (SUDAH PRESENSI) ──
      // Title B2:G2 (Emerald)
      { mergeCells: { range: { sheetId: sheetNumericId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: leftStartCol, endColumnIndex: leftEndCol }, mergeType: 'MERGE_ALL' } },
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: leftStartCol, endColumnIndex: leftEndCol },
          cell: { userEnteredFormat: {
            backgroundColor: { red: 0.04, green: 0.38, blue: 0.27 },
            textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
          }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      },
      // Subtitle B3:G3
      { mergeCells: { range: { sheetId: sheetNumericId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: leftStartCol, endColumnIndex: leftEndCol }, mergeType: 'MERGE_ALL' } },
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: leftStartCol, endColumnIndex: leftEndCol },
          cell: { userEnteredFormat: {
            backgroundColor: { red: 0.93, green: 0.98, blue: 0.95 },
            textFormat: { italic: true, fontSize: 9, foregroundColor: { red: 0.1, green: 0.4, blue: 0.25 } },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
          }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      },
      // Headers B4:G4 (Bright Emerald)
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: leftStartCol, endColumnIndex: leftEndCol },
          cell: { userEnteredFormat: {
            backgroundColor: { red: 0.06, green: 0.62, blue: 0.45 },
            textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
          }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      },
      // Left Data Rows
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t1Rows.length, startColumnIndex: leftStartCol, endColumnIndex: leftEndCol },
          cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', textFormat: { fontSize: 10 } } },
          fields: 'userEnteredFormat(verticalAlignment,textFormat.fontSize)',
        },
      },
      // Left Data: No, Jam, NIM centered
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t1Rows.length, startColumnIndex: leftStartCol, endColumnIndex: leftStartCol + 3 },
          cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
          fields: 'userEnteredFormat.horizontalAlignment',
        },
      },
      // Left Data: Nama Lengkap left+bold
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t1Rows.length, startColumnIndex: leftStartCol + 3, endColumnIndex: leftStartCol + 4 },
          cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', textFormat: { bold: true } } },
          fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold)',
        },
      },
      // Left Data: Angkatan centered
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t1Rows.length, startColumnIndex: leftStartCol + 4, endColumnIndex: leftStartCol + 5 },
          cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { bold: true } } },
          fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold)',
        },
      },
      // Left Data: Status Badge Green
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t1Rows.length, startColumnIndex: leftStartCol + 5, endColumnIndex: leftEndCol },
          cell: { userEnteredFormat: {
            backgroundColor: { red: 0.86, green: 0.98, blue: 0.9 },
            textFormat: { bold: true, foregroundColor: { red: 0.08, green: 0.5, blue: 0.24 } },
            horizontalAlignment: 'CENTER',
          }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
        },
      },
      // Left Data Borders
      {
        updateBorders: {
          range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t1Rows.length, startColumnIndex: leftStartCol, endColumnIndex: leftEndCol },
          top: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
          bottom: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
          left: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
          right: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
          innerHorizontal: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
          innerVertical: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
        },
      },

      // ── RIGHT TABLE (BELUM PRESENSI) ──
      // Title I2:N2 (Dark Slate)
      { mergeCells: { range: { sheetId: sheetNumericId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol }, mergeType: 'MERGE_ALL' } },
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol },
          cell: { userEnteredFormat: {
            backgroundColor: { red: 0.15, green: 0.2, blue: 0.28 },
            textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
          }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      },
      // Subtitle I3:N3
      { mergeCells: { range: { sheetId: sheetNumericId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol }, mergeType: 'MERGE_ALL' } },
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol },
          cell: { userEnteredFormat: {
            backgroundColor: { red: 0.96, green: 0.97, blue: 0.99 },
            textFormat: { italic: true, fontSize: 9, foregroundColor: { red: 0.35, green: 0.4, blue: 0.5 } },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
          }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      },
      // Headers I4:N4 (Slate)
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol },
          cell: { userEnteredFormat: {
            backgroundColor: { red: 0.25, green: 0.3, blue: 0.4 },
            textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
          }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      },
      // Right Data Rows
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t2Rows.length, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol },
          cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', textFormat: { fontSize: 10 } } },
          fields: 'userEnteredFormat(verticalAlignment,textFormat.fontSize)',
        },
      },
      // Right Data: No, Jam, NIM centered
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t2Rows.length, startColumnIndex: rightStartCol, endColumnIndex: rightStartCol + 3 },
          cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
          fields: 'userEnteredFormat.horizontalAlignment',
        },
      },
      // Right Data: Nama Lengkap left+bold
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t2Rows.length, startColumnIndex: rightStartCol + 3, endColumnIndex: rightStartCol + 4 },
          cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', textFormat: { bold: true } } },
          fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold)',
        },
      },
      // Right Data: Angkatan centered
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t2Rows.length, startColumnIndex: rightStartCol + 4, endColumnIndex: rightStartCol + 5 },
          cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { bold: true } } },
          fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold)',
        },
      },
      // Right Data: Status Badge Soft Red
      {
        repeatCell: {
          range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t2Rows.length, startColumnIndex: rightStartCol + 5, endColumnIndex: rightEndCol },
          cell: { userEnteredFormat: {
            backgroundColor: { red: 0.99, green: 0.9, blue: 0.9 },
            textFormat: { bold: true, foregroundColor: { red: 0.72, green: 0.15, blue: 0.15 } },
            horizontalAlignment: 'CENTER',
          }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
        },
      },
      // Right Data Borders
      {
        updateBorders: {
          range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t2Rows.length, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol },
          top: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
          bottom: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
          left: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
          right: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
          innerHorizontal: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
          innerVertical: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
        },
      },

      // Header row heights
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 32 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'ROWS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 22 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: sheetNumericId, dimension: 'ROWS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } },
      // Data rows height
      {
        updateDimensionProperties: {
          range: {
            sheetId: sheetNumericId,
            dimension: 'ROWS',
            startIndex: 4,
            endIndex: 4 + Math.max(t1Rows.length, t2Rows.length),
          },
          properties: { pixelSize: 26 },
          fields: 'pixelSize',
        },
      },
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests },
    });
  }

  return { tabName, presentCount: presentList.length, absentCount: absentList.length };
}
