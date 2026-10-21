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
 * Builds the clean Model B matrix table headers dynamically based on configured days:
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

// In-memory cache for sheet numeric IDs to make realtime updates lightning fast
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

  // Write Title Banner (B2:B3) and Column Headers (B4:endColLetter4)
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

  // Apply neat styling for Model B
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
  const endColIndex = startColIndex + totalColumns; // e.g. 1 + 9 = 10

  const dayStartColIndex = 5; // Column F (index 5) is first Day column
  const dayEndColIndex = dayStartColIndex + daysCount; // Up to last day column

  const requests: any[] = [
    // 1. Freeze top 4 rows
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

    // 2. Format Title Banner at B2
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex: 1, // row 2
          endRowIndex: 2,
          startColumnIndex: 1,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              bold: true,
              fontSize: 13,
              foregroundColor: { red: 0.12, green: 0.23, blue: 0.54 }, // Navy #1E3A8A
            },
          },
        },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // 3. Format Subtitle at B3
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex: 2, // row 3
          endRowIndex: 3,
          startColumnIndex: 1,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              italic: true,
              fontSize: 9,
              foregroundColor: { red: 0.39, green: 0.45, blue: 0.55 }, // Gray #64748B
            },
          },
        },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // 4. Base Table Header at B4 (Row 4) - Dark Slate
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex: 3, // row 4
          endRowIndex: 4,
          startColumnIndex: 1,
          endColumnIndex: endColIndex,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.12, green: 0.16, blue: 0.24 }, // Dark Slate #1E293B
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

    // 5. Highlight Day Columns (F onwards) with Deep Emerald/Teal Header
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
            backgroundColor: { red: 0.04, green: 0.38, blue: 0.27 }, // Emerald Green #065F46
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

    // 6. Header Borders
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

    // 7. Set Header Row Height (36px)
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

    // 8. Auto Resize Columns
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId: sheetNumericId,
          dimension: 'COLUMNS',
          startIndex: 1,
          endIndex: endColIndex,
        },
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
  startRow: number, // 1-indexed (e.g. 5)
  totalRows: number,
  totalColumns: number
) {
  if (totalRows <= 0) return;

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const startRowIndex = startRow - 1; // 0-indexed
  const endRowIndex = startRowIndex + totalRows;
  const endColIndex = 1 + totalColumns;

  const requests: any[] = [
    // 1. Thin borders around and inside data cells
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

    // 2. Base alignment & font
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

    // 3. Center alignment for No (Col B), NIM (Col C)
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex,
          endRowIndex,
          startColumnIndex: 1, // Col B
          endColumnIndex: 3, // Up to Col C
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },

    // 4. Center alignment for Angkatan (Col E)
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex,
          endRowIndex,
          startColumnIndex: 4, // Col E
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

    // 5. Center alignment for Day Columns (Col F onwards)
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex,
          endRowIndex,
          startColumnIndex: 5, // Col F
          endColumnIndex: endColIndex - 2, // Up to Total Hadir
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

    // 6. Set row height (28px)
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

    // 7. Auto resize columns
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId: sheetNumericId,
          dimension: 'COLUMNS',
          startIndex: 1,
          endIndex: endColIndex,
        },
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

  // 1. Fetch column C (NIM) and column D (Nama) from row 1 to bottom
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
  const statusFormatted =
    record.status === 'Hadir'
      ? `Hadir (${timeFormatted})`
      : record.status || 'Hadir';

  const dayIndex = day > 0 ? day : 1;
  // Day 1 is at index 5 (Col F), Day 2 is at index 6 (Col G), etc.
  const dayColIndex = 4 + dayIndex;
  const dayColLetter = getColumnLetter(dayColIndex);

  const totalHadirColIndex = 4 + normalizedDays.length + 1;
  const totalHadirColLetter = getColumnLetter(totalHadirColIndex);

  const catatanColLetter = getColumnLetter(totalHadirColIndex + 1);
  const syncColLetter = getColumnLetter(totalHadirColIndex + 2);
  const syncTime = getWIBLocaleString();

  if (foundRowNumber !== -1) {
    // 2. IN-PLACE UPDATE on existing student row:
    // Update the Day cell
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tabName}'!${dayColLetter}${foundRowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[statusFormatted]],
      },
    });

    // Read the entire Day range for this row to compute Total Hadir
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

    return { action: 'updated_matrix', rowNumber: foundRowNumber, tabName };
  } else {
    // Student not pre-populated: Append to bottom of matrix table
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

    return { success: true, rowNumber: foundRowNumber };
  }

  return { success: false, notFound: true };
}

