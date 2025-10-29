// src/services/syncClient.ts
import fetch from 'node-fetch';

export type QueueOp = {
  queueId: number;
  operation_type: 'create' | 'update' | 'delete';
  task_id: string;
  payload: any;
};

export type SyncResponseItem = {
  queueId: number;
  success: boolean;
  server_id?: string | null;
  updated_at?: string;
  conflict?: boolean;
  server_payload?: any;
  error?: string | null;
};

/**
 * Small pluggable client. In tests you can mock sendBatch().
 * If SYNC_REMOTE_URL is empty, sendBatch will simulate success.
 */
export class SyncClient {
  remoteUrl: string;
  constructor(remoteUrl: string) {
    this.remoteUrl = remoteUrl;
  }

  async sendBatch(ops: QueueOp[]): Promise<SyncResponseItem[]> {
    if (!this.remoteUrl) {
      // simulate remote success: server assigns same server_id as payload.server_id if present
      const now = new Date().toISOString();
      return ops.map(op => ({
        queueId: op.queueId,
        success: true,
        server_id: op.payload.server_id ?? null,
        updated_at: now
      }));
    }

    // Example: POST to remote /sync/batch (the remote API contract can be adapted)
    const res = await fetch(`${this.remoteUrl}/sync/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops })
    });

    if (!res.ok) {
      throw new Error(`Remote sync failed: ${res.status} ${res.statusText}`);
    }
    const body = await res.json();
    return body.results as SyncResponseItem[];
  }
}
