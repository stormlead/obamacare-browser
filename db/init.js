const path = require('path');

// Use PostgreSQL if DATABASE_URL is set, otherwise SQLite
// Railway may use different variable names depending on setup
const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL || process.env.POSTGRES_URL;
const usePostgres = !!dbUrl;

let pool = null;
let sqliteDbPath = null;

if (usePostgres) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });
  console.log('Using PostgreSQL database');
} else {
  sqliteDbPath = path.join(__dirname, '..', 'plans.db');
  console.log('Using SQLite database:', sqliteDbPath);
}

// Unified query interface
async function query(sql, params = []) {
  if (usePostgres) {
    // Convert ? placeholders to $1, $2, etc for PostgreSQL
    let paramIndex = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
    const result = await pool.query(pgSql, params);
    return result.rows;
  } else {
    const Database = require('better-sqlite3');
    const db = new Database(sqliteDbPath);
    try {
      const stmt = db.prepare(sql);
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        return stmt.all(...params);
      } else {
        return stmt.run(...params);
      }
    } finally {
      db.close();
    }
  }
}

// For PostgreSQL-specific queries (used in routes that were converted)
function getPool() {
  if (!usePostgres) {
    throw new Error('PostgreSQL pool not available - using SQLite');
  }
  return pool;
}

// For SQLite-specific access (legacy)
function getDatabase() {
  if (usePostgres) {
    throw new Error('SQLite not available - using PostgreSQL');
  }
  const Database = require('better-sqlite3');
  return new Database(sqliteDbPath);
}

function isPostgres() {
  return usePostgres;
}

module.exports = { query, getPool, getDatabase, isPostgres };
