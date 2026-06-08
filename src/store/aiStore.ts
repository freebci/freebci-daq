import { create } from 'zustand';
import { AI_SCHEMA_VERSION, type SiteBindingV1 } from '../ai/protocol';
import { createDefaultSiteBinding } from '../ai/bandFeatures';
import type { AiProviderPresetId, TemperaturePresetId } from '../ai/modelPresets';

export type AiConversationStatus = 'idle' | 'opening' | 'ready' | 'handoff' | 'error';

const ACTIVE_AI_CONVERSATION_STORAGE_KEY = 'eeg.ai.activeConversationId';

export interface AiAnalysisUiResult {
  requestId: string;
  createdAtMs: number;
  json: string;
}

export interface AiModelUiConfig {
  providerPresetId: AiProviderPresetId;
  baseURL: string;
  customBaseURL: string;
  apiKey: string;
  modelId: string;
  customModelId: string;
  temperaturePresetId: TemperaturePresetId;
  enableStreaming: boolean;
}

interface AiStore {
  conversationId: string;
  status: AiConversationStatus;
  isRecording: boolean;
  isReadOnly: boolean;
  isSiteBindingLocked: boolean;
  frameCount: number;
  dataDirectoryLabel: string;
  pendingWriteCount: number;
  lastWriteDurationMs: number | null;
  writeTimeoutCount: number;
  binding: SiteBindingV1;
  bindings: SiteBindingV1[];
  modelConfig: AiModelUiConfig;
  errorMessage: string | null;
  lastExportFileName: string | null;
  lastAnalysisResult: AiAnalysisUiResult | null;
  setConversationReady: (
    conversationId: string,
    binding: SiteBindingV1,
    isReadOnly: boolean,
    bindings?: SiteBindingV1[],
  ) => void;
  setStatus: (status: AiConversationStatus) => void;
  setRecording: (isRecording: boolean) => void;
  setSiteBindingLocked: (isLocked: boolean) => void;
  setBinding: (binding: SiteBindingV1) => void;
  setBindings: (bindings: SiteBindingV1[]) => void;
  setFrameCount: (frameCount: number) => void;
  setDataDirectoryLabel: (label: string) => void;
  setModelConfig: (patch: Partial<AiModelUiConfig>) => void;
  recordWriteStart: () => void;
  recordWriteFinish: (durationMs: number, timedOut: boolean) => void;
  setError: (errorMessage: string | null) => void;
  setLastExportFileName: (fileName: string | null) => void;
  setLastAnalysisResult: (result: AiAnalysisUiResult | null) => void;
}

function createConversationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `conversation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readStoredConversationId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const value = localStorage.getItem(ACTIVE_AI_CONVERSATION_STORAGE_KEY);
    return value && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function persistActiveAiConversationId(conversationId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ACTIVE_AI_CONVERSATION_STORAGE_KEY, conversationId);
  } catch {
    // Storage may be unavailable in private contexts; the DB itself still works.
  }
}

const initialConversationId = readStoredConversationId() ?? createConversationId();
const initialBinding = createDefaultSiteBinding(initialConversationId);

const initialModelConfig: AiModelUiConfig = {
  providerPresetId: 'openai',
  baseURL: 'https://api.openai.com/v1',
  customBaseURL: '',
  apiKey: '',
  modelId: 'gpt-4.1-mini',
  customModelId: '',
  temperaturePresetId: 'balanced',
  enableStreaming: true,
};

export const useAiStore = create<AiStore>((set) => ({
  conversationId: initialConversationId,
  status: 'idle',
  isRecording: false,
  isReadOnly: false,
  isSiteBindingLocked: false,
  frameCount: 0,
  dataDirectoryLabel: '',
  pendingWriteCount: 0,
  lastWriteDurationMs: null,
  writeTimeoutCount: 0,
  binding: initialBinding,
  bindings: [initialBinding],
  modelConfig: initialModelConfig,
  errorMessage: null,
  lastExportFileName: null,
  lastAnalysisResult: null,
  setConversationReady: (conversationId, binding, isReadOnly, bindings) =>
    set({
      conversationId,
      binding,
      bindings: bindings && bindings.length > 0 ? bindings : [binding],
      isReadOnly,
      status: 'ready',
      errorMessage: null,
      frameCount: 0,
      isSiteBindingLocked: isReadOnly,
      isRecording: false,
      dataDirectoryLabel: `IndexedDB/eeg-ai-conversation-${conversationId}/bandFeatureFrames`,
    }),
  setStatus: (status) => set({ status }),
  setRecording: (isRecording) => set({ isRecording }),
  setSiteBindingLocked: (isSiteBindingLocked) => set({ isSiteBindingLocked }),
  setBinding: (binding) => set({ binding }),
  setBindings: (bindings) =>
    set((state) => ({
      bindings,
      binding: pickPrimaryBinding(bindings) ?? state.binding,
    })),
  setFrameCount: (frameCount) => set({ frameCount }),
  setDataDirectoryLabel: (dataDirectoryLabel) => set({ dataDirectoryLabel }),
  setModelConfig: (patch) =>
    set((state) => ({
      modelConfig: {
        ...state.modelConfig,
        ...patch,
      },
    })),
  recordWriteStart: () =>
    set((state) => ({
      pendingWriteCount: state.pendingWriteCount + 1,
    })),
  recordWriteFinish: (lastWriteDurationMs, timedOut) =>
    set((state) => ({
      pendingWriteCount: Math.max(0, state.pendingWriteCount - 1),
      lastWriteDurationMs,
      writeTimeoutCount: timedOut ? state.writeTimeoutCount + 1 : state.writeTimeoutCount,
    })),
  setError: (errorMessage) => set({ errorMessage, status: errorMessage ? 'error' : 'ready' }),
  setLastExportFileName: (lastExportFileName) => set({ lastExportFileName }),
  setLastAnalysisResult: (lastAnalysisResult) => set({ lastAnalysisResult }),
}));

export function createNextConversationId(): string {
  return createConversationId();
}

export function createBindingForConversation(
  conversationId: string,
  siteName: string,
  placementSystem: string,
  channelName = 'ch0',
): SiteBindingV1 {
  return {
    ...createDefaultSiteBinding(conversationId, siteName, placementSystem),
    schemaVersion: AI_SCHEMA_VERSION,
    bindingId: `binding-${normalizeBindingChannelName(channelName)}`,
    channelName: normalizeBindingChannelName(channelName),
  };
}

export function pickPrimaryBinding(bindings: readonly SiteBindingV1[]): SiteBindingV1 | null {
  return (
    bindings.find((binding) => binding.channelName.trim().toLowerCase() === 'ch0') ??
    bindings[0] ??
    null
  );
}

export function normalizeBindingChannelName(channelName: string): string {
  return channelName.trim() || 'ch0';
}
