import { google } from 'googleapis';
import { normalizeAngkatan, getTargetTabName } from '@/utils/angkatan';
import { getWIBDate, getWIBTime, getWIBLocaleString } from '@/lib/utils';
import { getNextWIBDate } from '@/lib/dayHelper';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

export const DEFAULT_HEADERS = [
  'No',
  'Waktu Masuk',
  'Tanggal Presensi',
  'NIM / NIP',
  'Nama Lengkap',
  'Angkatan',
  'Status Presensi',
  'Catatan / Alasan',
  'Tercatat Pada',
];

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
 * Ensure sheet tab exists with headers starting at B4 and stylish formatting.
 * If default "Sheet1" is empty, it can be renamed to the desired tabName.
 */
export async function ensureSheetTab(
  sheetId: string,
  tabName: string,
  headers: string[] = DEFAULT_HEADERS
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
    // Check if there is an untouched "Sheet1" that can be renamed
    const sheet1 = allSheets.find((s) => s.properties?.title === 'Sheet1');
    if (sheet1 && allSheets.length === 1) {
      // Check if Sheet1 is empty
      const checkData = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'Sheet1!A1:Z10',
      });
      const hasValues = checkData.data.values && checkData.data.values.length > 0;

      if (!hasValues) {
        // Rename Sheet1 to tabName
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
      // Add a new tab
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

  // Check if header already exists at B4
  const headerCheck = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!B4:J4`,
  });

  const headersPresent =
    headerCheck.data.values &&
    headerCheck.data.values.length > 0 &&
    headerCheck.data.values[0][0] === headers[0];

  if (!headersPresent) {
    // 1. Write Title Banner (B2:B3) and Column Headers (B4:J4)
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!B2:J4`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [`REKAP PRESENSI - ${tabName.toUpperCase()} - HARI KE-1`],
          [`Diperbarui otomatis oleh Sistem Absensi • Terkoneksi Realtime`],
          headers,
        ],
      },
    });

    // 2. Apply styling (freeze row 4, dark blue header format, fonts, banner format)
    await applyHeaderStyles(sheetId, sheetNumericId, headers.length);
  }

  tabNumericIdCache.set(cacheKey, sheetNumericId);
  return { sheetNumericId, createdOrRenamed: isNew };
}

/**
 * Apply neat styles to headers and title banner for Day 1 (Cols B to J)
 */
export async function applyHeaderStyles(
  sheetId: string,
  sheetNumericId: number,
  columnCount: number = 9
) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const endColumnIndex = 1 + columnCount; // Column B is index 1

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
          startRowIndex: 1, // row 2 (0-indexed)
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

    // 4. Format Table Header at B4 (Row 4)
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex: 3, // row 4
          endRowIndex: 4,
          startColumnIndex: 1,
          endColumnIndex: endColumnIndex,
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

    // 5. Header Borders
    {
      updateBorders: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex: 3,
          endRowIndex: 4,
          startColumnIndex: 1,
          endColumnIndex: endColumnIndex,
        },
        top: { style: 'SOLID', color: { red: 0.12, green: 0.16, blue: 0.24 } },
        bottom: { style: 'SOLID_MEDIUM', color: { red: 0.12, green: 0.16, blue: 0.24 } },
        left: { style: 'SOLID', color: { red: 0.12, green: 0.16, blue: 0.24 } },
        right: { style: 'SOLID', color: { red: 0.12, green: 0.16, blue: 0.24 } },
        innerVertical: { style: 'SOLID', color: { red: 0.3, green: 0.35, blue: 0.45 } },
      },
    },

    // 6. Set Header Row Height (36px)
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

    // 7. Auto Resize Columns (B to J)
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId: sheetNumericId,
          dimension: 'COLUMNS',
          startIndex: 1,
          endIndex: endColumnIndex,
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
    console.error('Failed applying header styles:', err.message);
  }
}

/**
 * Ensure Day 2 headers exist starting at column L (L4:T4) and title banner (L2:T3).
 * Column K is preserved as an empty spacer divider.
 */
