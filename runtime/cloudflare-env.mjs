import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const db = new DatabaseSync(process.env.CLIMA_SQLITE_PATH, { readOnly: true });
db.exec('PRAGMA busy_timeout=10000; PRAGMA query_only=ON;');
const vars = {};
for (const line of readFileSync(process.env.CLIMA_SECRETS_FILE, 'utf8').split('\n')) {
  const match = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match) vars[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, '$2');
}
delete vars.ECOWITT_LOCAL_ARCHIVE_TOKEN;
export const env = { ...vars, WEATHER_HISTORY_READ_ONLY: 'true', DB: {
  prepare(sql) {
    const statement = db.prepare(sql);let bindings = [];
    return {
      bind(...args) { bindings = args; return this; },
      async first(column) { const row = statement.get(...bindings); return row ? (column ? row[column] : row) : null; },
      async all() { return { success: true, results: statement.all(...bindings), meta: {} }; },
      async raw() { statement.setReturnArrays(true); return statement.all(...bindings); },
      async run() { throw new Error('CLIMA2_DATABASE_READ_ONLY'); },
    };
  },
} };
