import pg from 'pg';

const DEFAULT_URL = 'postgresql://jeopardy:jeopardy@localhost:5432/jeopardy';
const connectionString = process.env.DATABASE_URL ?? DEFAULT_URL;

function shouldUseSsl(url: string): boolean {
  if (process.env.DATABASE_SSL === 'true') return true;
  if (process.env.DATABASE_SSL === 'false') return false;
  return !url.includes('localhost') && !url.includes('127.0.0.1');
}

export const pool = new pg.Pool({
  connectionString,
  ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

pool.on('error', (err) => {
  console.error('Unexpected pg pool error', err);
});
