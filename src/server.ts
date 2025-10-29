// src/server.ts
import express from 'express';
import path from 'path';
import fs from 'fs';
import tasksRouter from './routes/tasks';
import { createSyncRouter } from './routes/sync';
import { db } from './db/knex';
import { SyncClient } from './services/syncClient';
import { SyncService } from './services/syncService';
import { config } from 'dotenv';
config();

const app = express();

// ensure migrations have run (simple approach)
async function ensureMigrations() {
  const sqlPath = path.join(__dirname, '..', 'migrations', '001_initial.sql');
  if (fs.existsSync(sqlPath)) {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await db.raw(sql);
  }
}

(async () => {
  await ensureMigrations();

  // create syncService instance
  const remoteUrl = process.env.SYNC_REMOTE_URL || '';
  const client = new SyncClient(remoteUrl);
  const syncService = new SyncService(client);

  // routes
  app.use('/api/tasks', tasksRouter);
  app.use('/api/sync', createSyncRouter(syncService));

  // health
  app.get('/health', (req, res) => res.json({ ok: true }));

  const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
})();

export default app;