export async function ensureDay2Headers(
  sheetId: string,
  sheetNumericId: number,
  tabName: string,
  headers: string[] = DEFAULT_HEADERS
) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const headerCheck = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!L4:T4`,
  });

  const headersPresent =
    headerCheck.data.values &&
    headerCheck.data.values.length > 0 &&
    headerCheck.data.values[0][0] === headers[0];

  if (!headersPresent) {
    // 1. Write Day 2 Title Banner (L2:L3) and Headers (L4:T4)
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tabName}'!L2:T4`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [`REKAP PRESENSI - ${tabName.toUpperCase()} - HARI KE-2`],
          [`Presensi Hari Ke-2 • Terkoneksi Realtime`],
          headers,
        ],
      },
    });

    // 2. Apply styling (Emerald theme for Day 2 + spacer on Column K)
    await applyDay2HeaderStyles(sheetId, sheetNumericId, headers.length);
  }
}

/**
 * Apply neat styles to headers and title banner for Day 2 (Cols L to T)
 * with Column K styled as a neat divider spacer.
 */
export async function applyDay2HeaderStyles(
  sheetId: string,
  sheetNumericId: number,
  columnCount: number = 9
) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const startColumnIndex = 11; // Column L is index 11
  const endColumnIndex = startColumnIndex + columnCount; // Column T is index 20

  const requests: any[] = [
    // 1. Set Column K (Spacer) width to 35px
    {
      updateDimensionProperties: {
        range: {
          sheetId: sheetNumericId,
          dimension: 'COLUMNS',
          startIndex: 10, // Column K
          endIndex: 11,
        },
        properties: {
          pixelSize: 35,
        },
        fields: 'pixelSize',
      },
    },

    // 2. Format Title Banner at L2
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex: 1, // row 2
          endRowIndex: 2,
          startColumnIndex: 11,
          endColumnIndex: 16,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              bold: true,
              fontSize: 13,
              foregroundColor: { red: 0.04, green: 0.38, blue: 0.27 }, // Emerald Green #065F46
            },
          },
        },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // 3. Format Subtitle at L3
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex: 2, // row 3
          endRowIndex: 3,
          startColumnIndex: 11,
          endColumnIndex: 16,
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

    // 4. Format Table Header at L4 (Row 4) - Deep Emerald
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex: 3, // row 4
          endRowIndex: 4,
          startColumnIndex: 11,
          endColumnIndex: endColumnIndex,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.02, green: 0.31, blue: 0.23 }, // Deep Emerald #064E3B
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

    // 5. Header Borders
    {
      updateBorders: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex: 3,
          endRowIndex: 4,
          startColumnIndex: 11,
          endColumnIndex: endColumnIndex,
        },
        top: { style: 'SOLID', color: { red: 0.02, green: 0.31, blue: 0.23 } },
        bottom: { style: 'SOLID_MEDIUM', color: { red: 0.02, green: 0.31, blue: 0.23 } },
        left: { style: 'SOLID', color: { red: 0.02, green: 0.31, blue: 0.23 } },
        right: { style: 'SOLID', color: { red: 0.02, green: 0.31, blue: 0.23 } },
        innerVertical: { style: 'SOLID', color: { red: 0.15, green: 0.45, blue: 0.35 } },
      },
    },

    // 6. Auto Resize Columns (L to T)
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId: sheetNumericId,
          dimension: 'COLUMNS',
          startIndex: 11,
          endIndex: endColumnIndex,
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
    console.error('Failed applying Day 2 header styles:', err.message);
  }
}

/**
 * Format data rows with borders, middle vertical alignment, and proper column alignment (Day 1: Cols B to J).
 */
export async function applyDataRowStyles(
  sheetId: string,
  sheetNumericId: number,
  startRow: number, // 1-indexed (e.g. 5)
  totalRows: number,
  columnCount: number = 9
) {
  if (totalRows <= 0) return;

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const startRowIndex = startRow - 1; // 0-indexed
  const endRowIndex = startRowIndex + totalRows;
  const endColumnIndex = 1 + columnCount;

  const requests: any[] = [
    // 1. Thin borders around and inside data cells
    {
      updateBorders: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex,
          endRowIndex,
          startColumnIndex: 1,
          endColumnIndex,
        },
        top: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        bottom: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        left: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        right: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        innerHorizontal: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
        innerVertical: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
      },
    },

    // 2. Base alignment & font for data cells
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex,
          endRowIndex,
          startColumnIndex: 1,
          endColumnIndex,
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

    // 3. Center alignment for No (Col B), Jam (Col C), Tanggal (Col D), NIM (Col E)
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex,
          endRowIndex,
          startColumnIndex: 1, // Col B (No)
          endColumnIndex: 5, // Col E (NIM)
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
          startColumnIndex: 6, // Col G (Angkatan)
          endColumnIndex: 8, // Col H (Status)
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            textFormat: {
              bold: true,
            },
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
          startColumnIndex: 9, // Col J (Waktu Sinkron)
          endColumnIndex: 10,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            textFormat: {
              fontSize: 9,
              foregroundColor: { red: 0.45, green: 0.5, blue: 0.58 },
            },
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,textFormat)',
      },
    },

    // 4. Set comfortable row heights (28px)
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

    // 5. Auto resize columns to fit text
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId: sheetNumericId,
          dimension: 'COLUMNS',
          startIndex: 1,
          endIndex: endColumnIndex,
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
    console.error('Failed applying data row styles:', err.message);
  }
}

