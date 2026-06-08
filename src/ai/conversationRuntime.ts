import { createBandFeatureFrames } from './bandFeatures';
import {
  AI_SCHEMA_VERSION,
  type BandFeatureFrameV1,
  type SiteBindingV1,
} from './protocol';
import {
  cleanupInactiveConversationDbs,
  deleteConversationDb,
  EegAiConversationDb,
  validateEegAiBundle,
  type ConversationMetaV1,
} from './indexedDb';
import {
  useAiStore,
  createBindingForConversation,
  createNextConversationId,
  pickPrimaryBinding,
  persistActiveAiConversationId,
} from '../store/aiStore';
import type { EegAnalysisResult } from '../types/eeg';

let activeDb: EegAiConversationDb | null = null;
let initializedConversationId: string | null = null;
const activeWriteTasks = new Set<Promise<void>>();
const activeDurableWriteTasks = new Set<Promise<void>>();
const DB_WRITE_DEADLINE_MS = 500;
let startupCleanupStarted = false;

export interface AiConversationBundleExport {
  bytes: Uint8Array;
  fileName: string;
}

function setRuntimeError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  useAiStore.getState().setError(message);
}

function setRuntimeErrorForConversation(conversationId: string, error: unknown): void {
  if (useAiStore.getState().conversationId !== conversationId) return;
  setRuntimeError(error);
}

function timeoutPromise(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => {
    globalThis.setTimeout(() => resolve('timeout'), ms);
  });
}

export async function withWriteDeadline(
  task: Promise<void>,
  deadlineMs = DB_WRITE_DEADLINE_MS,
): Promise<{ timedOut: boolean; durationMs: number; error: unknown | null }> {
  const startedAt = performance.now();
  try {
    const result = await Promise.race([
      task.then(() => 'done' as const),
      timeoutPromise(deadlineMs),
    ]);
    return {
      timedOut: result === 'timeout',
      durationMs: Math.round(performance.now() - startedAt),
      error: null,
    };
  } catch (error) {
    return {
      timedOut: false,
      durationMs: Math.round(performance.now() - startedAt),
      error,
    };
  }
}

function isCurrentConversation(conversationId: string): boolean {
  return useAiStore.getState().conversationId === conversationId;
}

function trackDurableWrite(task: Promise<void>): Promise<void> {
  let trackedTask: Promise<void>;
  trackedTask = task.finally(() => {
    activeDurableWriteTasks.delete(trackedTask);
  });
  activeDurableWriteTasks.add(trackedTask);
  return trackedTask;
}

function trackDeadlineWrite(task: Promise<void>, conversationId: string): void {
  let trackedTask: Promise<void>;
  trackedTask = (async () => {
    useAiStore.getState().recordWriteStart();
    const result = await withWriteDeadline(task);
    useAiStore.getState().recordWriteFinish(result.durationMs, result.timedOut);
    if (result.error) {
      throw result.error;
    }
    if (result.timedOut) {
      void task.catch((error) => setRuntimeErrorForConversation(conversationId, error));
      return;
    }
    await task;
  })()
    .catch((error) => setRuntimeErrorForConversation(conversationId, error))
    .finally(() => {
      activeWriteTasks.delete(trackedTask);
    });
  activeWriteTasks.add(trackedTask);
}

export async function flushAiBandFeatureWrites(input?: { durable?: boolean }): Promise<void> {
  await Promise.allSettled([...activeWriteTasks]);
  if (input?.durable) {
    await Promise.allSettled([...activeDurableWriteTasks]);
  }
}

function formatDataDirectoryLabel(db: EegAiConversationDb): string {
  return `IndexedDB/${db.name}/bandFeatureFrames`;
}

function closeActiveConversation(): void {
  activeDb?.close();
  activeDb = null;
  initializedConversationId = null;
}

async function runStartupCleanup(activeConversationId: string): Promise<void> {
  if (startupCleanupStarted) return;
  startupCleanupStarted = true;
  try {
    const result = await cleanupInactiveConversationDbs(activeConversationId);
    if (result.failed.length > 0) {
      console.warn('Failed to delete inactive EEG AI IndexedDB databases:', result.failed);
    }
  } catch (error) {
    console.warn('Failed to inspect inactive EEG AI IndexedDB databases:', error);
  }
}