/**
 * Pre-populates or synchronizes the entire roster into Model B Matrix Table:
 * [No, NIM / NIP, Nama Lengkap, Angkatan, Hari 1, Hari 2, ..., Total Hadir, Catatan, Sync]
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

  const normalizedDays =
    dayOptions?.days && dayOptions.days.length > 0
      ? dayOptions.days
      : getDaysList();

  // Map attendances: key is `${nim}_${date}` and `${name}_${date}`
  const attMap = new Map<string, any>();
  for (const att of attendances) {
    const attDate = att.attendance_date || date;
    if (att.nim) attMap.set(`${String(att.nim).trim().toUpperCase()}_${attDate}`, att);
    if (att.name) attMap.set(`${String(att.name).trim().toUpperCase()}_${attDate}`, att);
  }

  // 1. Group students by Angkatan
  const groups: Record<string, any[]> = {};

  for (const s of allStudents) {
    const tabName = normalizeAngkatan(s.class_name);
    if (!groups[tabName]) groups[tabName] = [];

    const studentNim = String(s.nim || '').trim().toUpperCase();
    const studentName = String(s.name || '').trim().toUpperCase();

    let attendedCount = 0;
    let latestNotes = '-';
    let latestSync = '-';

    const dayValues = normalizedDays.map((d) => {
      const att =
        attMap.get(`${studentNim}_${d.date}`) ||
        attMap.get(`${studentName}_${d.date}`);

      if (att) {
        attendedCount++;
        if (att.notes && att.notes !== '-') latestNotes = att.notes;
        latestSync = new Date(att.created_at || Date.now()).toLocaleString('id-ID', {
          timeZone: 'Asia/Jakarta',
        }) + ' WIB';

        const rawTime = (att.check_in_time || '').slice(0, 5);
        return att.status === 'Hadir'
          ? `Hadir (${rawTime} WIB)`
          : att.status || 'Hadir';
      }
      return '-';
    });

    groups[tabName].push({
      nim: s.nim,
      name: s.name,
      class_name: s.class_name,
      dayValues,
      totalHadir: `${attendedCount} / ${normalizedDays.length} Hari`,
      notes: latestNotes,
      synced_at: latestSync,
    });
  }

  // 2. Pre-populate Dosen
  const dosenList: any[] = [];
  const processedDosenNames = new Set<string>();

  for (let idx = 0; idx < lecturers.length; idx++) {
    const docName = lecturers[idx].trim();
    processedDosenNames.add(docName.toUpperCase());

    let attendedCount = 0;
    let latestNotes = '-';
    let latestSync = '-';

    const dayValues = normalizedDays.map((d) => {
      const att = attMap.get(`${docName.toUpperCase()}_${d.date}`);
      if (att) {
        attendedCount++;
        if (att.notes && att.notes !== '-') latestNotes = att.notes;
        latestSync = new Date(att.created_at || Date.now()).toLocaleString('id-ID', {
          timeZone: 'Asia/Jakarta',
        }) + ' WIB';

        const rawTime = (att.check_in_time || '').slice(0, 5);
        return att.status === 'Hadir'
          ? `Hadir (${rawTime} WIB)`
          : att.status || 'Hadir';
      }
      return '-';
    });

    dosenList.push({
      nim: `DOSEN-${String(idx + 1).padStart(2, '0')}`,
      name: docName,
      class_name: 'Dosen',
      dayValues,
      totalHadir: `${attendedCount} / ${normalizedDays.length} Hari`,
      notes: latestNotes,
      synced_at: latestSync,
    });
  }

  if (dosenList.length > 0) {
    groups['Dosen'] = dosenList;
  }

  // 3. Clear and rewrite each tab
  const headers = buildModelBHeaders(normalizedDays);
  const endColLetter = getColumnLetter(headers.length);

  const results = await Promise.all(
    Object.entries(groups).map(async ([tabName, items]) => {
      items.sort((a, b) => String(a.nim).localeCompare(String(b.nim)));

      const { sheetNumericId } = await ensureSheetTab(sheetId, tabName, normalizedDays);

      const rows = items.map((item, idx) => [
        idx + 1,
        item.nim,
        item.name,
        normalizeAngkatan(item.class_name),
        ...item.dayValues,
        item.totalHadir,
        item.notes,
        item.synced_at,
      ]);

      const endRowNum = 4 + rows.length;

      // Clear from B5 downwards up to endColLetter (preserving side tables at L:P)
      try {
        await sheets.spreadsheets.values.clear({
          spreadsheetId: sheetId,
          range: `'${tabName}'!B5:${endColLetter}1000`,
        });
      } catch (e) {}

      // Write data rows
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `'${tabName}'!B5:${endColLetter}${endRowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: rows,
        },
      });

      // Apply styling
      await applyModelBDataRowStyles(
        sheetId,
        sheetNumericId,
        5,
        rows.length,
        headers.length
      );

      // Sinkronkan 2 Tabel Samping di Kolom L s/d P:
      // Tabel 1 (Atas): Sudah Absen (Urut waktu presensi paling cepat / check_in_time ASC)
      // Tabel 2 (Bawah): Belum Absen
      try {
        await syncSideTables(
          sheetId,
          tabName,
          sheetNumericId,
          items,
          attendances,
          date
        );
      } catch (sideErr: any) {
        console.error(`Error syncing side tables for ${tabName}:`, sideErr?.message || sideErr);
      }

      return { tabName, count: rows.length };
    })
  );

  return results;
}

/**
 * Renders the two live side-tables starting at Column L4:
 * Table 1 (Top): Mahasiswa / Dosen SUDAH ABSEN (Urut waktu kehadiran tercepat / check_in_time ASC)
 * Table 2 (Bottom): Mahasiswa / Dosen BELUM ABSEN (Urut NIM ASC)
 */
