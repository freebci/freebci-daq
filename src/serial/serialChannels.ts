import {
  EEG_DEFAULT_CHANNEL_COUNT,
  EEG_MAX_CHANNEL_COUNT,
  EEG_MIN_CHANNEL_COUNT,
  getEegChannelNames,
  normalizeEegChannelCount,
} from '../transport/eegChannels';

export const SERIAL_EEG_MIN_CHANNEL_COUNT = EEG_MIN_CHANNEL_COUNT;
export const SERIAL_EEG_MAX_CHANNEL_COUNT = EEG_MAX_CHANNEL_COUNT;
export const SERIAL_EEG_CHANNEL_COUNT = EEG_DEFAULT_CHANNEL_COUNT;

export const normalizeSerialEegChannelCount = normalizeEegChannelCount;
export const getSerialEegChannelNames = getEegChannelNames;