async function updateFrameCountForConversation(
  conversationId: string,
  db: EegAiConversationDb,
): Promise<void> {
  const frameCount = await db.countFrames();
  if (isCurrentConversation(conversationId)) {
    useAiStore.getState().setFrameCount(frameCount);
  }
}

async function persistConversationMeta(input: {
  db: EegAiConversationDb;
  conversationId: string;
  binding: SiteBindingV1;
  bindings?: SiteBindingV1[];
  isReadOnly: boolean;
  closedAtMs?: number | null;
}): Promise<void> {
  const current = await input.db.getConversationMeta().catch(() => null);
  const bindings = input.bindings && input.bindings.length > 0 ? input.bindings : [input.binding];
  const meta: ConversationMetaV1 = {
    schemaVersion: AI_SCHEMA_VERSION,
    conversationId: input.conversationId,
    createdAtMs: current?.createdAtMs ?? Date.now(),
    closedAtMs:
      input.closedAtMs === undefined ? current?.closedAtMs ?? null : input.closedAtMs,
    readOnly: input.isReadOnly,
    binding: {
      ...input.binding,
      conversationId: input.conversationId,
    },
    bindings: bindings.map((binding) => ({
      ...binding,
      conversationId: input.conversationId,
    })),
  };
  await input.db.putConversationMeta(meta);
}

async function openConversation(
  conversationId: string,
  binding: SiteBindingV1,
  isReadOnly = false,
  options?: { cleanupInactive?: boolean },
): Promise<EegAiConversationDb> {
  useAiStore.getState().setStatus('opening');
  const db = await EegAiConversationDb.open(conversationId);
  const existingMeta = await db.getConversationMeta().catch(() => null);
  const resolvedBindings = existingMeta?.bindings?.length ? existingMeta.bindings : [binding];
  const resolvedBinding = pickPrimaryBinding(resolvedBindings) ?? existingMeta?.binding ?? binding;
  const resolvedReadOnly = isReadOnly || existingMeta?.readOnly === true;
  await persistConversationMeta({
    db,
    conversationId,
    binding: resolvedBinding,
    bindings: resolvedBindings,
    isReadOnly: resolvedReadOnly,
    closedAtMs: resolvedReadOnly ? existingMeta?.closedAtMs ?? null : null,
  });
  activeDb = db;
  initializedConversationId = conversationId;
  persistActiveAiConversationId(conversationId);
  const frameCount = await db.countFrames();
  useAiStore
    .getState()
    .setConversationReady(conversationId, resolvedBinding, resolvedReadOnly, resolvedBindings);
  useAiStore.getState().setDataDirectoryLabel(formatDataDirectoryLabel(db));
  useAiStore.getState().setFrameCount(frameCount);
  useAiStore.getState().setSiteBindingLocked(resolvedReadOnly || frameCount > 0);
  if (options?.cleanupInactive) {
    void runStartupCleanup(conversationId);
  }
  return db;
}

export async function initializeAiConversation(): Promise<void> {
  const state = useAiStore.getState();
  if (activeDb && initializedConversationId === state.conversationId) return;

  try {
    await openConversation(state.conversationId, state.binding, state.isReadOnly, {
      cleanupInactive: true,
    });
  } catch (error) {
    setRuntimeError(error);
  }
}

export function setAiBandRecordingEnabled(enabled: boolean): void {
  const state = useAiStore.getState();
  if (state.isReadOnly) {
    useAiStore.getState().setRecording(false);
    return;
  }
  useAiStore.getState().setRecording(enabled);
}

