import type { Locale } from '../i18n';
import { t } from '../i18n';
import type { AcquisitionStatus } from '../types/acquisition';

const DEVICE_REQUEST_BLOCKED_STATUSES: readonly AcquisitionStatus[] = [
  'requesting-device',
  'connecting',
  'ready',
];

const DISCONNECTABLE_STATUSES: readonly AcquisitionStatus[] = ['connecting', 'ready'];

const CONNECTABLE_STATUSES: readonly AcquisitionStatus[] = [
  'device-selected',
  'disconnected',
  'error',
];

export function canRequestDevice(
  status: AcquisitionStatus,
  isSupported: boolean,
  isAvailable: boolean | null,
): boolean {
  return (
    isSupported &&
    isAvailable !== false &&
    !DEVICE_REQUEST_BLOCKED_STATUSES.includes(status)
  );
}

export function canConnectDevice(status: AcquisitionStatus, hasSelectedDevice: boolean): boolean {
  return hasSelectedDevice && CONNECTABLE_STATUSES.includes(status);
}

export function canDisconnectDevice(status: AcquisitionStatus, hasDevice: boolean): boolean {
  return hasDevice && DISCONNECTABLE_STATUSES.includes(status);
}

export function formatSupportStatus(isSupported: boolean, locale: Locale): string {
  return isSupported ? t(locale, 'status.supported') : t(locale, 'status.notSupported');
}

export function formatAvailabilityStatus(isAvailable: boolean | null, locale: Locale): string {
  if (isAvailable === null) {
    return t(locale, 'status.checking');
  }

  return isAvailable ? t(locale, 'status.available') : t(locale, 'status.unavailable');
}

export function formatAcquisitionStatus(status: AcquisitionStatus, locale: Locale): string {
  switch (status) {
    case 'idle':
      return t(locale, 'acquisitionStatus.idle');
    case 'requesting-device':
      return t(locale, 'acquisitionStatus.requestingDevice');
    case 'device-selected':
      return t(locale, 'acquisitionStatus.deviceSelected');
    case 'connecting':
      return t(locale, 'acquisitionStatus.connecting');
    case 'ready':
      return t(locale, 'acquisitionStatus.ready');
    case 'disconnected':
      return t(locale, 'acquisitionStatus.disconnected');
    case 'error':
      return t(locale, 'acquisitionStatus.error');
  }
}

export function formatModeBadge(
  status: AcquisitionStatus,
  isStreaming: boolean,
  locale: Locale,
): string {
  if (isStreaming) return t(locale, 'statusBadge.streaming');
  switch (status) {
    case 'idle':
      return t(locale, 'statusBadge.idle');
    case 'requesting-device':
      return t(locale, 'statusBadge.requestingDevice');
    case 'device-selected':
      return t(locale, 'statusBadge.deviceSelected');
    case 'connecting':
      return t(locale, 'statusBadge.connecting');
    case 'ready':
      return t(locale, 'statusBadge.ready');
    case 'disconnected':
      return t(locale, 'statusBadge.disconnected');
    case 'error':
      return t(locale, 'statusBadge.error');
  }
}
