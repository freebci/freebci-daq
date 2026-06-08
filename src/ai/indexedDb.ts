import {
  AI_SCHEMA_VERSION,
  type BandFeatureFrameV1,
  type SiteBindingV1,
  validateBandFeatureFrame,
  validateSiteBinding,
} from './protocol';
import { createStoredZip, readStoredZip } from './zipBundle';

const DB_VERSION = 2;
const RETENTION_MS = 10 * 60 * 1000;
const CONVERSATION_DB_PREFIX = 'eeg-ai-conversation-';

const STORE_FRAMES = 'bandFeatureFrames';
const STORE_META = 'conversationMeta';
const ACTIVE_STORES = [STORE_FRAMES, STORE_META] as const;
const LEGACY_STORES = [
  'siteBindings',
  'agentRuns',
  'skillCalls',
  'detailLookups',
  'transformTraces',
] as const;

const FILE_MANIFEST = 'manifest.json';
const FILE_FRAMES = 'bandFeatureFrames.jsonl';
const FILE_META = 'conversationMeta.json';
const BUNDLE_FILES = [FILE_MANIFEST, FILE_FRAMES, FILE_META] as const;

export interface ConversationMetaV1 {
  schemaVersion: typeof AI_SCHEMA_VERSION;
  conversationId: string;
  createdAtMs: number;
  closedAtMs: number | null;
  readOnly: boolean;
  binding: SiteBindingV1;
  bindings: SiteBindingV1[];
}

export interface EegAiBundleManifestV1 {
  schemaVersion: typeof AI_SCHEMA_VERSION;
  kind: 'EegAiConversationBundle';
  conversationId: string;
  exportedAtMs: number;
  retentionMs: number;
  files: string[];
}

function requireIndexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available in this browser.');
  }
  return indexedDB;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function collectCursor<T>(request: IDBRequest<IDBCursorWithValue | null>): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const out: T[] = [];
    request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed.'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(out);
        return;
      }
      out.push(cursor.value as T);
      cursor.continue();
    };
  });
}

function stringifyJsonl(items: readonly unknown[]): string {
  return items.map((item) => JSON.stringify(item)).join('\n') + (items.length > 0 ? '\n' : '');
}

function parseJsonl(text: string | undefined): unknown[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value;
}

function readInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }
  return value;
}

function readNullableInteger(value: unknown, name: string): number | null {
  if (value === null) return null;
  return readInteger(value, name);
}

function readBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean.`);
  }
  return value;
}

function rehomeBinding(binding: SiteBindingV1, conversationId: string): SiteBindingV1 {
  return validateSiteBinding({ ...binding, conversationId });
}

function validateConversationMeta(input: ConversationMetaV1): ConversationMetaV1 {
  if (input.schemaVersion !== AI_SCHEMA_VERSION) {
    throw new Error(`conversationMeta.schemaVersion must be ${AI_SCHEMA_VERSION}.`);
  }
  const inputBindings = Array.isArray(input.bindings) ? input.bindings : [];
  const bindings = (inputBindings.length > 0 ? inputBindings : [input.binding]).map((binding) =>
    rehomeBinding(binding, input.conversationId),
  );
  return {
    schemaVersion: AI_SCHEMA_VERSION,
    conversationId: input.conversationId,
    createdAtMs: readInteger(input.createdAtMs, 'conversationMeta.createdAtMs'),
    closedAtMs: readNullableInteger(input.closedAtMs, 'conversationMeta.closedAtMs'),
    readOnly: readBoolean(input.readOnly, 'conversationMeta.readOnly'),
    binding: rehomeBinding(input.binding, input.conversationId),
    bindings,
  };
}

function parseConversationMeta(text: string | undefined, conversationId: string): ConversationMetaV1 {
  const parsed = JSON.parse(text ?? 'null');
  const raw = readRecord(Array.isArray(parsed) ? parsed[0] : parsed, FILE_META);
  const binding = validateSiteBinding({
    ...readRecord(raw.binding, 'conversationMeta.binding'),
    conversationId,
  });
  const rawBindings = Array.isArray(raw.bindings) ? raw.bindings : [raw.binding];
  const bindings = rawBindings.map((item) =>
    validateSiteBinding({
      ...readRecord(item, 'conversationMeta.bindings[]'),
      conversationId,
    }),
  );
  return validateConversationMeta({
    schemaVersion: AI_SCHEMA_VERSION,
    conversationId,
    createdAtMs: readInteger(raw.createdAtMs, 'conversationMeta.createdAtMs'),
    closedAtMs: readNullableInteger(raw.closedAtMs, 'conversationMeta.closedAtMs'),
    readOnly: true,
    binding,
    bindings,
  });
}

function parseBundle(bytes: ArrayBuffer): {
  files: Record<string, string>;
  manifest: EegAiBundleManifestV1;
} {
  const files = readStoredZip(bytes);
  const manifest = JSON.parse(files[FILE_MANIFEST] ?? '{}') as EegAiBundleManifestV1;
  if (
    manifest.schemaVersion !== AI_SCHEMA_VERSION ||
    manifest.kind !== 'EegAiConversationBundle'
  ) {
    throw new Error('Unsupported EEG AI bundle.');
  }
  return { files, manifest };
}

export function getConversationDbName(conversationId: string): string {
  return `${CONVERSATION_DB_PREFIX}${conversationId}`;
}

function getConversationIdFromDbName(dbName: string): string | null {
  return dbName.startsWith(CONVERSATION_DB_PREFIX)
    ? dbName.slice(CONVERSATION_DB_PREFIX.length)
    : null;
}

export function validateEegAiBundle(bytes: ArrayBuffer): void {
  parseBundle(bytes);
}

export async function listConversationDbNames(): Promise<string[]> {
  const factory = requireIndexedDb() as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string | null }>>;
  };
  if (!factory.databases) return [];
  const databases = await factory.databases();
  return databases
    .map((database) => database.name)
    .filter((name): name is string => typeof name === 'string')
    .filter((name) => getConversationIdFromDbName(name) !== null);
}

export async function deleteConversationDb(conversationId: string): Promise<void> {
  const request = requireIndexedDb().deleteDatabase(getConversationDbName(conversationId));
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed.'));
    request.onblocked = () =>
      reject(new Error(`IndexedDB delete blocked for conversation ${conversationId}.`));
  });
}

export async function cleanupInactiveConversationDbs(activeConversationId: string): Promise<{
  deleted: string[];
  failed: Array<{ conversationId: string; error: unknown }>;
}> {
  const deleted: string[] = [];
  const failed: Array<{ conversationId: string; error: unknown }> = [];
  const conversationIds = (await listConversationDbNames())
    .map(getConversationIdFromDbName)
    .filter((conversationId): conversationId is string =>
      Boolean(conversationId && conversationId !== activeConversationId),
    );

  for (const conversationId of conversationIds) {
    try {
      await deleteConversationDb(conversationId);
      deleted.push(conversationId);
    } catch (error) {
      failed.push({ conversationId, error });
    }
  }

  return { deleted, failed };
}

export class EegAiConversationDb {
  private constructor(
    readonly conversationId: string,
    private db: IDBDatabase,
  ) {}

  get name(): string {
    return this.db.name;
  }

  static async open(conversationId: string): Promise<EegAiConversationDb> {
    const request = requireIndexedDb().open(getConversationDbName(conversationId), DB_VERSION);
    request.onupgradeneeded = () => migrateConversationDb(request);
    return new EegAiConversationDb(conversationId, await requestToPromise(request));
  }

  close(): void {
    this.db.close();
  }

  async putConversationMeta(meta: ConversationMetaV1): Promise<void> {
    const transaction = this.db.transaction(STORE_META, 'readwrite');
    transaction.objectStore(STORE_META).put(validateConversationMeta(meta));
    await transactionDone(transaction);
  }

  async getConversationMeta(): Promise<ConversationMetaV1 | null> {
    const transaction = this.db.transaction(STORE_META, 'readonly');
    const record = await requestToPromise<ConversationMetaV1 | undefined>(
      transaction.objectStore(STORE_META).get(this.conversationId),
    );
    await transactionDone(transaction);
    return record ? validateConversationMeta(record) : null;
  }

  async putBandFeatureFrames(
    frames: readonly BandFeatureFrameV1[],
    options?: { prune?: boolean },
  ): Promise<void> {
    if (frames.length === 0) return;
    const transaction = this.db.transaction(STORE_FRAMES, 'readwrite');
    const store = transaction.objectStore(STORE_FRAMES);
    for (const frame of frames) {
      store.put(validateBandFeatureFrame(frame));
    }
    await transactionDone(transaction);
    if (options?.prune !== false) {
      await this.prune(Date.now() - RETENTION_MS);
    }
  }

  async prune(cutoffMs: number): Promise<void> {
    if (cutoffMs <= 0) return;
    const transaction = this.db.transaction(STORE_FRAMES, 'readwrite');
    const index = transaction.objectStore(STORE_FRAMES).index('byConversationTime');
    const range = IDBKeyRange.bound(
      [this.conversationId, 0],
      [this.conversationId, cutoffMs],
      false,
      true,
    );

    await new Promise<void>((resolve, reject) => {
      const request = index.openCursor(range);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed.'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
    });
    await transactionDone(transaction);
  }

  async getBandFeatureFrames(input: {
    startMs: number;
    endMs: number;
    bindingId?: string | null;
  }): Promise<BandFeatureFrameV1[]> {
    const hasBinding = Boolean(input.bindingId);
    const transaction = this.db.transaction(STORE_FRAMES, 'readonly');
    const store = transaction.objectStore(STORE_FRAMES);
    const source = hasBinding ? store.index('byBindingTime') : store.index('byConversationTime');
    const lower = hasBinding
      ? [this.conversationId, input.bindingId, input.startMs]
      : [this.conversationId, input.startMs];
    const upper = hasBinding
      ? [this.conversationId, input.bindingId, input.endMs]
      : [this.conversationId, input.endMs];

    const records = await collectCursor<BandFeatureFrameV1>(
      source.openCursor(IDBKeyRange.bound(lower, upper)),
    );
    await transactionDone(transaction);
    return records.map(validateBandFeatureFrame);
  }

  async countFrames(): Promise<number> {
    const transaction = this.db.transaction(STORE_FRAMES, 'readonly');
    const count = await requestToPromise<number>(transaction.objectStore(STORE_FRAMES).count());
    await transactionDone(transaction);
    return count;
  }

  async exportBundle(exportedAtMs = Date.now()): Promise<Uint8Array> {
    await this.prune(exportedAtMs - RETENTION_MS);
    const [frames, meta] = await Promise.all([this.getAllFrames(), this.requireMeta()]);
    const manifest: EegAiBundleManifestV1 = {
      schemaVersion: AI_SCHEMA_VERSION,
      kind: 'EegAiConversationBundle',
      conversationId: this.conversationId,
      exportedAtMs,
      retentionMs: RETENTION_MS,
      files: [...BUNDLE_FILES],
    };

    return createStoredZip([
      { path: FILE_MANIFEST, data: JSON.stringify(manifest, null, 2) },
      { path: FILE_FRAMES, data: stringifyJsonl(frames) },
      { path: FILE_META, data: JSON.stringify(meta, null, 2) },
    ]);
  }

  async restoreBundle(bytes: ArrayBuffer): Promise<void> {
    const { files } = parseBundle(bytes);
    const frames = parseJsonl(files[FILE_FRAMES])
      .map(validateBandFeatureFrame)
      .map((frame) => ({ ...frame, conversationId: this.conversationId }));
    const meta = parseConversationMeta(files[FILE_META], this.conversationId);

    await this.clearActiveStores();
    await this.putBandFeatureFrames(frames, { prune: false });
    await this.putConversationMeta({ ...meta, readOnly: true });
  }

  private async getAllFrames(): Promise<BandFeatureFrameV1[]> {
    const transaction = this.db.transaction(STORE_FRAMES, 'readonly');
    const records = await requestToPromise<BandFeatureFrameV1[]>(
      transaction.objectStore(STORE_FRAMES).getAll(),
    );
    await transactionDone(transaction);
    return records.map(validateBandFeatureFrame);
  }

  private async requireMeta(): Promise<ConversationMetaV1> {
    const meta = await this.getConversationMeta();
    if (!meta) {
      throw new Error('Conversation metadata is missing.');
    }
    return meta;
  }

  private async clearActiveStores(): Promise<void> {
    const transaction = this.db.transaction([...ACTIVE_STORES], 'readwrite');
    for (const storeName of ACTIVE_STORES) {
      transaction.objectStore(storeName).clear();
    }
    await transactionDone(transaction);
  }
}

function migrateConversationDb(request: IDBOpenDBRequest): void {
  const db = request.result;
  for (const storeName of LEGACY_STORES) {
    if (db.objectStoreNames.contains(storeName)) {
      db.deleteObjectStore(storeName);
    }
  }
  ensureFrameStore(request);
  if (!db.objectStoreNames.contains(STORE_META)) {
    db.createObjectStore(STORE_META, { keyPath: 'conversationId' });
  }
}

function ensureFrameStore(request: IDBOpenDBRequest): void {
  const db = request.result;
  const frameStore = db.objectStoreNames.contains(STORE_FRAMES)
    ? request.transaction!.objectStore(STORE_FRAMES)
    : db.createObjectStore(STORE_FRAMES, {
        keyPath: ['conversationId', 'bindingId', 'windowEndMs'],
      });

  if (!frameStore.indexNames.contains('byConversationTime')) {
    frameStore.createIndex('byConversationTime', ['conversationId', 'windowEndMs']);
  }
  if (!frameStore.indexNames.contains('byBindingTime')) {
    frameStore.createIndex('byBindingTime', ['conversationId', 'bindingId', 'windowEndMs']);
  }
}

export { RETENTION_MS as AI_BAND_FEATURE_RETENTION_MS };