export async function updateAiSiteBinding(
  siteName: string,
  placementSystem: string,
  channelName = 'ch0',
): Promise<void> {
  const state = useAiStore.getState();
  const binding = createBindingForConversation(
    state.conversationId,
    siteName,
    placementSystem,
    channelName,
  );
  useAiStore.getState().setBindings([binding]);
  if (!activeDb || state.isReadOnly) return;
  try {
    await persistConversationMeta({
      db: activeDb,
      conversationId: state.conversationId,
      binding,
      bindings: [binding],
      isReadOnly: false,
      closedAtMs: null,
    });
  } catch (error) {
    setRuntimeError(error);
  }
}

export async function updateAiSiteBindings(bindings: SiteBindingV1[]): Promise<void> {
  const state = useAiStore.getState();
  const normalizedBindings =
    bindings.length > 0
      ? bindings.map((binding) => ({
          ...binding,
          conversationId: state.conversationId,
        }))
      : [createBindingForConversation(state.conversationId, 'custom', 'custom')];
  const primaryBinding = pickPrimaryBinding(normalizedBindings) ?? normalizedBindings[0];
  useAiStore.getState().setBindings(normalizedBindings);
  if (!activeDb || state.isReadOnly) return;
  try {
    await persistConversationMeta({
      db: activeDb,
      conversationId: state.conversationId,
      binding: primaryBinding,
      bindings: normalizedBindings,
      isReadOnly: false,
      closedAtMs: null,
    });
  } catch (error) {
    setRuntimeError(error);
  }
}

export async function ensureAiSiteBindingsForChannels(channelNames: string[]): Promise<void> {
  const state = useAiStore.getState();
  const normalizedChannelNames = [...new Set(channelNames.map((name) => name.trim() || 'ch0'))];
  const existingChannelNames = new Set(
    state.bindings.map((binding) => binding.channelName.trim().toLowerCase()),
  );
  const missingChannelNames = normalizedChannelNames.filter(
    (channelName) => !existingChannelNames.has(channelName.toLowerCase()),
  );

  if (missingChannelNames.length === 0) {
    return;
  }

  await updateAiSiteBindings([
    ...state.bindings,
    ...missingChannelNames.map((channelName) =>
      createBindingForConversation(state.conversationId, 'custom', 'custom', channelName),
    ),
  ]);
}

export function recordAiBandFeatureResults(
  results: readonly EegAnalysisResult[],
  input: {
    streamStartedAtMs: number | null;
    fftSize: number;
    sampleRateHz?: number;
    filterId: string;
    filterParams: Record<string, number>;
  },
): void {
  const state = useAiStore.getState();
  if (!state.isRecording || state.isReadOnly || !activeDb || results.length === 0) {
    return;
  }

  const conversationId = state.conversationId;
  const bindingsByChannel = new Map(
    state.bindings.map((binding) => [binding.channelName.trim().toLowerCase(), binding]),
  );
  const groupedResults = new Map<string, EegAnalysisResult[]>();

  for (const result of results) {
    const channelName = result.channelName.trim() || 'ch0';
    const bucket = groupedResults.get(channelName) ?? [];
    bucket.push(result);
    groupedResults.set(channelName, bucket);
  }

  const frames = [...groupedResults.entries()].flatMap(([channelName, channelResults]) => {
    const binding =
      bindingsByChannel.get(channelName.toLowerCase()) ??
      createBindingForConversation(conversationId, 'custom', 'custom', channelName);

    return createBandFeatureFrames(channelResults, {
      conversationId,
      binding,
      streamStartedAtMs: input.streamStartedAtMs,
      fftSize: input.fftSize,
      sampleRateHz: input.sampleRateHz,
      filterId: input.filterId,
      filterParams: input.filterParams,
    });
  });

  const db = activeDb;

  const task = trackDurableWrite((async () => {
    await db.putBandFeatureFrames(frames);
    await updateFrameCountForConversation(conversationId, db);
  })());
  trackDeadlineWrite(task, conversationId);
}

export async function getActiveAiFrames(input: {
  startMs: number;
  endMs: number;
  bindingId?: string | null;
}): Promise<BandFeatureFrameV1[]> {
  await initializeAiConversation();
  if (!activeDb) return [];
  await flushAiBandFeatureWrites();
  return activeDb.getBandFeatureFrames(input);
}

