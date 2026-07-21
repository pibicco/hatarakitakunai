const SHEET_CSV_URLS = [
  "https://docs.google.com/spreadsheets/d/1QajsUci9L_a4HABS5c4qZ6Mu0-9zoBV9I8zxqGYllhk/export?format=csv&gid=523755050",
  "https://docs.google.com/spreadsheets/d/1QajsUci9L_a4HABS5c4qZ6Mu0-9zoBV9I8zxqGYllhk/export?format=csv&gid=1893875610",
  "https://docs.google.com/spreadsheets/d/1QajsUci9L_a4HABS5c4qZ6Mu0-9zoBV9I8zxqGYllhk/export?format=csv&gid=865667969",
];
const SYNC_API_URL = "https://script.google.com/macros/s/AKfycbzHe8HYEW6wrJtSJ8IEAbqqNjh_h7OGxKXAwdoUHunj67XFXP8k-YNAoa1dwsoF1oo9/exec";
const SYNC_API_TOKEN = "";
const IS_CHROME_EXTENSION = Boolean(globalThis.chrome?.runtime?.id);
const DEFAULT_BREAK_MINUTES = 60;

const SEED_CSV_LIST = [
  `日付,出勤,退勤,休憩分,勤務時間,休憩中,休憩開始
2026-04-09,10:01,16:11,60,5:10,FALSE,
2026-04-10,09:59,16:08,46,5:23,false,
2026-04-13,11:06,16:03,51,4:06,FALSE,
2026-04-14,10:01,16:21,43,5:37,FALSE,
2026-04-15,13:27,16:17,0,2:50,FALSE,
2026-04-16,10:00,16:07,64,5:03,FALSE,
2026-04-20,10:01,16:07,44,5:22,FALSE,
2026-04-21,10:00,16:05,75,4:50,FALSE,
2026-04-22,10:31,16:21,0,5:50,FALSE,
2026-04-23,10:00,16:47,20,6:27,FALSE,
2026-04-24,10:02,16:43,46,5:55,FALSE,
2026-04-27,13:40,14:32,0,0:52,FALSE,
2026-04-28,13:08,16:00,0,2:52,FALSE,
2026-04-30,15:19,16:00,0,0:41,FALSE,`,
  `日付,出勤,退勤,休憩分,勤務時間
2026-05-01,10:31,16:53,234,2:28
2026-05-07,10:01,16:02,122,3:59
2026-05-08,10:00,16:00,52,5:08
2026-05-11,10:00,16:54,60,5:54
2026-05-12,10:59,16:50,57,4:54
2026-05-13,10:54,16:18,43,4:41
2026-05-14,10:48,16:56,60,5:08
2026-05-15,10:24,16:18,75,4:39
2026-05-18,10:04,16:15,20,5:51
2026-05-19,9:56,16:00,44,5:20
2026-05-20,13:00,17:06,0,4:06
2026-05-21,13:18,17:07,0,3:49
2026-05-22,10:00,17:02,36,6:26
2026-05-25,10:01,15:57,214,2:22
2026-05-26,10:02,14:54,59,3:53
2026-05-27,10:00,,60,`,
];

const STORAGE_KEY = "attendance-note-records";
const MIGRATION_KEY = "attendance-note-migrated-to-sheet";
const state = {
  records: [],
  activeMonth: (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  })(),
  query: "",
  syncStatus: SYNC_API_URL ? "同期中" : "端末内保存",
};

const els = {
  body: document.querySelector("#attendance-body"),
  rowTemplate: document.querySelector("#row-template"),
  activeMonth: document.querySelector("#active-month"),
  brandMonth: document.querySelector("#brand-month"),
  workDays: document.querySelector("#work-days"),
  totalHours: document.querySelector("#total-hours"),
  averageHours: document.querySelector("#average-hours"),
  totalBreak: document.querySelector("#total-break"),
  todayStatus: document.querySelector("#today-status"),
  longestDay: document.querySelector("#longest-day"),
  openCount: document.querySelector("#open-count"),
  search: document.querySelector("#search"),
  syncStatus: document.querySelector("#sync-status"),
  checkoutStart: document.querySelector("#checkout-start"),
  checkoutBreak: document.querySelector("#checkout-break"),
};

function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).map((line) => line.split(","));
  return rows.slice(1).map(([date, start, end, breakMinutes, , breakActive, breakStart]) => normalizeRecord({
    id: crypto.randomUUID(),
    date: date || "",
    start: normalizeTime(start),
    end: normalizeTime(end),
    breakMinutes: Number.parseInt(breakMinutes || "0", 10) || 0,
    breakActive: String(breakActive || "").toLowerCase() === "true",
    breakStart: normalizeTime(breakStart),
  }));
}