export async function syncSideTables(
  sheetId: string,
  tabName: string,
  sheetNumericId: number,
  items: any[],
  attendances: any[],
  targetDate: string
) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Map attendances on targetDate for fast lookup
  const attByNim = new Map<string, any>();
  for (const att of attendances) {
    const aDate = att.attendance_date || targetDate;
    if (aDate === targetDate) {
      if (att.nim) attByNim.set(String(att.nim).trim().toUpperCase(), att);
      if (att.name) attByNim.set(String(att.name).trim().toUpperCase(), att);
    }
  }

  // 2. Separate into Present and Absent
  const presentList: {
    item: any;
    att: any;
    time: string;
    rawTime: string;
  }[] = [];
  const absentList: any[] = [];

  for (const item of items) {
    const nimKey = String(item.nim || '').trim().toUpperCase();
    const nameKey = String(item.name || '').trim().toUpperCase();
    const att = attByNim.get(nimKey) || attByNim.get(nameKey);

    if (att) {
      const rawTime = att.check_in_time || '00:00:00';
      presentList.push({
        item,
        att,
        time: rawTime.slice(0, 8),
        rawTime,
      });
    } else {
      absentList.push(item);
    }
  }

  // 3. Sort Present by check_in_time ASC (yang paling pertama absen di paling atas!)
  presentList.sort((a, b) => a.rawTime.localeCompare(b.rawTime));
  // Sort Absent by NIM or Name
  absentList.sort((a, b) => String(a.nim || a.name).localeCompare(String(b.nim || b.name)));

  // 4. Data for Table 1 (Sudah Absen)
  const isDosenTab = tabName.toLowerCase().includes('dosen');
  const roleLabel = isDosenTab ? 'Dosen' : 'Mahasiswa';

  const t1Header = ['No', 'Jam Masuk', isDosenTab ? 'NIM / NIP' : 'NIM', 'Nama Lengkap', 'Status'];
  const t1DataRows =
    presentList.length > 0
      ? presentList.map((p, idx) => [
          idx + 1,
          `${p.time} WIB`,
          p.item.nim || '-',
          p.item.name || '-',
          p.att.status || 'Hadir',
        ])
      : [['-', '-', '-', `Belum ada ${roleLabel.toLowerCase()} yang presensi`, '-']];

  // 5. Data for Table 2 (Belum Absen)
  const t1EndRow = 4 + t1DataRows.length; // Header at row 4, data rows start row 5
  const t2TitleRow = t1EndRow + 3; // 2 spacing rows
  const t2SubtitleRow = t2TitleRow + 1;
  const t2HeaderRow = t2SubtitleRow + 1;

  const t2Header = ['No', 'Waktu', isDosenTab ? 'NIM / NIP' : 'NIM', 'Nama Lengkap', 'Status'];
  const t2DataRows =
    absentList.length > 0
      ? absentList.map((s, idx) => [
          idx + 1,
          '-',
          s.nim || '-',
          s.name || '-',
          'Belum Hadir',
        ])
      : [['-', '-', '-', `Semua ${roleLabel.toLowerCase()} sudah presensi! 🎉`, 'Lengkap']];

  // 6. Clear old side tables range (L2:P500)
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `'${tabName}'!L2:P500`,
    });
  } catch (e) {}

  // 7. Write Table 1 Values (L2:P...)
  const t1Values = [
    [`DAFTAR SUDAH PRESENSI (${presentList.length} ${roleLabel.toUpperCase()})`, '', '', '', ''],
    [`Urut berdasarkan waktu kehadiran tercepat • Sesi ${targetDate}`, '', '', '', ''],
    t1Header,
    ...t1DataRows,
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!L2:P${4 + t1DataRows.length}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: t1Values },
  });

  // Write Table 2 Values (L${t2TitleRow}:P...)
  const t2Values = [
    [`DAFTAR BELUM PRESENSI (${absentList.length} ${roleLabel.toUpperCase()})`, '', '', '', ''],
    [`${roleLabel} yang belum melakukan presensi pada hari ini`, '', '', '', ''],
    t2Header,
    ...t2DataRows,
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!L${t2TitleRow}:P${t2HeaderRow + t2DataRows.length}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: t2Values },
  });

  // 8. Formatting Styling Requests
  const requests: any[] = [
    // Column Widths
    {
      updateDimensionProperties: {
        range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 }, // K (spacer)
        properties: { pixelSize: 30 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 11, endIndex: 12 }, // L (No)
        properties: { pixelSize: 45 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 12, endIndex: 13 }, // M (Jam)
        properties: { pixelSize: 110 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 13, endIndex: 14 }, // N (NIM)
        properties: { pixelSize: 110 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 14, endIndex: 15 }, // O (Nama)
        properties: { pixelSize: 240 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: sheetNumericId, dimension: 'COLUMNS', startIndex: 15, endIndex: 16 }, // P (Status)
        properties: { pixelSize: 105 },
        fields: 'pixelSize',
      },
    },

    // Unmerge potential previous merges
    {
      unmergeCells: {
        range: { sheetId: sheetNumericId, startRowIndex: 1, endRowIndex: 3, startColumnIndex: 11, endColumnIndex: 16 },
      },
    },
    {
      unmergeCells: {
        range: { sheetId: sheetNumericId, startRowIndex: t2TitleRow - 1, endRowIndex: t2HeaderRow - 1, startColumnIndex: 11, endColumnIndex: 16 },
      },
    },

    // Merge Table 1 Title & Subtitle
    {
      mergeCells: {
        range: { sheetId: sheetNumericId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 11, endColumnIndex: 16 },
        mergeType: 'MERGE_ALL',
      },
    },
    {
      mergeCells: {
        range: { sheetId: sheetNumericId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 11, endColumnIndex: 16 },
        mergeType: 'MERGE_ALL',
      },
    },

    // Table 1 Title Style (Emerald #0A7459)
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 11, endColumnIndex: 16 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.04, green: 0.45, blue: 0.35 },
            textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Table 1 Subtitle Style
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 11, endColumnIndex: 16 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.92, green: 0.98, blue: 0.95 },
            textFormat: { italic: true, fontSize: 9, foregroundColor: { red: 0.02, green: 0.38, blue: 0.28 } },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Table 1 Header Style (Emerald #059669)
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 11, endColumnIndex: 16 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.02, green: 0.59, blue: 0.41 },
            textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Table 1 Data Columns: Alignment
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t1DataRows.length, startColumnIndex: 11, endColumnIndex: 14 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t1DataRows.length, startColumnIndex: 14, endColumnIndex: 15 },
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE', textFormat: { bold: true } } },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat.bold)',
      },
    },
    // Table 1 Status Column: Light Green Background
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: 4, endRowIndex: 4 + t1DataRows.length, startColumnIndex: 15, endColumnIndex: 16 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.86, green: 0.98, blue: 0.9 },
            textFormat: { bold: true, foregroundColor: { red: 0.09, green: 0.4, blue: 0.2 } },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Merge Table 2 Title & Subtitle
    {
      mergeCells: {
        range: { sheetId: sheetNumericId, startRowIndex: t2TitleRow - 1, endRowIndex: t2TitleRow, startColumnIndex: 11, endColumnIndex: 16 },
        mergeType: 'MERGE_ALL',
      },
    },
    {
      mergeCells: {
        range: { sheetId: sheetNumericId, startRowIndex: t2SubtitleRow - 1, endRowIndex: t2SubtitleRow, startColumnIndex: 11, endColumnIndex: 16 },
        mergeType: 'MERGE_ALL',
      },
    },
    // Table 2 Title Style (Dark Slate #334155)
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: t2TitleRow - 1, endRowIndex: t2TitleRow, startColumnIndex: 11, endColumnIndex: 16 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.2, green: 0.25, blue: 0.33 },
            textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Table 2 Subtitle Style
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: t2SubtitleRow - 1, endRowIndex: t2SubtitleRow, startColumnIndex: 11, endColumnIndex: 16 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.95, green: 0.96, blue: 0.98 },
            textFormat: { italic: true, fontSize: 9, foregroundColor: { red: 0.3, green: 0.35, blue: 0.45 } },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Table 2 Header Style (Slate #475569)
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: t2HeaderRow - 1, endRowIndex: t2HeaderRow, startColumnIndex: 11, endColumnIndex: 16 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.28, green: 0.33, blue: 0.41 },
            textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Table 2 Data Columns: Alignment
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: t2HeaderRow, endRowIndex: t2HeaderRow + t2DataRows.length, startColumnIndex: 11, endColumnIndex: 14 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: t2HeaderRow, endRowIndex: t2HeaderRow + t2DataRows.length, startColumnIndex: 14, endColumnIndex: 15 },
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE', textFormat: { bold: true } } },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat.bold)',
      },
    },
    // Table 2 Status Column: Soft Red Background
    {
      repeatCell: {
        range: { sheetId: sheetNumericId, startRowIndex: t2HeaderRow, endRowIndex: t2HeaderRow + t2DataRows.length, startColumnIndex: 15, endColumnIndex: 16 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.99, green: 0.89, blue: 0.89 },
            textFormat: { bold: true, foregroundColor: { red: 0.6, green: 0.11, blue: 0.11 } },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests },
  });
}