function createBundleFileName(conversationId: string, timestampMs = Date.now()): string {
  const stamp = new Date(timestampMs).toISOString().replace(/[:.]/g, '-');
  return `eeg-ai-${conversationId.slice(0, 8)}-${stamp}.eegai.zip`;
}

export async function exportActiveAiConversation(input?: {
  markClosed?: boolean;
}): Promise<AiConversationBundleExport> {
  await initializeAiConversation();
  if (!activeDb) {
    throw new Error('AI conversation is not open.');
  }
  await flushAiBandFeatureWrites({ durable: true });
  const exportedAtMs = Date.now();
  const state = useAiStore.getState();
  if (input?.markClosed) {
    await persistConversationMeta({
      db: activeDb,
      conversationId: state.conversationId,
      binding: state.binding,
      bindings: state.bindings,
      isReadOnly: state.isReadOnly,
      closedAtMs: exportedAtMs,
    });
  }
  const bytes = await activeDb.exportBundle(exportedAtMs);
  const fileName = createBundleFileName(state.conversationId, exportedAtMs);
  useAiStore.getState().setLastExportFileName(fileName);
  return { bytes, fileName };
}

export async function switchAiConversation(): Promise<{
  bytes: Uint8Array;
  fileName: string;
  conversationId: string;
  previousConversationId: string;
}> {
  const store = useAiStore.getState();
  store.setStatus('handoff');
  store.setRecording(false);

  const previousConversationId = store.conversationId;
  const exported = await exportActiveAiConversation({ markClosed: true });
  closeActiveConversation();

  const conversationId = createNextConversationId();
  const binding = createBindingForConversation(
    conversationId,
    store.binding.siteName,
    store.binding.placementSystem,
  );
  await openConversation(conversationId, binding, false);

  return {
    bytes: exported.bytes,
    fileName: exported.fileName,
    conversationId,
    previousConversationId,
  };
}

export async function restoreAiConversationFromBundle(file: File): Promise<{
  exportedPrevious: AiConversationBundleExport | null;
  previousConversationId: string;
  conversationId: string;
}> {
  const bytes = await file.arrayBuffer();
  validateEegAiBundle(bytes);
  await initializeAiConversation();
  const previousState = useAiStore.getState();
  const previousConversationId = previousState.conversationId;
  const previousBinding = previousState.binding;
  const previousReadOnly = previousState.isReadOnly;
  let exportedPrevious: AiConversationBundleExport | null = null;
  if (activeDb && (await activeDb.countFrames()) > 0) {
    exportedPrevious = await exportActiveAiConversation({ markClosed: true });
  }

  closeActiveConversation();

  const conversationId = createNextConversationId();
  const binding = createBindingForConversation(conversationId, 'restored', 'custom');
  try {
    const db = await openConversation(conversationId, binding, true);
    await db.restoreBundle(bytes);
    const restoredMeta = await db.getConversationMeta();
    const restoredBinding = restoredMeta?.binding ?? binding;
    const restoredBindings = restoredMeta?.bindings?.length ? restoredMeta.bindings : [restoredBinding];
    useAiStore
      .getState()
      .setConversationReady(conversationId, restoredBinding, true, restoredBindings);
    useAiStore.getState().setDataDirectoryLabel(formatDataDirectoryLabel(db));
    useAiStore.getState().setFrameCount(await db.countFrames());
    return { exportedPrevious, previousConversationId, conversationId };
  } catch (error) {
    closeActiveConversation();
    await deleteConversationDb(conversationId).catch((deleteError) => {
      console.warn('Failed to delete failed EEG AI restore database:', deleteError);
    });
    await openConversation(previousConversationId, previousBinding, previousReadOnly);
    throw error;
  }
}

export async function deleteStoredAiConversation(conversationId: string): Promise<void> {
  if (useAiStore.getState().conversationId === conversationId) return;
  try {
    await deleteConversationDb(conversationId);
  } catch (error) {
    setRuntimeError(error);
  }
}

export function downloadAiBundle(bytes: Uint8Array, fileName: string): void {
  const copy = bytes.slice();
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: 'application/zip' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
}
