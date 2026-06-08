import { describe, expect, it } from 'vitest';
import { createRequestModelConfig } from '../src/ai/modelConfig';
import { AI_PROVIDER_PRESETS, CUSTOM_PRESET_VALUE } from '../src/ai/modelPresets';
import type { AiModelUiConfig } from '../src/store/aiStore';

const baseConfig: AiModelUiConfig = {
  providerPresetId: 'openai',
  baseURL: 'https://api.openai.com/v1',
  customBaseURL: '',
  apiKey: 'test-key',
  modelId: 'gpt-4.1-mini',
  customModelId: '',
  temperaturePresetId: 'balanced',
  enableStreaming: true,
};

describe('AI model request config', () => {
  it('uses manually entered API address and model id directly', () => {
    const config = createRequestModelConfig({
      ...baseConfig,
      providerPresetId: 'custom',
      baseURL: 'http://127.0.0.1:8000/v1',
      modelId: 'local-eeg-model',
    });

    expect(config).toMatchObject({
      providerName: 'openai-compatible',
      baseURL: 'http://127.0.0.1:8000/v1',
      apiKey: 'test-key',
      modelId: 'local-eeg-model',
      temperature: 0.2,
      enableStreaming: true,
    });
  });

  it('keeps backward compatibility with the old custom sentinel fields', () => {
    const config = createRequestModelConfig({
      ...baseConfig,
      baseURL: CUSTOM_PRESET_VALUE,
      customBaseURL: 'https://gateway.example.com/v1',
      modelId: CUSTOM_PRESET_VALUE,
      customModelId: 'gateway-model',
    });

    expect(config).toMatchObject({
      baseURL: 'https://gateway.example.com/v1',
      modelId: 'gateway-model',
    });
  });

  it('allows local OpenAI-compatible providers without a visible API key', () => {
    const config = createRequestModelConfig({
      ...baseConfig,
      providerPresetId: 'ollama',
      baseURL: 'http://127.0.0.1:11434/v1',
      apiKey: '',
      modelId: 'qwen2.5',
    });

    expect(config).toMatchObject({
      providerName: 'ollama',
      apiKey: 'local',
      modelId: 'qwen2.5',
    });
  });

  it('offers DeepSeek v4 pro as a selectable OpenAI-compatible model', () => {
    const deepseekPreset = AI_PROVIDER_PRESETS.find((preset) => preset.id === 'deepseek');

    expect(deepseekPreset?.models.map((model) => model.value)).toContain(
      'deepseek-v4-pro',
    );
  });
});
