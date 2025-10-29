import knex from 'knex';
import path from 'path';
import { config } from 'dotenv';
config();

const dbFile = process.env.SQLITE_FILE || path.join(__dirname, '..', '..', 'data', 'app.db');

export const db = knex({
  client: 'sqlite3',
  connection: {
    filename: dbFile
  },
  useNullAsDefault: true,
  pool: {
    afterCreate: (conn: any, cb: any) => {
      conn.run('PRAGMA foreign_keys = ON', cb);
    }
  }
});
