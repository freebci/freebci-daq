import type { AiModelUiConfig } from '../store/aiStore';
import { clampTemperature, type AiModelConfig } from './modelProvider';
import { CUSTOM_PRESET_VALUE, getProviderPreset, getTemperaturePreset } from './modelPresets';

export function createRequestModelConfig(config: AiModelUiConfig): AiModelConfig | null {
  const providerPreset = getProviderPreset(config.providerPresetId);
  const temperaturePreset = getTemperaturePreset(config.temperaturePresetId);
  const selectedBaseURL =
    config.baseURL === CUSTOM_PRESET_VALUE ? config.customBaseURL : config.baseURL;
  const selectedModelId =
    config.modelId === CUSTOM_PRESET_VALUE ? config.customModelId : config.modelId;
  const requestApiKey = config.apiKey.trim() || (providerPreset.requiresApiKey ? '' : 'local');

  if (!requestApiKey || !selectedBaseURL.trim() || !selectedModelId.trim()) {
    return null;
  }

  return {
    providerName: providerPreset.providerName,
    baseURL: selectedBaseURL,
    apiKey: requestApiKey,
    modelId: selectedModelId,
    temperature: clampTemperature(temperaturePreset.value),
    enableStreaming: config.enableStreaming,
  };
}

