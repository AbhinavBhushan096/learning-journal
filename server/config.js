import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file = path.join(root, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    if (process.env.NODE_ENV === 'test' && ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'OWNER_NAME', 'OWNER_HANDLE', 'AZURE_SQL_SERVER', 'AZURE_SQL_DATABASE', 'AZURE_SQL_USER', 'AZURE_SQL_PASSWORD'].includes(match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
loadEnv();

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';
const adminEmail = process.env.ADMIN_EMAIL || (isProduction ? '' : 'owner@example.com');
const adminPassword = process.env.ADMIN_PASSWORD || (isProduction ? '' : 'learning-journal-dev');

if (isProduction && (!adminEmail || !adminPassword || adminPassword.length < 12)) {
  throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD (minimum 12 characters) are required in production.');
}

export const config = Object.freeze({
  root,
  port: Number(process.env.PORT || 8787),
  isProduction,
  isTest,
  appOrigin: process.env.APP_ORIGIN || (isProduction ? '' : 'http://localhost:8787'),
  databasePath: process.env.DATABASE_PATH || path.join(root, 'data', isTest ? 'test.db' : 'journal.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(root, 'uploads'),
  publicDir: isProduction && fs.existsSync(path.join(root, 'dist', 'public')) ? path.join(root, 'dist', 'public') : path.join(root, 'src'),
  adminEmail,
  adminPassword,
  ownerName: process.env.OWNER_NAME || 'Aryan',
  ownerHandle: process.env.OWNER_HANDLE || 'aryanlearns',
  azureSql: process.env.AZURE_SQL_SERVER && process.env.AZURE_SQL_DATABASE && process.env.AZURE_SQL_USER && process.env.AZURE_SQL_PASSWORD
    ? {
        server: process.env.AZURE_SQL_SERVER,
        database: process.env.AZURE_SQL_DATABASE,
        user: process.env.AZURE_SQL_USER,
        password: process.env.AZURE_SQL_PASSWORD
      }
    : null,
  maxJsonBytes: 1024 * 1024,
  maxUploadBytes: 8 * 1024 * 1024,
  sessionDays: 14
});
