// src/services/syncService.ts
import { db } from '../db/knex';
import { SyncClient, QueueOp, SyncResponseItem } from './syncClient';
import { markTaskSynced, markTaskSyncError } from './taskService';

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50', 10);
const MAX_ATTEMPTS = parseInt(process.env.SYNC_MAX_ATTEMPTS || '3', 10);

const now = () => new Date().toISOString();

export class SyncService {
  client: SyncClient;
  constructor(client: SyncClient) {
    this.client = client;
  }

  async fetchQueue(limit = BATCH_SIZE) {
    return db('sync_queue').orderBy('created_at', 'asc').limit(limit).select('*');
  }

  /**
   * Process a single batch (one call). Returns summary.
   */
  async processOnce() {
    const rows = await this.fetchQueue();
    if (!rows.length) return { processed: 0, details: [] };

    const ops: QueueOp[] = rows.map((r: any) => ({
      queueId: r.id,
      operation_type: r.operation_type,
      task_id: r.task_id,
      payload: JSON.parse(r.payload)
    }));

    let responses: SyncResponseItem[];
    try {
      responses = await this.client.sendBatch(ops);
    } catch (err: any) {
      const ts = now();
      // mark attempts +1 and set next_retry_at to now (can implement backoff)
      const ids = rows.map((r: any) => r.id);
      await db('sync_queue').whereIn('id', ids).update({
        attempts: db.raw('attempts + 1'),
        updated_at: ts,
        next_retry_at: ts
      });
      await db('sync_logs').insert({
        task_id: null,
        log_type: 'error',
        message: `Batch send failed: ${err.message}`,
        meta: JSON.stringify({ stack: err.stack }),
        created_at: ts
      });
      return { processed: 0, error: err.message };
    }

    const summary: any[] = [];

    for (const resp of responses) {
      const row = rows.find((r: any) => r.id === resp.queueId);
      if (!row) continue;
      const queueId = row.id;
      const taskId = row.task_id;
      const payload = JSON.parse(row.payload);

      if (resp.success) {
        // delete queue entry, mark task synced
        await db('sync_queue').where({ id: queueId }).del();
        const lastSyncedAt = resp.updated_at ?? now();
        await markTaskSynced(taskId, resp.server_id ?? null, lastSyncedAt);
        await db('sync_logs').insert({
          task_id: taskId,
          log_type: 'info',
          message: `Synced queue ${queueId} (${row.operation_type})`,
          meta: JSON.stringify({ queueId, op: row.operation_type, server_id: resp.server_id }),
          created_at: now()
        });
        summary.push({ queueId, ok: true });
      } else {
        // item-level failure
        const attempts = row.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          // give up: mark error and remove from queue
          await db('sync_queue').where({ id: queueId }).del();
          await markTaskSyncError(taskId, resp.error ?? 'max attempts reached');
          await db('sync_logs').insert({
            task_id: taskId,
            log_type: 'error',
            message: `Failed to sync queue ${queueId}: ${resp.error ?? 'unknown'}`,
            meta: JSON.stringify(resp),
            created_at: now()
          });
          summary.push({ queueId, ok: false, fatal: true });
        } else {
          // schedule retry
          await db('sync_queue').where({ id: queueId }).update({
            attempts,
            updated_at: now(),
            next_retry_at: now()
          });
          await db('sync_logs').insert({
            task_id: taskId,
            log_type: 'info',
            message: `Retry scheduled for queue ${queueId} (attempt ${attempts})`,
            meta: JSON.stringify(resp),
            created_at: now()
          });
          summary.push({ queueId, ok: false, retry: true });
        }
      }

      // handle conflict if reported
      if (resp.conflict) {
        // last-write-wins between client payload.updated_at and server updated_at
        const clientUpdated = payload.updated_at ? Date.parse(payload.updated_at) : 0;
        const serverUpdated = resp.updated_at ? Date.parse(resp.updated_at) : 0;
        const resolvedWith = clientUpdated >= serverUpdated ? 'client' : 'server';
        await db('sync_logs').insert({
          task_id: taskId,
          log_type: 'conflict',
          message: `Conflict resolved in favor of ${resolvedWith}`,
          meta: JSON.stringify({ clientUpdated: payload.updated_at, serverUpdated: resp.updated_at, resolvedWith }),
          created_at: now()
        });

        if (resolvedWith === 'server' && resp.server_payload) {
          // overwrite local with server_payload
          const sp = resp.server_payload;
          await db('tasks').where({ id: taskId }).update({
            title: sp.title,
            description: sp.description,
            completed: sp.completed ? 1 : 0,
            updated_at: sp.updated_at,
            server_id: sp.server_id ?? null,
            last_synced_at: resp.updated_at,
            sync_status: 'synced'
          });
        } else if (resolvedWith === 'client') {
          // re-enqueue a forced update so server gets client's newer data
          await db('sync_queue').insert({
            operation_type: 'update',
            task_id: taskId,
            payload: JSON.stringify(payload),
            attempts: 0,
            created_at: now(),
            updated_at: now()
          });
        }
      }
    }

    return { processed: responses.length, summary };
  }
}
