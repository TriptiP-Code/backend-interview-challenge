// src/services/taskService.ts
import { db } from '../db/knex';
import { v4 as uuidv4 } from 'uuid';

export type SyncStatus = 'pending' | 'synced' | 'error';

export type Task = {
  id: string;
  title: string;
  description?: string | null;
  completed: boolean;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  sync_status: SyncStatus;
  server_id?: string | null;
  last_synced_at?: string | null;
};

const now = () => new Date().toISOString();

function rowToTask(r: any): Task {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    completed: !!r.completed,
    created_at: r.created_at,
    updated_at: r.updated_at,
    is_deleted: !!r.is_deleted,
    sync_status: r.sync_status as SyncStatus,
    server_id: r.server_id ?? null,
    last_synced_at: r.last_synced_at ?? null
  };
}

export async function getAllTasks(): Promise<Task[]> {
  const rows = await db('tasks').where({ is_deleted: 0 }).orderBy('updated_at', 'desc').select('*');
  return rows.map(rowToTask);
}

export async function getTaskById(id: string): Promise<Task | null> {
  const r = await db('tasks').where({ id }).first();
  return r ? rowToTask(r) : null;
}

export async function createTask(input: { title: string; description?: string; completed?: boolean }): Promise<Task> {
  const id = uuidv4();
  const ts = now();
  const row = {
    id,
    title: input.title,
    description: input.description ?? null,
    completed: input.completed ? 1 : 0,
    created_at: ts,
    updated_at: ts,
    is_deleted: 0,
    sync_status: 'pending',
    server_id: null,
    last_synced_at: null
  };

  await db.transaction(async trx => {
    await trx('tasks').insert(row);
    await trx('sync_queue').insert({
      operation_type: 'create',
      task_id: id,
      payload: JSON.stringify(row),
      attempts: 0,
      created_at: ts,
      updated_at: ts
    });
  });

  return getTaskById(id) as Promise<Task>;
}

export async function updateTask(id: string, input: { title?: string; description?: string | null; completed?: boolean }): Promise<Task | null> {
  const t = await getTaskById(id);
  if (!t) return null;
  const ts = now();
  const newRow = {
    title: input.title === undefined ? t.title : input.title,
    description: input.description === undefined ? t.description : input.description,
    completed: input.completed === undefined ? (t.completed ? 1 : 0) : (input.completed ? 1 : 0),
    updated_at: ts,
    sync_status: 'pending'
  };

  await db.transaction(async trx => {
    await trx('tasks').where({ id }).update(newRow);
    const updatedTask = await trx('tasks').where({ id }).first();
    await trx('sync_queue').insert({
      operation_type: 'update',
      task_id: id,
      payload: JSON.stringify(updatedTask),
      attempts: 0,
      created_at: ts,
      updated_at: ts
    });
  });

  return getTaskById(id);
}

export async function softDeleteTask(id: string): Promise<boolean> {
  const t = await getTaskById(id);
  if (!t) return false;
  const ts = now();
  await db.transaction(async trx => {
    await trx('tasks').where({ id }).update({
      is_deleted: 1,
      updated_at: ts,
      sync_status: 'pending'
    });
    const deletedSnapshot = await trx('tasks').where({ id }).first();
    await trx('sync_queue').insert({
      operation_type: 'delete',
      task_id: id,
      payload: JSON.stringify(deletedSnapshot),
      attempts: 0,
      created_at: ts,
      updated_at: ts
    });
  });
  return true;
}

/**
 * Called by syncService after a successful operation on remote
 */
export async function markTaskSynced(id: string, serverId: string | null, lastSyncedAt: string) {
  await db('tasks').where({ id }).update({
    server_id: serverId,
    last_synced_at: lastSyncedAt,
    sync_status: 'synced'
  });
}

/**
 * mark local task sync error
 */
export async function markTaskSyncError(id: string, message?: string) {
  await db('tasks').where({ id }).update({ sync_status: 'error' });
  await db('sync_logs').insert({
    task_id: id,
    log_type: 'error',
    message: message ?? 'Sync failed',
    meta: null,
    created_at: now()
  });
}