/**
 * Format data rows for Day 2 (Cols L to T) with proper alignment, borders, and column styling.
 */
export async function applyDay2DataRowStyles(
  sheetId: string,
  sheetNumericId: number,
  startRow: number, // 1-indexed (e.g. 5)
  totalRows: number,
  columnCount: number = 9
) {
  if (totalRows <= 0) return;

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const startRowIndex = startRow - 1; // 0-indexed
  const endRowIndex = startRowIndex + totalRows;
  const startColumnIndex = 11; // Column L
  const endColumnIndex = startColumnIndex + columnCount; // Column T is index 20

  const requests: any[] = [
    // 1. Thin borders around and inside data cells
    {
      updateBorders: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex,
          endRowIndex,
          startColumnIndex,
          endColumnIndex,
        },
        top: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        bottom: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        left: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        right: { style: 'SOLID', color: { red: 0.85, green: 0.88, blue: 0.92 } },
        innerHorizontal: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
        innerVertical: { style: 'SOLID', color: { red: 0.9, green: 0.92, blue: 0.95 } },
      },
    },

    // 2. Base alignment & font for data cells
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex,
          endRowIndex,
          startColumnIndex,
          endColumnIndex,
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

    // 3. Center alignment for No (Col L=11), Jam (Col M=12), Tanggal (Col N=13), NIM (Col O=14)
    {
      repeatCell: {
        range: {
          sheetId: sheetNumericId,
          startRowIndex,
          endRowIndex,
          startColumnIndex: 11, // Col L (No)
          endColumnIndex: 15, // Up to Col O (NIM)
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
          startColumnIndex: 16, // Col Q (Angkatan)
          endColumnIndex: 18, // Col R (Status)
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            textFormat: {
              bold: true,
            },
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
          startColumnIndex: 19, // Col T (Waktu Sync)
          endColumnIndex: 20,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            textFormat: {
              fontSize: 9,
              foregroundColor: { red: 0.45, green: 0.5, blue: 0.58 },
            },
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,textFormat)',
      },
    },

    // 4. Set comfortable row heights (28px)
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

    // 5. Auto resize columns (L to T)
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId: sheetNumericId,
          dimension: 'COLUMNS',
          startIndex: 11,
          endIndex: endColumnIndex,
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
    console.error('Failed applying Day 2 data row styles:', err.message);
  }
}

/**
 * Appends a single row to a target tab starting at column B, after the last filled row.
 */
