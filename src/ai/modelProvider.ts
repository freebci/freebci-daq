import type { LanguageModel } from 'ai';

export interface AiModelConfig {
  providerName: string;
  baseURL: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  enableStreaming: boolean;
}

export interface AiModelConnectionTestResult {
  status: 'success' | 'error';
  latencyMs: number;
  providerName: string;
  modelId: string;
  sampleText: string | null;
  errorMessage: string | null;
}

const MODEL_TEST_TIMEOUT_MS = 15_000;

export function hasUsableModelConfig(config: AiModelConfig | null | undefined): config is AiModelConfig {
  return Boolean(
    config &&
      config.providerName.trim().length > 0 &&
      config.baseURL.trim().length > 0 &&
      config.apiKey.trim().length > 0 &&
      config.modelId.trim().length > 0,
  );
}

export async function createLanguageModel(config: AiModelConfig): Promise<LanguageModel> {
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
  const provider = createOpenAICompatible({
    name: config.providerName.trim(),
    baseURL: config.baseURL.trim().replace(/\/$/, ''),
    apiKey: config.apiKey,
    supportsStructuredOutputs: true,
  });

  return provider.chatModel(config.modelId.trim()) as LanguageModel;
}

function getNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export async function testLanguageModelConnection(
  config: AiModelConfig,
): Promise<AiModelConnectionTestResult> {
  const startedAtMs = getNowMs();

  try {
    const [{ generateText }, model] = await Promise.all([
      import('ai'),
      createLanguageModel(config),
    ]);
    const result = await generateText({
      model,
      temperature: 0,
      maxOutputTokens: 8,
      maxRetries: 0,
      timeout: MODEL_TEST_TIMEOUT_MS,
      system: 'You are a model connectivity test. Reply with exactly OK.',
      prompt: 'Reply with OK.',
    });

    return {
      status: 'success',
      latencyMs: Math.round(getNowMs() - startedAtMs),
      providerName: config.providerName.trim(),
      modelId: config.modelId.trim(),
      sampleText: result.text.trim().slice(0, 80) || null,
      errorMessage: null,
    };
  } catch (error) {
    return {
      status: 'error',
      latencyMs: Math.round(getNowMs() - startedAtMs),
      providerName: config.providerName.trim(),
      modelId: config.modelId.trim(),
      sampleText: null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) return 0.2;
  return Math.max(0, Math.min(2, value));
}
