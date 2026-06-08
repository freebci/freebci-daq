import { Cable, Trash2, Unplug } from 'lucide-react';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { useEegStore } from '../store/eegStore';
import { canDisconnectDevice, formatAcquisitionStatus } from '../utils/acquisitionUi';
import { Button, Card, CardBody, CardHeader } from './ui';

interface ConnectionPanelProps {
  locale: Locale;
  onConnectDevice: () => Promise<void>;
  onDisconnect: () => void | Promise<void>;
  onForgetDevice: () => Promise<void>;
}

export function ConnectionPanel({
  locale,
  onConnectDevice,
  onDisconnect,
  onForgetDevice,
}: ConnectionPanelProps) {
  const devices = useEegStore((state) => state.devices);
  const hardwareConfigLocked = useEegStore(
    (state) => state.acquisition.hardwareConfigLocked,
  );
  const selectedDeviceId = useEegStore((state) => state.selectedDeviceId);
  const connectedDeviceId = useEegStore((state) => state.connectedDeviceId);
  const status = useEegStore((state) => state.status);
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) ?? null;
  const connectedDevice = devices.find((d) => d.id === connectedDeviceId) ?? null;
  const currentDevice = selectedDevice ?? connectedDevice;
  const isSerialIdleWithLockedConfig =
    hardwareConfigLocked &&
    currentDevice === null &&
    ['idle', 'disconnected', 'error'].includes(status);
  const isSerialConnectionCancelable =
    hardwareConfigLocked &&
    !['idle', 'disconnected', 'error'].includes(status);
  const canConnect =
    hardwareConfigLocked && ['idle', 'disconnected', 'error'].includes(status);
  const canDisconnect =
    canDisconnectDevice(status, connectedDevice !== null) || isSerialConnectionCancelable;
  const canForgetDevice = selectedDevice?.canForgetAccess ?? false;
  const isConnected = currentDevice !== null && currentDevice.id === connectedDeviceId;
  let emptyMessage = t(locale, 'connection.empty');
  if (isSerialIdleWithLockedConfig) {
    emptyMessage = t(locale, 'connection.serialReadyEmpty');
  } else if (hardwareConfigLocked) {
    emptyMessage = t(locale, 'connection.serialOpeningEmpty');
  }
  const helpMessage =
    selectedDevice?.canForgetAccess
      ? t(locale, 'connection.canForgetHelp')
      : t(
          locale,
          hardwareConfigLocked
            ? 'connection.serialReadyHelp'
            : 'connection.serialHelp',
        );

  return (
    <Card ariaLabelledBy="connection-title">
      <CardHeader
        eyebrow={t(locale, 'connection.eyebrow')}
        title={t(locale, 'connection.title')}
        titleId="connection-title"
        trailing={
          isConnected && (
            <span className="inline-flex items-center gap-2 border border-accent/30 bg-accent-soft px-2.5 h-6 rounded-sm font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-accent">
              {t(locale, 'connection.connectedBadge')}
            </span>
          )
        }
      />
      <CardBody className="flex flex-col gap-5">
        {currentDevice === null ? (
          <p className="m-0 text-[0.9rem] text-meta leading-relaxed">
            {emptyMessage}
          </p>
        ) : (
          <div className="border-l-2 border-accent pl-4 py-1 flex flex-col gap-1.5">
            <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-meta">
              {t(locale, 'connection.currentDevice')}
            </span>
            <strong className="text-[1.1rem] font-medium leading-tight text-ink break-words">
              {currentDevice.name ?? t(locale, 'connection.unnamed')}
            </strong>
            <code className="font-mono text-[0.78rem] text-meta break-all">{currentDevice.id}</code>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-hairline pt-4">
          <div className="min-w-0">
            <dt className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-meta">
              {t(locale, 'connection.connectedDevice')}
            </dt>
            <dd className="mt-1 font-mono text-[0.85rem] text-ink break-words">
              {connectedDevice?.name ?? '—'}
            </dd>
          </div>
          <div className="min-w-0 text-right">
            <dt className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-meta">
              {t(locale, 'connection.status')}
            </dt>
            <dd className="mt-1 font-mono text-[0.85rem] text-ink">{formatAcquisitionStatus(status, locale)}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void onConnectDevice()} disabled={!canConnect}>
            <Cable size={14} strokeWidth={1.5} />
            {t(locale, 'connection.openSerial')}
          </Button>
          <Button variant="ghost" onClick={() => void onDisconnect()} disabled={!canDisconnect}>
            <Unplug size={14} strokeWidth={1.5} />
            {t(locale, 'connection.disconnect')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => void onForgetDevice()}
            disabled={!canForgetDevice}
            title={
              selectedDevice && !selectedDevice.canForgetAccess
                ? t(locale, 'connection.cannotForgetTitle')
                : undefined
            }
          >
            <Trash2 size={14} strokeWidth={1.5} />
            {t(locale, 'connection.forget')}
          </Button>
        </div>

        <p className="m-0 text-[0.78rem] text-meta leading-snug">
          {helpMessage}
        </p>
      </CardBody>
    </Card>
  );
}