export async function appendRowToTab(sheetId: string, tabName: string, rowValues: any[]) {
  const { sheetNumericId } = await ensureSheetTab(sheetId, tabName);

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // Find the last row in Column B
  const colBData = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!B4:B`,
  });

  const existingCount = colBData.data.values?.length || 1; // Row 4 is header, so existingCount=1 means table has header only
  const nextRowNum = 4 + existingCount; // e.g. 4 + 1 = 5 (starts at B5)
  const nextNo = existingCount; // 1, 2, 3...

  // Prepend number if not supplied
  const fullRow = [nextNo, ...rowValues];

  // Write row starting at B[nextRowNum]
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${tabName}!B${nextRowNum}:J${nextRowNum}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [fullRow],
    },
  });

  // Apply neat styles for this newly appended row
  await applyDataRowStyles(sheetId, sheetNumericId, nextRowNum, 1, fullRow.length);
}

/**
 * Clears data in the specified column range from row 5 downwards and rewrites neat table.
 * Defaults to columns B to J (Day 1). For Day 2, pass 'L' and 'T'.
 * Preserves neighboring tables completely!
 */
export async function clearAndRewriteTab(
  sheetId: string,
  tabName: string,
  dataRows: any[][],
  startColLetter: string = 'B',
  endColLetter: string = 'J'
) {
  const { sheetNumericId } = await ensureSheetTab(sheetId, tabName);

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // Clear ONLY target column range (never wipe adjacent tables)
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `'${tabName}'!${startColLetter}5:${endColLetter}1000`,
    });
  } catch (e: any) {
    // Ignore clear errors
  }

  if (!dataRows || dataRows.length === 0) return;

  // Add numbering to first column
  const numberedRows = dataRows.map((row, idx) => [idx + 1, ...row]);
  const endRowNum = 4 + numberedRows.length;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!${startColLetter}5:${endColLetter}${endRowNum}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: numberedRows,
    },
  });

  // Apply neat styles
  if (startColLetter === 'B') {
    await applyDataRowStyles(sheetId, sheetNumericId, 5, numberedRows.length, DEFAULT_HEADERS.length);
  } else if (startColLetter === 'L') {
    await applyDay2DataRowStyles(sheetId, sheetNumericId, 5, numberedRows.length, DEFAULT_HEADERS.length);
  }
}

/**
 * Backwards compatibility wrapper for appendRows
 */
export async function appendRows(sheetId: string, tabName: string, rows: any[][]) {
  if (!rows || rows.length === 0) return;
  for (const row of rows) {
    await appendRowToTab(sheetId, tabName, row);
  }
}

/**
 * Finds the best matching tab title in the spreadsheet (handling variations like "Angkatan 25" vs "Angkatan 2025").
 */
export async function getExistingTabTitle(sheetId: string, requestedTabName: string): Promise<{ title: string; numericId: number }> {
  const cacheKey = `${sheetId}:${requestedTabName}`;
  if (tabNumericIdCache.has(cacheKey)) {
    return { title: requestedTabName, numericId: tabNumericIdCache.get(cacheKey)! };
  }

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const allSheets = meta.data.sheets || [];

  // 1. Exact match
  let found = allSheets.find(s => s.properties?.title === requestedTabName);
  
  // 2. Case-insensitive match
  if (!found) {
    found = allSheets.find(s => s.properties?.title?.toLowerCase() === requestedTabName.toLowerCase());
  }

  // 3. Flexible Angkatan matching (e.g. "Angkatan 25" vs "Angkatan 2025")
  if (!found && requestedTabName.toLowerCase().includes('angkatan')) {
    const digits = requestedTabName.match(/\d+/)?.[0];
    if (digits) {
      const shortYear = digits.slice(-2); // "25"
      const longYear = `20${shortYear}`; // "2025"
      found = allSheets.find(s => {
        const title = s.properties?.title || '';
        return title.toLowerCase().includes('angkatan') && (title.includes(shortYear) || title.includes(longYear));
      });
    }
  }

  // 4. Flexible Dosen matching
  if (!found && requestedTabName.toLowerCase().includes('dosen')) {
    found = allSheets.find(s => s.properties?.title?.toLowerCase().includes('dosen'));
  }

  if (found && found.properties?.title) {
    const numericId = found.properties.sheetId ?? 0;
    tabNumericIdCache.set(cacheKey, numericId);
    return { title: found.properties.title, numericId };
  }

  // Not found in existing sheets, ensure it
  const { sheetNumericId } = await ensureSheetTab(sheetId, requestedTabName);
  tabNumericIdCache.set(cacheKey, sheetNumericId);
  return { title: requestedTabName, numericId: sheetNumericId };
}

/**
 * Updates a student's row in-place if their NIM is already in the sheet (e.g. from pre-populated roster).
 * If the student is not yet in the sheet, appends a new row at the bottom.
 * Supports day 1 (Cols B:J) and day 2 (Cols L:T side-by-side).
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
  day: 1 | 2 = 1
) {
  const requestedTabName = getTargetTabName(record);
  const { title: tabName, numericId: sheetNumericId } = await getExistingTabTitle(sheetId, requestedTabName);

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Fetch column E (NIM) and column F (Nama) from row 1 to bottom
  const colEF = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!E:F`,
  });

  const rowValues = colEF.data.values || [];
  const targetNim = String(record.nim || '').trim().toUpperCase();
  const targetName = String(record.name || '').trim().toUpperCase();

  // Index 0 = Row 1. Row 4 is header, row 5 is index 4.
  let foundRowNumber = -1;
  for (let i = 0; i < rowValues.length; i++) {
    const rowNim = String(rowValues[i]?.[0] || '').trim().toUpperCase();
    const rowName = String(rowValues[i]?.[1] || '').trim().toUpperCase();

    if ((targetNim && rowNim === targetNim) || (targetName && rowName === targetName)) {
      foundRowNumber = i + 1; // Exactly row number in Google Sheets!
      break;
    }
  }

  // If not found in E:F and day === 2, check column O:P (Day 2 NIM and Nama)
  if (foundRowNumber === -1 && day === 2) {
    const colOP = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${tabName}'!O:P`,
    });
    const rowValuesDay2 = colOP.data.values || [];
    for (let i = 0; i < rowValuesDay2.length; i++) {
      const rowNim = String(rowValuesDay2[i]?.[0] || '').trim().toUpperCase();
      const rowName = String(rowValuesDay2[i]?.[1] || '').trim().toUpperCase();

      if ((targetNim && rowNim === targetNim) || (targetName && rowName === targetName)) {
        foundRowNumber = i + 1;
        break;
      }
    }
  }

  const rawTime = record.check_in_time || getWIBTime();
  const formattedTime = (rawTime.length > 5 ? rawTime.slice(0, 5) : rawTime) + ' WIB';
  const formattedDate = record.attendance_date || getWIBDate();
  const tercatatWIB = getWIBLocaleString();

  if (day === 2) {
    // Ensure Day 2 headers exist at L2:T4
    await ensureDay2Headers(sheetId, sheetNumericId, tabName);

    if (foundRowNumber !== -1) {
      // IN-PLACE UPDATE on Day 2 columns (L to T)
      // L: No, M: Waktu Masuk, N: Tanggal, O: NIM, P: Nama, Q: Angkatan, R: Status, S: Catatan, T: Tercatat Pada
      const studentNo = foundRowNumber - 4 > 0 ? foundRowNumber - 4 : 1;
      const updateValues = [
        studentNo,
        formattedTime,
        formattedDate,
        record.nim,
        record.name,
        normalizeAngkatan(record.class_name),
        record.status || 'Hadir',
        record.notes || '-',
        tercatatWIB,
      ];

      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `'${tabName}'!L${foundRowNumber}:T${foundRowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [updateValues],
        },
      });

      await applyDay2DataRowStyles(sheetId, sheetNumericId, foundRowNumber, 1);
      return { action: 'updated_day2', rowNumber: foundRowNumber, tabName };
    } else {
      // Append to bottom of Day 2 table
      const colLData = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${tabName}'!L4:L`,
      });
      const existingCount = colLData.data.values?.length || 1;
      const nextRowNum = 4 + existingCount;
      const nextNo = existingCount;

      const newRow = [
        nextNo,
        formattedTime,
        formattedDate,
        record.nim,
        record.name,
        normalizeAngkatan(record.class_name),
        record.status || 'Hadir',
        record.notes || '-',
        tercatatWIB,
      ];

      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `'${tabName}'!L${nextRowNum}:T${nextRowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [newRow],
        },
      });

      await applyDay2DataRowStyles(sheetId, sheetNumericId, nextRowNum, 1);
      return { action: 'appended_day2', tabName };
    }
  }

  // DAY 1 (Default behavior on B:J)
  if (foundRowNumber !== -1) {
    // IN-PLACE UPDATE on existing student row! (Columns C to J)
    // C: Waktu Masuk, D: Tanggal, E: NIM, F: Nama, G: Angkatan, H: Status, I: Catatan, J: Tercatat Pada
    const updateValues = [
      formattedTime,
      formattedDate,
      record.nim,
      record.name,
      normalizeAngkatan(record.class_name),
      record.status || 'Hadir',
      record.notes || '-',
      tercatatWIB,
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tabName}'!C${foundRowNumber}:J${foundRowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [updateValues],
      },
    });

    return { action: 'updated', rowNumber: foundRowNumber, tabName };
  } else {
    // Student not pre-populated in the sheet -> append as new row at the bottom
    const newRow = [
      formattedTime,
      formattedDate,
      record.nim,
      record.name,
      normalizeAngkatan(record.class_name),
      record.status || 'Hadir',
      record.notes || '-',
      tercatatWIB,
    ];

    await appendRowToTab(sheetId, tabName, newRow);
    return { action: 'appended', tabName };
  }
}

/**
 * Pre-populate or full-sync the sheet with the master roster of students:
 * Supports side-by-side Day 1 (Cols B:J) and Day 2 (Cols L:T) tables!
 * Students who haven't checked in yet will show "Belum Hadir" with "-" time.
 * Students who have checked in will show their actual check-in time and status.
 * Dosen attendances will be populated in the "Dosen" tab.
 */
export async function syncCategorizedWithMasterRoster(
  sheetId: string,
  allStudents: any[],
  attendances: any[],
  date: string,
  lecturers: string[] = [],
  dayOptions?: {
    activeDay?: 1 | 2 | 'auto';
    day1Date?: string;
    day2Date?: string;
  }
) {
  const day1Date = dayOptions?.day1Date || date;
  const day2Date = dayOptions?.day2Date || getNextWIBDate(day1Date);
  const activeDay =
    dayOptions?.activeDay === 2 ||
    (dayOptions?.activeDay === 'auto' && date >= day2Date) ||
    date === day2Date
      ? 2
      : dayOptions?.activeDay === 1
      ? 1
      : date >= day2Date
      ? 2
      : 1;

  // Map attendances into Day 1 and Day 2 sets
  const attMapDay1 = new Map<string, any>();
  const attMapDay2 = new Map<string, any>();

  for (const att of attendances) {
    const isDay2 =
      att.attendance_date === day2Date ||
      (att.attendance_date && att.attendance_date > day1Date);
    const targetMap = isDay2 ? attMapDay2 : attMapDay1;

    if (att.nim) targetMap.set(String(att.nim).trim().toUpperCase(), att);
    if (att.name) targetMap.set(String(att.name).trim().toUpperCase(), att);
  }

  // 1. Group students by Angkatan
  const groups: Record<string, any[]> = {};

  for (const s of allStudents) {
    const tabName = normalizeAngkatan(s.class_name);
    if (!groups[tabName]) groups[tabName] = [];

    const existingAttDay1 =
      attMapDay1.get(String(s.nim).trim().toUpperCase()) ||
      attMapDay1.get(String(s.name).trim().toUpperCase());
    const existingAttDay2 =
      attMapDay2.get(String(s.nim).trim().toUpperCase()) ||
      attMapDay2.get(String(s.name).trim().toUpperCase());

    groups[tabName].push({
      nim: s.nim,
      name: s.name,
      class_name: s.class_name,
      day1: {
        attendance_date: day1Date,
        check_in_time: existingAttDay1?.check_in_time
          ? existingAttDay1.check_in_time.slice(0, 5) + ' WIB'
          : '-',
        status: existingAttDay1?.status || 'Belum Hadir',
        notes: existingAttDay1?.notes || '-',
        synced_at: existingAttDay1
          ? new Date(existingAttDay1.created_at || Date.now()).toLocaleString('id-ID', {
              timeZone: 'Asia/Jakarta',
            }) + ' WIB'
          : '-',
      },
      day2: {
        attendance_date: day2Date,
        check_in_time: existingAttDay2?.check_in_time
          ? existingAttDay2.check_in_time.slice(0, 5) + ' WIB'
          : '-',
        status: existingAttDay2?.status || 'Belum Hadir',
        notes: existingAttDay2?.notes || '-',
        synced_at: existingAttDay2
          ? new Date(existingAttDay2.created_at || Date.now()).toLocaleString('id-ID', {
              timeZone: 'Asia/Jakarta',
            }) + ' WIB'
          : '-',
      },
    });
  }

  // 2. Pre-populate Dosen tab with all registered lecturers from master list
  const dosenMapByNameDay1 = new Map<string, any>();
  const dosenMapByNameDay2 = new Map<string, any>();

  for (const att of attendances) {
    const isDosen =
      att.lecturer_name ||
      (att.nim && String(att.nim).toUpperCase().startsWith('DOSEN')) ||
      (att.class_name && String(att.class_name).toLowerCase().includes('dosen'));

    if (isDosen && att.name) {
      const isDay2 =
        att.attendance_date === day2Date ||
        (att.attendance_date && att.attendance_date > day1Date);
      if (isDay2) {
        dosenMapByNameDay2.set(String(att.name).trim().toUpperCase(), att);
      } else {
        dosenMapByNameDay1.set(String(att.name).trim().toUpperCase(), att);
      }
    }
  }

  const dosenList: any[] = [];
  const processedDosenNames = new Set<string>();

  // Pre-populate each registered lecturer
  for (let idx = 0; idx < lecturers.length; idx++) {
    const docName = lecturers[idx].trim();
    processedDosenNames.add(docName.toUpperCase());

    const attDay1 = dosenMapByNameDay1.get(docName.toUpperCase());
    const attDay2 = dosenMapByNameDay2.get(docName.toUpperCase());
    const docNip =
      attDay1?.nim || attDay2?.nim || `DOSEN-${String(idx + 1).padStart(2, '0')}`;

    dosenList.push({
      nim: docNip,
      name: docName,
      class_name: 'Dosen',
      day1: {
        attendance_date: day1Date,
        check_in_time: attDay1?.check_in_time
          ? attDay1.check_in_time.slice(0, 5) + ' WIB'
          : '-',
        status: attDay1?.status || 'Belum Hadir',
        notes: attDay1?.notes || '-',
        synced_at: attDay1
          ? new Date(attDay1.created_at || Date.now()).toLocaleString('id-ID', {
              timeZone: 'Asia/Jakarta',
            }) + ' WIB'
          : '-',
      },
      day2: {
        attendance_date: day2Date,
        check_in_time: attDay2?.check_in_time
          ? attDay2.check_in_time.slice(0, 5) + ' WIB'
          : '-',
        status: attDay2?.status || 'Belum Hadir',
        notes: attDay2?.notes || '-',
        synced_at: attDay2
          ? new Date(attDay2.created_at || Date.now()).toLocaleString('id-ID', {
              timeZone: 'Asia/Jakarta',
            }) + ' WIB'
          : '-',
      },
    });
  }

  // Include any other Dosen who attended but wasn't in master list
  for (const att of attendances) {
    const isDosen =
      att.lecturer_name ||
      (att.nim && String(att.nim).toUpperCase().startsWith('DOSEN')) ||
      (att.class_name && String(att.class_name).toLowerCase().includes('dosen'));

    if (
      isDosen &&
      att.name &&
      !processedDosenNames.has(String(att.name).trim().toUpperCase())
    ) {
      processedDosenNames.add(String(att.name).trim().toUpperCase());
      const isDay2 =
        att.attendance_date === day2Date ||
        (att.attendance_date && att.attendance_date > day1Date);

      dosenList.push({
        nim: att.nim,
        name: att.name,
        class_name: 'Dosen',
        day1: {
          attendance_date: day1Date,
          check_in_time: !isDay2 && att.check_in_time
            ? att.check_in_time.slice(0, 5) + ' WIB'
            : '-',
          status: !isDay2 ? att.status || 'Hadir' : 'Belum Hadir',
          notes: !isDay2 ? att.notes || '-' : '-',
          synced_at: !isDay2
            ? new Date(att.created_at || Date.now()).toLocaleString('id-ID', {
                timeZone: 'Asia/Jakarta',
              }) + ' WIB'
            : '-',
        },
        day2: {
          attendance_date: day2Date,
          check_in_time: isDay2 && att.check_in_time
            ? att.check_in_time.slice(0, 5) + ' WIB'
            : '-',
          status: isDay2 ? att.status || 'Hadir' : 'Belum Hadir',
          notes: isDay2 ? att.notes || '-' : '-',
          synced_at: isDay2
            ? new Date(att.created_at || Date.now()).toLocaleString('id-ID', {
                timeZone: 'Asia/Jakarta',
              }) + ' WIB'
            : '-',
        },
      });
    }
  }

  if (dosenList.length > 0) {
    groups['Dosen'] = dosenList;
  }

  // Should Day 2 table be populated? (if Day 2 is active or has attendees or setting is 2)
  const shouldPopulateDay2 =
    activeDay === 2 || attMapDay2.size > 0 || dayOptions?.activeDay === 2;

  // 3. Write each tab concurrently for maximum speed
  const results = await Promise.all(
    Object.entries(groups).map(async ([tabName, items]) => {
      // Sort by NIM
      items.sort((a, b) => String(a.nim).localeCompare(String(b.nim)));

      const { sheetNumericId } = await ensureSheetTab(sheetId, tabName);

      // 3a. Write Day 1 data (Cols B to J)
      const day1Rows = items.map((item) => [
        item.day1.check_in_time,
        item.day1.attendance_date,
        item.nim,
        item.name,
        normalizeAngkatan(item.class_name),
        item.day1.status,
        item.day1.notes,
        item.day1.synced_at,
      ]);

      await clearAndRewriteTab(sheetId, tabName, day1Rows, 'B', 'J');

      // 3b. If Day 2 is active or has check-ins, also write Day 2 side-by-side (Cols L to T)
      if (shouldPopulateDay2) {
        await ensureDay2Headers(sheetId, sheetNumericId, tabName);

        const day2Rows = items.map((item) => [
          item.day2.check_in_time,
          item.day2.attendance_date,
          item.nim,
          item.name,
          normalizeAngkatan(item.class_name),
          item.day2.status,
          item.day2.notes,
          item.day2.synced_at,
        ]);

        await clearAndRewriteTab(sheetId, tabName, day2Rows, 'L', 'T');
      }

      return { tabName, count: items.length, day2Generated: shouldPopulateDay2 };
    })
  );

  return results;
}

/**
 * Synchronize attendance records categorized automatically into separate tabs:
 * - Dosen -> Tab "Dosen"
 * - Mahasiswa Angkatan 25 -> Tab "Angkatan 25"
 * - Mahasiswa Angkatan 26 -> Tab "Angkatan 26"
 * etc.
 */
export async function syncCategorizedAttendances(sheetId: string, attendances: any[]) {
  const groups: Record<string, any[]> = {};

  for (const att of attendances) {
    const tabName = getTargetTabName(att);
    if (!groups[tabName]) {
      groups[tabName] = [];
    }
    groups[tabName].push(att);
  }

  const results: { tabName: string; count: number }[] = [];

  for (const [tabName, groupItems] of Object.entries(groups)) {
    const dataRows = groupItems.map((item) => [
      item.check_in_time ? item.check_in_time.slice(0, 5) + ' WIB' : '-',
      item.attendance_date || '-',
      item.nim || '-',
      item.name || '-',
      normalizeAngkatan(item.class_name),
      item.status || 'Hadir',
      item.notes || '-',
      new Date().toLocaleString('id-ID'),
    ]);

    await clearAndRewriteTab(sheetId, tabName, dataRows, 'B', 'J');
    results.push({ tabName, count: dataRows.length });
  }

  return results;
}

/**
 * Resets a student's row in Google Sheets back to "Belum Hadir" with "-" check-in time.
 * Supports resetting Day 1 (Cols C:J) or Day 2 (Cols M:T).
 */
export async function resetAttendanceInSheet(
  sheetId: string,
  record: {
    nim: string;
    name: string;
    class_name: string;
    attendance_date?: string;
  },
  day: 1 | 2 = 1
) {
  const requestedTabName = getTargetTabName(record);
  const { title: tabName, numericId: sheetNumericId } = await getExistingTabTitle(sheetId, requestedTabName);

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Fetch column E (NIM) and column F (Nama) from row 1 to bottom
  const colEF = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!E:F`,
  });

  const rowValues = colEF.data.values || [];
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

  // If not found in E:F and day === 2, check column O:P (Day 2 NIM and Nama)
  if (foundRowNumber === -1 && day === 2) {
    const colOP = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${tabName}'!O:P`,
    });
    const rowValuesDay2 = colOP.data.values || [];
    for (let i = 0; i < rowValuesDay2.length; i++) {
      const rowNim = String(rowValuesDay2[i]?.[0] || '').trim().toUpperCase();
      const rowName = String(rowValuesDay2[i]?.[1] || '').trim().toUpperCase();

      if ((targetNim && rowNim === targetNim) || (targetName && rowName === targetName)) {
        foundRowNumber = i + 1;
        break;
      }
    }
  }

  if (foundRowNumber !== -1) {
    if (day === 2) {
      // Reset Day 2 columns M to T
      // M: Waktu Masuk, N: Tanggal, O: NIM, P: Nama, Q: Angkatan, R: Status, S: Catatan, T: Tercatat Pada
      const resetValues = [
        '-',
        record.attendance_date || '-',
        record.nim,
        record.name,
        normalizeAngkatan(record.class_name),
        'Belum Hadir',
        '-',
        '-',
      ];
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `'${tabName}'!M${foundRowNumber}:T${foundRowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [resetValues] },
      });
      await applyDay2DataRowStyles(sheetId, sheetNumericId, foundRowNumber, 1);
    } else {
      // Reset Day 1 columns C to J
      const resetValues = [
        '-',
        record.attendance_date || '-',
        record.nim,
        record.name,
        normalizeAngkatan(record.class_name),
        'Belum Hadir',
        '-',
        '-',
      ];
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `'${tabName}'!C${foundRowNumber}:J${foundRowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [resetValues] },
      });
      await applyDataRowStyles(sheetId, sheetNumericId, foundRowNumber, 1);
    }
    return { success: true, rowNumber: foundRowNumber };
  }

  return { success: false, notFound: true };
}
