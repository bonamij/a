// Mock Google services for the Apps Script backend (used by server.js; sim.js keeps its own copy): mocks Google services in memory,
// loads gas/*.js as separate scripts in one realm (like Apps Script V8), runs scenarios
// with synthetic data only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const GAS_DIR = process.argv[2];
const ORDER = process.argv[3] || 'alpha';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); }
}

/* ---------- byte helpers ---------- */
const signed = buf => Array.from(buf).map(b => (b > 127 ? b - 256 : b));
const toBuf = v => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map(b => (b < 0 ? b + 256 : b))));
const colToNum = s => [...s].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
const iter = list => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };

/* ---------- Sheets mock ---------- */
class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sheet.get(this.r + i, this.c + j)); out.push(row); } return out; }
  setValues(v) {
    if (v.length !== this.nr || v.some(row => row.length !== this.nc)) throw new Error(`setValues size mismatch ${v.length}x${v[0] && v[0].length} vs ${this.nr}x${this.nc}`);
    v.forEach((row, i) => row.forEach((val, j) => this.sheet.set(this.r + i, this.c + j, val)));
    return this;
  }
  getValue() { return this.sheet.get(this.r, this.c); }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.set(this.r + i, this.c + j, ''); return this; }
  setNumberFormat() { return this; } setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.rows = []; this.writes = 0; }
  get(r, c) { const row = this.rows[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined ? '' : v; }
  set(r, c, v) {
    if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
    while (this.rows.length < r) this.rows.push([]);
    this.rows[r - 1][c - 1] = v; this.writes++;
  }
  getLastRow() { for (let i = this.rows.length; i > 0; i--) if ((this.rows[i - 1] || []).some(v => v !== '' && v !== undefined)) return i; return 0; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      let m = a.match(/^([A-Z]+)(\d+)$/); if (m) return new Range(this, +m[2], colToNum(m[1]), 1, 1);
      m = a.match(/^([A-Z]+):([A-Z]+)$/); if (m) return new Range(this, 1, colToNum(m[1]), Math.max(this.rows.length, 1), colToNum(m[2]) - colToNum(m[1]) + 1);
      throw new Error('unsupported range ' + a);
    }
    if (a < 1 || b < 1 || (c !== undefined && c < 1)) throw new Error(`bad range ${a},${b},${c},${d}`);
    return new Range(this, a, b, c || 1, d || 1);
  }
  appendRow(vals) { const r = this.getLastRow() + 1; vals.forEach((v, j) => this.set(r, j + 1, v)); }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  clear() { this.rows = []; }
  setFrozenRows() {} setFrozenColumns() {}
}

function kstParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour === '24' ? '00' : p.hour, mm: p.minute };
}

function makeEnv(initialA1) {
  const sheets = {}, props = {}, cache = {}, folders = {}, logs = [], fetches = [], mails = [], triggers = [];
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)), getName: () => 'TEST' };
  if (initialA1 !== undefined) { ss.insertSheet('Data').set(1, 1, initialA1); }

  function makeFolder(name) {
    const files = [];
    return {
      name, files,
      createFile(fname, content) { const f = { fname, content: String(content), created: new Date(), trashed: false, getName() { return this.fname; }, getDateCreated() { return this.created; }, getSize() { return this.content.length; }, setTrashed(t) { this.trashed = t; }, getBlob() { const c = this.content; return { getDataAsString: () => c }; } }; files.push(f); return f; },
      getFiles() { return iter(files.filter(f => !f.trashed)); },
      getFilesByName(n) { return iter(files.filter(f => !f.trashed && f.fname === n)); }
    };
  }

  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, setProperties: o => Object.keys(o).forEach(k => { props[k] = String(o[k]); }), deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, text) => signed(crypto.createHash('sha256').update(toBuf(text)).digest()),
      computeHmacSha256Signature: (value, key) => signed(crypto.createHmac('sha256', toBuf(key)).update(toBuf(value)).digest()),
      base64EncodeWebSafe: v => toBuf(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => signed(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: v => ({ getBytes: () => signed(toBuf(v)), getDataAsString: () => toBuf(v).toString('utf8') }),
      getUuid: () => crypto.randomUUID(),
      formatDate: (date, tz, fmt) => { const p = kstParts(date, tz); return fmt.replace('yyyy', p.yyyy).replace('MM', p.MM).replace('dd', p.dd).replace('HH', p.HH).replace('mm', p.mm); },
      sleep() {}
    },
    ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; }, getContent() { return this.text; } }), MimeType: { JSON: 'json' } },
    MimeType: { PLAIN_TEXT: 'text/plain' },
    Logger: { log: m => logs.push(String(m)) },
    DriveApp: {
      getFoldersByName: n => iter(folders[n] ? [folders[n]] : []),
      createFolder: n => (folders[n] = makeFolder(n)),
      getRootFolder: () => ({})
    },
    MailApp: { sendEmail: (to, s, b) => mails.push({ to, s, b }), getRemainingDailyQuota: () => 100 },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }), getScriptTimeZone: () => 'Asia/Seoul' },
    ScriptApp: {
      getProjectTriggers: () => triggers.map(h => ({ getHandlerFunction: () => h })),
      newTrigger: h => { const chain = { timeBased: () => chain, everyDays: () => chain, atHour: () => chain, inTimezone: () => chain, create: () => { triggers.push(h); return {}; } }; return chain; }
    },
    UrlFetchApp: { fetch: (url, opts) => { fetches.push({ url, opts }); return { getResponseCode: () => 200, getContentText: () => '{}' }; }, getRequest: () => ({}) },
    OAuth2: { createService: () => { const s = { setTokenUrl: () => s, setPrivateKey: () => s, setIssuer: () => s, setPropertyStore: () => s, setScope: () => s, hasAccess: () => true, getAccessToken: () => 'tok', getLastError: () => '' }; return s; } }
  };
  vm.createContext(ctx);

  let files = fs.readdirSync(GAS_DIR).filter(f => f.endsWith('.js')).sort();
  if (ORDER === 'reverse') files = files.reverse();
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(GAS_DIR, f), 'utf8'), ctx, { filename: f });

  const env = { ctx, sheets, props, cache, folders, logs, fetches, mails, triggers };
  env.run = code => vm.runInContext(code, ctx);
  env.post = body => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent());
  env.get = () => JSON.parse(ctx.doGet({}).getContent());
  env.v2 = (action, extra) => env.post(Object.assign({ v: 2, clientVersion: 2, action }, extra || {}));
  env.admin = (action, extra) => env.v2(action, Object.assign({ auth: { adminKey: 'test-admin-key-123' } }, extra || {}));
  env.itemRow = (c, id) => env.sheets.Items.rows.find(r => r[0] === c && r[1] === String(id));
  return env;
}

module.exports = { makeEnv };
