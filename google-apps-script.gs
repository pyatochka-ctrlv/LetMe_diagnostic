/**
 * Острів суперсил → Google Таблиця
 * Приймає результати діагностики з pult.html (POST, text/plain з JSON) і записує їх у лист.
 * Інструкція з налаштування — GOOGLE_SHEETS.md.
 *
 * Тіло запиту: { token, id, headers: [...], row: [...] }
 *   - token   — спільний секрет, має збігатися з TOKEN нижче й з CONFIG.sheets.token у грі;
 *   - id      — uuid діагностики (перша колонка); повторне надсилання того самого id оновлює рядок;
 *   - headers — назви колонок; row — значення в тому самому порядку.
 */

const TOKEN = 'ЗАМІНІТЬ-НА-СВІЙ-ДОВГИЙ-ВИПАДКОВИЙ-ТОКЕН';
const SHEET_NAME = 'Діагностики';
const MAX_CELL = 49000; // ліміт клітинки Google Таблиць — 50 000 символів

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // одночасні надсилання від кількох вчителів записуються по черзі
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!data || data.token !== TOKEN) return json_({ ok: false, error: 'bad token' });
    const headers = data.headers, row = data.row;
    if (!Array.isArray(headers) || !Array.isArray(row) || headers.length !== row.length || !data.id) {
      return json_({ ok: false, error: 'bad payload' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    ensureHeaders_(sheet, headers);

    // дедуплікація за id (колонка A): є такий рядок — оновити, немає — додати
    const values = row.map(cell_);
    const target = findRowById_(sheet, String(data.id));
    if (target) sheet.getRange(target, 1, 1, values.length).setValues([values]);
    else sheet.appendRow(values);

    return json_({ ok: true, updated: !!target });
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

// Рядок заголовків створюється автоматично; якщо в грі змінився набір колонок — оновлюється
function ensureHeaders_(sheet, headers) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const current = sheet.getLastRow() ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const same = current.length >= headers.length && headers.every((h, i) => String(current[i]) === String(h));
  if (!same) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function findRowById_(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

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
