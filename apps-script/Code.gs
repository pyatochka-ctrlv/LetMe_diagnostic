/**
 * Острів суперсил → Google Таблиця (аркуш «Проходження») + PDF у папку на Google Диску.
 * Приймає результати з pult.html (POST, text/plain з JSON). Інструкція: docs/GOOGLE_SHEETS.md.
 *
 * Тіло запиту: { token, id, headers: [...], row: [...], fileName, pdf }
 *   token    — спільний секрет; має збігатися з TOKEN нижче й з CONFIG.sheets.token у config.js;
 *   id       — прихований id діагностики (остання колонка); повторне надсилання оновлює рядок, а не дублює;
 *   headers  — назви колонок; row — значення в тому самому порядку;
 *   fileName — «Прізвище Ім'я — дд.мм.рррр.pdf»;
 *   pdf      — PDF звіту в base64 (може бути null, якщо браузер не зміг його згенерувати).
 *
 * PDF зберігається в папку FOLDER_ID. Доступ до файлу успадковується від папки:
 * скрипт НІЧОГО не відкриває публічно й не змінює налаштувань доступу.
 */

const TOKEN = 'ЗАМІНІТЬ-НА-СВІЙ-ДОВГИЙ-ВИПАДКОВИЙ-ТОКЕН';
const FOLDER_ID = 'ВСТАВТЕ-ID-ПАПКИ-ДЛЯ-PDF';
const SHEET_NAME = 'Проходження';
const PDF_HEADER = 'PDF результату';
const ID_HEADER = 'id';
const MAX_CELL = 49000; // ліміт клітинки — 50 000 символів

// кольори рівнів (🟢 3 · 🟡 2 · 🔴 1 · ⚪ не оцінено) — фон клітинок «— результат»
const LEVEL_BG = { '🟢': '#D6F2E1', '🟡': '#FFF1C2', '🔴': '#FDE2E2', '⚪': '#F1F2F6' };

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000); // одночасні надсилання від кількох МІКів записуються по черзі
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!data || data.token !== TOKEN) return json_({ ok: false, error: 'bad token' });
    const headers = data.headers, row = data.row;
    if (!Array.isArray(headers) || !Array.isArray(row) || headers.length !== row.length || !data.id) {
      return json_({ ok: false, error: 'bad payload' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    ensureHeaders_(sheet, headers);

    const idCol = headers.indexOf(ID_HEADER) + 1, pdfCol = headers.indexOf(PDF_HEADER) + 1;
    const target = findRowById_(sheet, idCol, String(data.id));
    const values = row.map(cell_);

    // PDF: якщо надіслано — зберегти в папку (або замінити старий файл цього проходження)
    let link = '';
    if (target && pdfCol) link = String(sheet.getRange(target, pdfCol).getValue() || '');
    if (data.pdf && FOLDER_ID && FOLDER_ID.indexOf('ВСТАВТЕ') !== 0) {
      link = savePdf_(data.pdf, safeName_(data.fileName || (data.id + '.pdf')), link);
    }
    if (pdfCol) values[pdfCol - 1] = link;

    let r = target;
    if (target) sheet.getRange(target, 1, 1, values.length).setValues([values]);
    else { sheet.appendRow(values); r = sheet.getLastRow(); }
    colorRow_(sheet, r, headers, values);

    return json_({ ok: true, updated: !!target, pdf: !!link });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* lock міг і не бути взятий */ }
  }
}

// Перевірка в браузері: відкрийте URL веб-застосунку — має з’явитися {"ok":true,...}
function doGet() {
  return json_({ ok: true, info: 'Острів суперсил: приймаю POST із результатами діагностики.' });
}

// Аркуш і заголовки створюються автоматично; колонка id прихована
function ensureHeaders_(sheet, headers) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const current = sheet.getLastRow() ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const same = current.length >= headers.length && headers.every((h, i) => String(current[i]) === String(h));
  if (same) return;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setWrap(true).setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3); // дата, ім’я, прізвище — завжди видно
  const idCol = headers.indexOf(ID_HEADER) + 1;
  if (idCol) sheet.hideColumns(idCol);
}

function findRowById_(sheet, idCol, id) {
  const last = sheet.getLastRow();
  if (!idCol || last < 2) return 0;
  const ids = sheet.getRange(2, idCol, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

// PDF із base64 → файл у папці FOLDER_ID. Старий файл того самого проходження — у кошик.
function savePdf_(b64, name, oldLink) {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', name);
  const m = /\/d\/([^/]+)/.exec(oldLink || '');
  if (m) { try { DriveApp.getFileById(m[1]).setTrashed(true); } catch (e) { /* файл уже видалено */ } }
  const file = folder.createFile(blob); // доступ успадковується від папки; нічого не відкриваємо публічно
  return file.getUrl();
}

function colorRow_(sheet, r, headers, values) {
  headers.forEach((h, i) => {
    if (!/ — результат$/.test(h)) return;
    const mark = String(values[i] || '').slice(0, 2);
    const bg = LEVEL_BG[mark] || LEVEL_BG[String(values[i] || '').charAt(0)] || null;
    sheet.getRange(r, i + 1).setBackground(bg);
  });
  sheet.getRange(r, 1, 1, headers.length).setWrap(true).setVerticalAlignment('top');
}

function safeName_(s) { return String(s).replace(/[\\/:*?"<>|]/g, ' ').slice(0, 150); }

function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') return v;
  let s = v.length > MAX_CELL ? v.slice(0, MAX_CELL) + '…[обрізано]' : v;
  if (/^[=+\-@]/.test(s)) s = "'" + s; // захист від формул у текстових полях
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
