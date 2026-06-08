import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  IDBFactory as FakeIDBFactory,
  IDBKeyRange as FakeIDBKeyRange,
} from 'fake-indexeddb';
import {
  cleanupInactiveConversationDbs,
  EegAiConversationDb,
  getConversationDbName,
  type ConversationMetaV1,
} from '../src/ai/indexedDb';
import {
  AI_SCHEMA_VERSION,
  type BandFeatureFrameV1,
  type SiteBindingV1,
} from '../src/ai/protocol';
import { createStoredZip, readStoredZip } from '../src/ai/zipBundle';

const ACTIVE_STORE_NAMES = ['bandFeatureFrames', 'conversationMeta'] as const;
const BUNDLE_FILE_NAMES = [
  'manifest.json',
  'bandFeatureFrames.jsonl',
  'conversationMeta.json',
] as const;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function binding(conversationId: string): SiteBindingV1 {
  return {
    schemaVersion: AI_SCHEMA_VERSION,
    conversationId,
    bindingId: 'binding-ch0-default',
    channelName: 'ch0',
    siteName: 'Cz',
    placementSystem: '10-20',
    createdAtMs: 1,
  };
}

function meta(conversationId: string): ConversationMetaV1 {
  const siteBinding = binding(conversationId);
  return {
    schemaVersion: AI_SCHEMA_VERSION,
    conversationId,
    createdAtMs: 1,
    closedAtMs: null,
    readOnly: false,
    binding: siteBinding,
    bindings: [siteBinding],
  };
}

function frame(conversationId: string, windowEndMs: number): BandFeatureFrameV1 {
  return {
    schemaVersion: AI_SCHEMA_VERSION,
    conversationId,
    bindingId: 'binding-ch0-default',
    channelName: 'ch0',
    siteName: 'Cz',
    placementSystem: '10-20',
    windowStartMs: Math.max(0, windowEndMs - 1_000),
    windowEndMs,
    streamTimeSeconds: windowEndMs / 1_000,
    sampleIndex: windowEndMs,
    deltaPower: 1,
    thetaPower: 2,
    alphaPower: 3,
    betaPower: 4,
    gammaPower: 5,
    fftSize: 512,
    filterId: 'high-order-iir',
    filterParams: { hpCutoffHz: 0.5, lpCutoffHz: 45 },
    qualityFlags: [],
    createdAtMs: windowEndMs,
  };
}

async function createLegacyConversationDb(conversationId: string): Promise<void> {
  const request = indexedDB.open(getConversationDbName(conversationId), 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    const frameStore = db.createObjectStore('bandFeatureFrames', {
      keyPath: ['conversationId', 'bindingId', 'windowEndMs'],
    });
    frameStore.createIndex('byConversationTime', ['conversationId', 'windowEndMs']);
    frameStore.createIndex('byBindingTime', ['conversationId', 'bindingId', 'windowEndMs']);
    db.createObjectStore('siteBindings', { keyPath: 'bindingId' });
    db.createObjectStore('agentRuns', { keyPath: 'runId' });
    db.createObjectStore('skillCalls', { keyPath: 'callId' });
    db.createObjectStore('detailLookups', { keyPath: 'lookupId' });
    db.createObjectStore('transformTraces', { keyPath: 'stepId' });
    db.createObjectStore('conversationMeta', { keyPath: 'conversationId' });
  };
  const db = await requestToPromise(request);
  db.close();
}

describe('EEG AI IndexedDB cache', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new FakeIDBFactory());
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('migrates legacy conversation DBs down to frames and session metadata stores only', async () => {
    await createLegacyConversationDb('conversation-legacy');

    const db = await EegAiConversationDb.open('conversation-legacy');
    db.close();

    const reopened = await requestToPromise(
      indexedDB.open(getConversationDbName('conversation-legacy')),
    );
    expect(Array.from(reopened.objectStoreNames).sort()).toEqual(
      [...ACTIVE_STORE_NAMES].sort(),
    );
    reopened.close();
  });

  it('exports only five-band frames, session metadata, and the bundle manifest', async () => {
    const db = await EegAiConversationDb.open('conversation-export');
    await db.putConversationMeta(meta('conversation-export'));
    await db.putBandFeatureFrames([frame('conversation-export', Date.now())], { prune: false });

    const bytes = await db.exportBundle(Date.now());
    const files = readStoredZip(toArrayBuffer(bytes));
    const manifest = JSON.parse(files['manifest.json']);

    expect(Object.keys(files).sort()).toEqual([...BUNDLE_FILE_NAMES].sort());
    expect(manifest.files.sort()).toEqual([...BUNDLE_FILE_NAMES].sort());
    expect(files['agentRuns.jsonl']).toBeUndefined();
    expect(files['skillCalls.jsonl']).toBeUndefined();
    expect(files['detailLookups.jsonl']).toBeUndefined();
    expect(files['transformTraces.jsonl']).toBeUndefined();
    expect(files['siteBindings.json']).toBeUndefined();
    db.close();
  });

  it('restores historical frames without applying the live 10-minute pruning window', async () => {
    const historicalFrame = frame('source-conversation', 1_000);
    const bytes = createStoredZip([
      {
        path: 'manifest.json',
        data: JSON.stringify({
          schemaVersion: AI_SCHEMA_VERSION,
          kind: 'EegAiConversationBundle',
          conversationId: 'source-conversation',
          exportedAtMs: Date.now(),
          retentionMs: 600_000,
          files: [...BUNDLE_FILE_NAMES],
        }),
      },
      { path: 'bandFeatureFrames.jsonl', data: `${JSON.stringify(historicalFrame)}\n` },
      {
        path: 'conversationMeta.json',
        data: JSON.stringify(meta('source-conversation')),
      },
    ]);

    const db = await EegAiConversationDb.open('restored-conversation');
    await db.restoreBundle(toArrayBuffer(bytes));

    expect(await db.countFrames()).toBe(1);
    await expect(
      db.getBandFeatureFrames({
        startMs: 0,
        endMs: 2_000,
        bindingId: 'binding-ch0-default',
      }),
    ).resolves.toHaveLength(1);
    await expect(db.getConversationMeta()).resolves.toMatchObject({
      conversationId: 'restored-conversation',
      readOnly: true,
      binding: {
        conversationId: 'restored-conversation',
        siteName: 'Cz',
      },
    });
    db.close();
  });

  it('deletes inactive conversation databases while preserving the active one', async () => {
    const active = await EegAiConversationDb.open('active-conversation');
    const inactive = await EegAiConversationDb.open('inactive-conversation');
    active.close();
    inactive.close();

    const result = await cleanupInactiveConversationDbs('active-conversation');
    const databaseNames = await (
      indexedDB as IDBFactory & { databases: () => Promise<Array<{ name?: string | null }>> }
    ).databases();

    expect(result.failed).toEqual([]);
    expect(result.deleted).toEqual(['inactive-conversation']);
    expect(databaseNames.map((database) => database.name).sort()).toEqual([
      getConversationDbName('active-conversation'),
    ]);
  });
});
