export const CUSTOM_PRESET_VALUE = '__custom__' as const;

export interface LocalizedOption {
  value: string;
  labelZh: string;
  labelEn: string;
}

export interface AiProviderPreset {
  id: string;
  labelZh: string;
  labelEn: string;
  providerName: string;
  requiresApiKey: boolean;
  baseUrls: LocalizedOption[];
  models: LocalizedOption[];
}

export const AI_PROVIDER_PRESETS = [
  {
    id: 'openai',
    labelZh: 'OpenAI',
    labelEn: 'OpenAI',
    providerName: 'openai',
    requiresApiKey: true,
    baseUrls: [
      {
        value: 'https://api.openai.com/v1',
        labelZh: 'OpenAI 官方 API',
        labelEn: 'OpenAI official API',
      },
    ],
    models: [
      { value: 'gpt-4.1-mini', labelZh: 'gpt-4.1-mini（推荐）', labelEn: 'gpt-4.1-mini (recommended)' },
      { value: 'gpt-4.1', labelZh: 'gpt-4.1', labelEn: 'gpt-4.1' },
      { value: 'gpt-4o-mini', labelZh: 'gpt-4o-mini', labelEn: 'gpt-4o-mini' },
      { value: CUSTOM_PRESET_VALUE, labelZh: '自定义模型名', labelEn: 'Custom model id' },
    ],
  },
  {
    id: 'deepseek',
    labelZh: 'DeepSeek',
    labelEn: 'DeepSeek',
    providerName: 'deepseek',
    requiresApiKey: true,
    baseUrls: [
      {
        value: 'https://api.deepseek.com/v1',
        labelZh: 'DeepSeek OpenAI 兼容 API',
        labelEn: 'DeepSeek OpenAI-compatible API',
      },
    ],
    models: [
      { value: 'deepseek-v4-pro', labelZh: 'deepseek-v4-pro', labelEn: 'deepseek-v4-pro' },
      { value: 'deepseek-chat', labelZh: 'deepseek-chat', labelEn: 'deepseek-chat' },
      { value: 'deepseek-reasoner', labelZh: 'deepseek-reasoner', labelEn: 'deepseek-reasoner' },
      { value: CUSTOM_PRESET_VALUE, labelZh: '自定义模型名', labelEn: 'Custom model id' },
    ],
  },
  {
    id: 'openrouter',
    labelZh: 'OpenRouter',
    labelEn: 'OpenRouter',
    providerName: 'openrouter',
    requiresApiKey: true,
    baseUrls: [
      {
        value: 'https://openrouter.ai/api/v1',
        labelZh: 'OpenRouter API',
        labelEn: 'OpenRouter API',
      },
    ],
    models: [
      { value: 'openai/gpt-4.1-mini', labelZh: 'openai/gpt-4.1-mini', labelEn: 'openai/gpt-4.1-mini' },
      { value: CUSTOM_PRESET_VALUE, labelZh: '自定义模型名', labelEn: 'Custom model id' },
    ],
  },
  {
    id: 'ollama',
    labelZh: 'Ollama 本地',
    labelEn: 'Ollama local',
    providerName: 'ollama',
    requiresApiKey: false,
    baseUrls: [
      {
        value: 'http://127.0.0.1:11434/v1',
        labelZh: '本机 Ollama',
        labelEn: 'Local Ollama',
      },
    ],
    models: [
      { value: 'qwen2.5', labelZh: 'qwen2.5', labelEn: 'qwen2.5' },
      { value: 'llama3.1', labelZh: 'llama3.1', labelEn: 'llama3.1' },
      { value: CUSTOM_PRESET_VALUE, labelZh: '自定义模型名', labelEn: 'Custom model id' },
    ],
  },
  {
    id: 'custom',
    labelZh: '自定义 OpenAI 兼容',
    labelEn: 'Custom OpenAI-compatible',
    providerName: 'openai-compatible',
    requiresApiKey: true,
    baseUrls: [
      { value: CUSTOM_PRESET_VALUE, labelZh: '手动输入 Base URL', labelEn: 'Custom Base URL' },
    ],
    models: [
      { value: CUSTOM_PRESET_VALUE, labelZh: '手动输入模型名', labelEn: 'Custom model id' },
    ],
  },
] as const satisfies readonly AiProviderPreset[];

export type AiProviderPresetId = (typeof AI_PROVIDER_PRESETS)[number]['id'];

export const TEMPERATURE_PRESETS = [
  {
    id: 'strict',
    value: 0,
    labelZh: '严谨 · 0.0',
    labelEn: 'Strict · 0.0',
  },
  {
    id: 'balanced',
    value: 0.2,
    labelZh: '稳健 · 0.2（推荐）',
    labelEn: 'Balanced · 0.2 (recommended)',
  },
  {
    id: 'explore',
    value: 0.7,
    labelZh: '探索 · 0.7',
    labelEn: 'Exploratory · 0.7',
  },
] as const;

export type TemperaturePresetId = (typeof TEMPERATURE_PRESETS)[number]['id'];

export function getProviderPreset(id: string): AiProviderPreset {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === id) ?? AI_PROVIDER_PRESETS[0];
}

export function getTemperaturePreset(id: string): (typeof TEMPERATURE_PRESETS)[number] {
  return TEMPERATURE_PRESETS.find((preset) => preset.id === id) ?? TEMPERATURE_PRESETS[1];
}
