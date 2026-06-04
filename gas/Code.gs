const SPREADSHEET_ID = "1QajsUci9L_a4HABS5c4qZ6Mu0-9zoBV9I8zxqGYllhk";
const TIMEZONE = "Asia/Tokyo";
const TOKEN = "";
const HEADERS = ["日付", "出勤", "退勤", "休憩分", "勤務時間", "休憩中", "休憩開始"];

function doGet(e) {
  const callback = e.parameter.callback || "";
  const result = handleRequest({
    action: e.parameter.action || "list",
    token: e.parameter.token || "",
  });
  const body = callback ? `${callback}(${JSON.stringify(result)})` : JSON.stringify(result);
  const mimeType = callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON;
  return ContentService.createTextOutput(body).setMimeType(mimeType);
}

function doPost(e) {
  const payload = JSON.parse(e.postData.contents || "{}");
  const result = handleRequest(payload);
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function handleRequest(payload) {
  try {
    if (TOKEN && payload.token !== TOKEN) {
      throw new Error("Invalid token");
    }

    if (payload.action === "list") {
      return { ok: true, records: listRecords() };
    }

    if (payload.action === "upsert") {
      upsertRecord(payload.record);
      return { ok: true };
    }

    if (payload.action === "delete") {
      deleteRecord(payload.date);
      return { ok: true };
    }

    throw new Error("Unknown action");
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function listRecords() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const records = [];

  spreadsheet.getSheets().forEach((sheet) => {
    if (!/^\d{4}-\d{2}$/.test(sheet.getName())) return;
    const values = sheet.getDataRange().getDisplayValues();

    values.slice(1).forEach((row) => {
      if (!row[0]) return;
      records.push({
        date: row[0],
        start: normalizeTime(row[1]),
        end: normalizeTime(row[2]),
        breakMinutes: Number(row[3]) || 0,
        breakActive: String(row[5]).toLowerCase() === "true",
        breakStart: normalizeTime(row[6]),
      });
    });
  });

  return records.sort((a, b) => a.date.localeCompare(b.date));
}

function upsertRecord(record) {
  if (!record || !record.date) throw new Error("Record date is required");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getMonthSheet(record.date.slice(0, 7));
    const rowIndex = findRowByDate(sheet, record.date);
    const values = [
      record.date,
      normalizeTime(record.start),
      normalizeTime(record.end),
      Number(record.breakMinutes) || 0,
      workedTime(record),
      Boolean(record.breakActive),
      normalizeTime(record.breakStart),
    ];

    if (rowIndex) {
      sheet.getRange(rowIndex, 1, 1, HEADERS.length).setValues([values]);
    } else {
      sheet.appendRow(values);
      sortSheet(sheet);
    }
  } finally {
    lock.releaseLock();
  }
}

function deleteRecord(date) {
  if (!date) throw new Error("Date is required");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getMonthSheet(date.slice(0, 7));
    const rowIndex = findRowByDate(sheet, date);
    if (rowIndex) sheet.deleteRow(rowIndex);
  } finally {
    lock.releaseLock();
  }
}

function getMonthSheet(month) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(month);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(month);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  } else {
    const currentHeaders = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
    if (currentHeaders.join("") !== HEADERS.join("")) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    }
  }

  return sheet;
}

function findRowByDate(sheet, date) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const dates = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  const index = dates.findIndex((row) => row[0] === date);
  return index === -1 ? null : index + 2;
}

function sortSheet(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 2) {
    sheet.getRange(2, 1, lastRow - 1, HEADERS.length).sort({ column: 1, ascending: true });
  }
}

function normalizeTime(value) {
  if (!value) return "";
  const parts = String(value).split(":");
  if (parts.length < 2) return "";
  return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
}

function workedTime(record) {
  const start = toMinutes(record.start);
  const end = toMinutes(record.end);
  if (start === null || end === null) return "";

  const minutes = Math.max(end - start - (Number(record.breakMinutes) || 0), 0);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}:${String(rest).padStart(2, "0")}`;
}

function toMinutes(time) {
  const normalized = normalizeTime(time);
  if (!normalized) return null;

  const parts = normalized.split(":").map(Number);
  return parts[0] * 60 + parts[1];
}
