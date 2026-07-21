const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const DB_ENGINE = process.env.DB_ENGINE || 'sqlite';

let pgPool;
let sqliteDb;

if (DB_ENGINE === 'postgres') {
  console.log('Using PostgreSQL connection strategy');
  pgPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'app_db',
    user: process.env.DB_USER || 'postgres_app_user',
    password: process.env.DB_PASSWORD || 'SuperSecurePassw0rd!',
    max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  });
} else {
  console.log('Using SQLite database: ' + (process.env.DATABASE_FILE || './unity_mall.db'));
  sqliteDb = new sqlite3.Database(process.env.DATABASE_FILE || './unity_mall.db');
}

function translateSql(sql) {
  if (DB_ENGINE !== 'postgres') return sql;
  let translated = sql;

  // Translate types/syntax for Postgres table creation
  translated = translated.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
  translated = translated.replace(/\bDATETIME\b/gi, 'TIMESTAMP');
  translated = translated.replace(/\bREAL\b/gi, 'NUMERIC');

  // Replace SQLite GROUP_CONCAT with Postgres string_agg
  translated = translated.replace(/GROUP_CONCAT\(([^)]+)\)/gi, "string_agg($1, ',')");

  // Translate ? to $1, $2, etc.
  let index = 1;
  translated = translated.replace(/\?/g, () => `$${index++}`);

  return translated;
}

const db = {
  run(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    if (DB_ENGINE === 'postgres') {
      let translated = translateSql(sql);
      const isInsert = /^\s*INSERT\s+INTO/i.test(translated);
      if (isInsert && !/RETURNING\s+/i.test(translated)) {
        translated += ' RETURNING id';
      }

      pgPool.query(translated, params || [], (err, res) => {
        if (err) {
          if (callback) callback(err);
          return;
        }
        const context = {
          lastID: isInsert && res.rows && res.rows[0] ? res.rows[0].id : null,
          changes: res.rowCount
        };
        if (callback) {
          callback.call(context, null);
        }
      });
    } else {
      sqliteDb.run(sql, params || [], function(err) {
        if (callback) {
          callback.call(this, err);
        }
      });
    }
  },

  get(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    if (DB_ENGINE === 'postgres') {
      const translated = translateSql(sql);
      pgPool.query(translated, params || [], (err, res) => {
        if (err) {
          if (callback) callback(err, null);
          return;
        }
        if (callback) {
          callback(null, res.rows && res.rows[0] ? res.rows[0] : null);
        }
      });
    } else {
      sqliteDb.get(sql, params || [], (err, row) => {
        if (callback) callback(err, row);
      });
    }
  },

  all(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    if (DB_ENGINE === 'postgres') {
      const translated = translateSql(sql);
      pgPool.query(translated, params || [], (err, res) => {
        if (err) {
          if (callback) callback(err, null);
          return;
        }
        if (callback) {
          callback(null, res.rows || []);
        }
      });
    } else {
      sqliteDb.all(sql, params || [], (err, rows) => {
        if (callback) callback(err, rows);
      });
    }
  },

  serialize(callback) {
    if (DB_ENGINE === 'postgres') {
      callback();
    } else {
      sqliteDb.serialize(callback);
    }
  },

  close(callback) {
    if (DB_ENGINE === 'postgres') {
      pgPool.end(callback);
    } else {
      sqliteDb.close(callback);
    }
  }
};

module.exports = db;