function mergeRecords(records) {
  const existingDates = new Set(state.records.map((record) => record.date));
  for (const record of records) {
    if (!record.date || existingDates.has(record.date)) continue;
    state.records.push(record);
    existingDates.add(record.date);
  }
}

function replaceRecords(records) {
  state.records = records.map(normalizeRecord).sort((a, b) => a.date.localeCompare(b.date));
}

function upsertRecords(records) {
  const recordByDate = new Map(state.records.map((record) => [record.date, record]));
  for (const record of records.map(normalizeRecord)) {
    if (!record.date) continue;
    const existing = recordByDate.get(record.date);
    if (existing) {
      Object.assign(existing, record, { id: existing.id });
    } else {
      state.records.push(record);
      recordByDate.set(record.date, record);
    }
  }
  state.records.sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeRecord(record) {
  return {
    id: record.id || crypto.randomUUID(),
    date: record.date || "",
    start: normalizeTime(record.start),
    end: normalizeTime(record.end),
    breakMinutes: Number.parseInt(record.breakMinutes || "0", 10) || 0,
    breakActive: Boolean(record.breakActive),
    breakStart: normalizeTime(record.breakStart),
  };
}

function normalizeTime(value) {
  if (!value) return "";
  const [hour, minute = "00"] = value.split(":");
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function toMinutes(time) {
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function workedMinutes(record) {
  const start = toMinutes(record.start);
  const end = toMinutes(record.end);
  if (start === null || end === null) return 0;
  return Math.max(end - start - record.breakMinutes, 0);
}

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}:${String(rest).padStart(2, "0")}`;
}

function formatMonth(month) {
  const [year, monthNumber] = month.split("-");
  return `${year}年${Number(monthNumber)}月`;
}

function statusFor(record) {
  if (!record.start && !record.end) return { text: "未入力", className: "empty" };
  if (record.breakActive) return { text: "休憩中", className: "break" };
  if (record.start && !record.end) return { text: "勤務中", className: "open" };
  return { text: "完了", className: "" };
}

function monthRecords() {
  return state.records
    .filter((record) => record.date.startsWith(state.activeMonth))
    .filter((record) => record.date.includes(state.query))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function dateRecords(records, date) {
  return records.filter((record) => record.date === date);
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
}

function setSyncStatus(message) {
  state.syncStatus = message;
  if (els.syncStatus) els.syncStatus.textContent = message;
}

function apiUrl(params = {}) {
  const url = new URL(SYNC_API_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  if (SYNC_API_TOKEN) url.searchParams.set("token", SYNC_API_TOKEN);
  return url.toString();
}

function loadJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `attendanceSync${Date.now()}${Math.round(Math.random() * 10000)}`;
    const script = document.createElement("script");
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("同期データの読み込みが時間切れです"));
    }, 8000);
    const cleanup = () => {
      clearTimeout(timeoutId);
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("同期データを読み込めませんでした"));
    };

    const jsonpUrl = new URL(url);
    jsonpUrl.searchParams.set("callback", callbackName);
    script.src = jsonpUrl.toString();
    document.head.append(script);
  });
}

async function loadRemoteRecords() {
  if (!SYNC_API_URL) return false;
  setSyncStatus("同期中");
  try {
    let payload;
    if (IS_CHROME_EXTENSION) {
      try {
        payload = await extensionRequest({ type: "attendance:list" });
      } catch (error) {
        console.warn("Extension sync failed. Falling back to JSONP.", error);
      }
    }

    if (!payload) {
      payload = await loadJsonp(apiUrl({ action: "list" }));
    }

    if (!payload.ok) throw new Error(payload.error || "同期に失敗しました");
    upsertRecords(payload.records || []);
    save();
    setSyncStatus("同期済み");
    return true;
  } catch {
    setSyncStatus("同期失敗");
    return false;
  }
}

function extensionRequest(message) {
  return chrome.runtime.sendMessage(message);
}

function postSync(payload) {
  if (!SYNC_API_URL) return;
  setSyncStatus("保存中");
  if (IS_CHROME_EXTENSION) {
    extensionRequest({ type: "attendance:post", payload })
      .then((response) => setSyncStatus(response?.ok === false ? "保存失敗" : "保存済み"))
      .catch(() => setSyncStatus("保存失敗"));
    return;
  }

  fetch(apiUrl(), {
    method: "POST",
    mode: "no-cors",
    body: JSON.stringify({ ...payload, token: SYNC_API_TOKEN }),
  })
    .then(() => setSyncStatus("保存済み"))
    .catch(() => setSyncStatus("保存失敗"));
}

function migrateLocalRecords(savedRecords) {
  if (!SYNC_API_URL || localStorage.getItem(MIGRATION_KEY) || !savedRecords.length) return;
  setSyncStatus("過去データ反映中");

  for (const record of savedRecords.map(normalizeRecord)) {
    if (record.date) postSync({ action: "upsert", record });
  }

  localStorage.setItem(MIGRATION_KEY, "true");
  setSyncStatus("過去データ反映済み");
}

function saveRecord(record) {
  save();
  postSync({ action: "upsert", record });
}

function deleteRecord(record) {
  save();
  postSync({ action: "delete", date: record.date });
}

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function ensureTodayRecord() {
  const date = todayDate();
  let record = state.records.find((item) => item.date === date);
  if (!record) {
    record = normalizeRecord({
      id: crypto.randomUUID(),
      date,
      start: "",
      end: "",
      breakMinutes: 0,
      breakActive: false,
      breakStart: "",
    });
    state.records.push(record);
  }
  state.activeMonth = date.slice(0, 7);
  return record;
}

function minutesBetween(startTime, endTime) {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === null || end === null) return 0;
  return Math.max(end - start, 0);
}

function checkoutBreakMinutes() {
  return Number.parseInt(els.checkoutBreak.value || String(DEFAULT_BREAK_MINUTES), 10) || 0;
}

function finishBreak(record, endTime) {
  if (!record.breakActive || !record.breakStart) return;
  record.breakMinutes += minutesBetween(record.breakStart, endTime);
  record.breakActive = false;
  record.breakStart = "";
}

function punchStart() {
  const record = ensureTodayRecord();
  const checkoutStart = normalizeTime(els.checkoutStart.value);
  if (!record.start) record.start = checkoutStart || currentTime();
  if (record.end) record.end = "";
  saveRecord(record);
  render();
}

function punchBreakStart() {
  const record = ensureTodayRecord();
  if (!record.start || record.end || record.breakActive) return;
  record.breakActive = true;
  record.breakStart = currentTime();
  saveRecord(record);
  render();
}

function punchBreakEnd() {
  const record = ensureTodayRecord();
  finishBreak(record, currentTime());
  saveRecord(record);
  render();
}

function punchEnd() {
  const record = ensureTodayRecord();
  if (record.end) return;

  const checkoutStart = normalizeTime(els.checkoutStart.value);
  if (checkoutStart) record.start = checkoutStart;
  if (!record.start) {
    setSyncStatus("出勤時刻を入力してください");
    els.checkoutStart.focus();
    return;
  }

  const endTime = currentTime();
  const wasBreakActive = record.breakActive;
  finishBreak(record, endTime);
  if (!wasBreakActive) record.breakMinutes = checkoutBreakMinutes();
  record.end = endTime;
  saveRecord(record);
  render();
}

function render() {
  els.activeMonth.textContent = formatMonth(state.activeMonth);
  els.brandMonth.textContent = formatMonth(state.activeMonth);
  els.body.innerHTML = "";

  for (const record of monthRecords()) {
    const row = els.rowTemplate.content.firstElementChild.cloneNode(true);
    const dateInput = row.querySelector(".date-input");
    const startInput = row.querySelector(".start-input");
    const endInput = row.querySelector(".end-input");
    const breakInput = row.querySelector(".break-input");
    const workedCell = row.querySelector(".worked-cell");
    const pill = row.querySelector(".status-pill");

    dateInput.value = record.date;
    startInput.value = record.start;
    endInput.value = record.end;
    breakInput.value = record.breakMinutes;
    workedCell.textContent = formatMinutes(workedMinutes(record));

    const status = statusFor(record);
    pill.textContent = status.text;
    pill.className = `status-pill ${status.className}`.trim();

    for (const input of [dateInput, startInput, endInput, breakInput]) {
      input.addEventListener("change", () => {
        record.date = dateInput.value;
        record.start = startInput.value;
        record.end = endInput.value;
        record.breakMinutes = Number.parseInt(breakInput.value || "0", 10) || 0;
        if (record.end) {
          record.breakActive = false;
          record.breakStart = "";
        }
        saveRecord(record);
        render();
      });
    }

    row.querySelector(".delete-row").addEventListener("click", () => {
      if (!confirm(`${record.date || "この行"}の勤怠を削除しますか？`)) return;
      state.records = state.records.filter((item) => item.id !== record.id);
      deleteRecord(record);
      render();
    });

    els.body.append(row);
  }

  renderSummary();
  renderPunchPanel();
  setSyncStatus(state.syncStatus);
}

function renderSummary() {
  const records = state.records.filter((record) => record.date.startsWith(state.activeMonth));
  const completed = records.filter((record) => workedMinutes(record) > 0);
  const totalWorked = completed.reduce((sum, record) => sum + workedMinutes(record), 0);
  const totalBreak = records.reduce((sum, record) => sum + record.breakMinutes, 0);
  const open = records.filter((record) => record.start && !record.end);
  const longest = completed.reduce((best, record) => (workedMinutes(record) > workedMinutes(best) ? record : best), completed[0]);
  const today = new Date().toISOString().slice(0, 10);
  const todayRecord = state.records.find((record) => record.date === today);

  els.workDays.textContent = `${completed.length}日`;
  els.totalHours.textContent = formatMinutes(totalWorked);
  els.averageHours.textContent = completed.length ? formatMinutes(Math.round(totalWorked / completed.length)) : "0:00";
  els.totalBreak.textContent = `${totalBreak}分`;
  els.openCount.textContent = `${open.length}件`;
  els.longestDay.textContent = longest ? `${longest.date} ${formatMinutes(workedMinutes(longest))}` : "-";
  els.todayStatus.textContent = todayRecord ? statusFor(todayRecord).text : "未入力";
}

function renderPunchPanel() {
  const date = todayDate();
  const record = state.records.find((item) => item.date === date);
  const status = record ? statusFor(record) : { text: "未入力" };
  const detailParts = [];

  if (record?.start) detailParts.push(`出勤 ${record.start}`);
  if (record?.breakActive && record.breakStart) detailParts.push(`休憩開始 ${record.breakStart}`);
  if (record?.breakMinutes) detailParts.push(`休憩 ${record.breakMinutes}分`);
  if (record?.end) detailParts.push(`退勤 ${record.end}`);

  document.querySelector("#punch-date").textContent = date;
  document.querySelector("#punch-detail").textContent = detailParts.length ? `${status.text} / ${detailParts.join(" / ")}` : "未入力";

  if (document.activeElement !== els.checkoutStart) {
    els.checkoutStart.value = record?.start || els.checkoutStart.value || "";
  }
  if (document.activeElement !== els.checkoutBreak) {
    els.checkoutBreak.value = String(record?.breakMinutes || DEFAULT_BREAK_MINUTES);
  }

  document.querySelector("#punch-start").disabled = Boolean(record?.start && !record?.end);
  document.querySelector("#break-start").disabled = !record?.start || Boolean(record?.end) || Boolean(record?.breakActive);
  document.querySelector("#break-end").disabled = !record?.breakActive;
  document.querySelector("#punch-end").disabled = Boolean(record?.end);
}

function changeMonth(delta) {
  const [year, month] = state.activeMonth.split("-").map(Number);
  const next = new Date(year, month - 1 + delta, 1);
  state.activeMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  render();
}

function addRow() {
  const date = `${state.activeMonth}-${String(new Date().getDate()).padStart(2, "0")}`;
  state.records.push({
    id: crypto.randomUUID(),
    date,
    start: "",
    end: "",
    breakMinutes: 60,
    breakActive: false,
    breakStart: "",
  });
  saveRecord(state.records[state.records.length - 1]);
  render();
}

function toCsv() {
  const lines = ["日付,出勤,退勤,休憩分,勤務時間,休憩中,休憩開始"];
  for (const record of state.records.sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push([
      record.date,
      record.start,
      record.end,
      record.breakMinutes,
      formatMinutes(workedMinutes(record)),
      record.breakActive,
      record.breakStart,
    ].join(","));
  }
  return lines.join("\n");
}

function downloadCsv() {
  const blob = new Blob([toCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `attendance-${state.activeMonth}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importFile(file) {
  const text = await file.text();
  state.records = parseCsv(text);
  state.activeMonth = state.records[0]?.date.slice(0, 7) || state.activeMonth;
  save();
  for (const record of state.records) postSync({ action: "upsert", record });
  render();
}

async function loadInitialData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const savedRecords = saved ? JSON.parse(saved).map(normalizeRecord) : [];
  migrateLocalRecords(savedRecords);

  if (saved) {
    state.records = savedRecords;
  } else {
    state.records = SEED_CSV_LIST.flatMap(parseCsv);
  }

  mergeRecords(SEED_CSV_LIST.flatMap(parseCsv));
  save();
  render();

  const remoteLoaded = await loadRemoteRecords();
  if (remoteLoaded) {
    render();
    return;
  }

  for (const url of SHEET_CSV_URLS) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const text = await response.text();
      mergeRecords(parseCsv(text));
      save();
      render();
    } catch {
      save();
    }
  }
}

document.querySelector("#prev-month").addEventListener("click", () => changeMonth(-1));
document.querySelector("#next-month").addEventListener("click", () => changeMonth(1));
document.querySelector("#add-row").addEventListener("click", addRow);
document.querySelector("#punch-start").addEventListener("click", punchStart);
document.querySelector("#break-start").addEventListener("click", punchBreakStart);
document.querySelector("#break-end").addEventListener("click", punchBreakEnd);
document.querySelector("#punch-end").addEventListener("click", punchEnd);
document.querySelector("#download-csv").addEventListener("click", downloadCsv);
document.querySelector("#csv-input").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) importFile(file);
});
els.search.addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  render();
});

loadInitialData();
