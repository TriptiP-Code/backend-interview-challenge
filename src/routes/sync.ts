// src/routes/sync.ts
import express from 'express';
import { SyncService } from '../services/syncService';
import { SyncClient } from '../services/syncClient';
import { db } from '../db/knex';

export function createSyncRouter(syncService: SyncService) {
  const router = express.Router();

  // POST /api/sync/trigger
  router.post('/trigger', async (req, res) => {
    try {
      const result = await syncService.processOnce();
      return res.json({ ok: true, result });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/sync/status
  router.get('/status', async (req, res) => {
    try {
      const row: any = await db('sync_queue').count({ c: '*' }).first();
      const pending = Number(row?.c ?? 0);
      return res.json({ pending });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  // POST /api/sync/batch (explicit batch run)
  router.post('/batch', async (req, res) => {
    try {
      const result = await syncService.processOnce();
      return res.json({ ok: true, result });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
