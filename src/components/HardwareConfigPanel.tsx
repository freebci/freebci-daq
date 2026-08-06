import type { ChangeEvent } from 'react';
import { Check, Lock, RotateCcw, SlidersHorizontal } from 'lucide-react';
import {
  EEG_SERIAL_BAUD_RATES,
  type EegSerialBaudRate,
} from '../config/serial';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import {
  EEG_HARDWARE_AC_LEAD_OFF_MODES,
  EEG_HARDWARE_GAINS,
  EEG_HARDWARE_SAMPLE_RATES_HZ,
  type EegHardwareAcLeadOffMode,
  type EegHardwareGain,
  type EegHardwareSampleRateHz,
} from '../transport/eegHardwareConfig';
import { useEegStore } from '../store/eegStore';
import { Button, Card, CardBody, CardHeader, Field, ToggleSwitch } from './ui';

interface HardwareConfigPanelProps {
  locale: Locale;
}

interface HardwareSelectProps<T extends string | number> {
  id: string;
  label: string;
  hint?: string;
  value: T;
  options: readonly T[];
  disabled: boolean;
  formatOption: (value: T) => string;
  onChange: (value: T) => void;
}

function HardwareSelect<T extends string | number>({
  id,
  label,
  hint,
  value,
  options,
  disabled,
  formatOption,
  onChange,
}: HardwareSelectProps<T>) {
  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    const option = options.find((item) => String(item) === event.target.value);
    if (option !== undefined) {
      onChange(option);
    }
  }

  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <select
        id={id}
        value={String(value)}
        disabled={disabled}
        onChange={handleChange}
        className="w-full rounded-sm border border-hairline bg-card px-3 py-2 font-mono text-[0.88rem] text-ink focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-paper disabled:text-meta"
      >
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>
            {formatOption(option)}
          </option>
        ))}
      </select>
    </Field>
  );
}

function formatSampleRate(sampleRateHz: EegHardwareSampleRateHz): string {
  return sampleRateHz >= 1000 ? `${sampleRateHz / 1000} kHz` : `${sampleRateHz} Hz`;
}

function formatBaudRate(baudRate: EegSerialBaudRate): string {
  return `${baudRate.toLocaleString('en-US')} baud`;
}

function formatAcLeadOffMode(locale: Locale, mode: EegHardwareAcLeadOffMode): string {
  switch (mode) {
    case 'FDR4':
      return t(locale, 'serial.acFdr4Detect');
    case '7_8HZ':
      return t(locale, 'serial.ac7_8HzDetect');
    case '31_2HZ':
      return t(locale, 'serial.ac31_2HzDetect');
    case 'OFF':
      return t(locale, 'serial.leadOffOff');
    default:
      return mode;
  }
}

export function HardwareConfigPanel({ locale }: HardwareConfigPanelProps) {
  const status = useEegStore((state) => state.status);
  const baudRate = useEegStore((state) => state.acquisition.baudRate);
  const hardwareConfig = useEegStore((state) => state.acquisition.hardwareConfig);
  const hardwareConfigLocked = useEegStore(
    (state) => state.acquisition.hardwareConfigLocked,
  );
  const isStreamBusy = useEegStore(
    (state) => state.stream.isStarting || state.stream.isStreaming,
  );
  const setHardwareConfig = useEegStore((state) => state.setHardwareConfig);
  const setBaudRate = useEegStore((state) => state.setBaudRate);
  const lockHardwareConfig = useEegStore((state) => state.lockHardwareConfig);
  const unlockHardwareConfig = useEegStore(
    (state) => state.unlockHardwareConfig,
  );
  const canEditConfig =
    !isStreamBusy && ['idle', 'disconnected', 'error'].includes(status);
  const canEditFields = canEditConfig && !hardwareConfigLocked;
  const canClickConfigButton = canEditConfig;

  function handleConfigButtonClick(): void {
    if (hardwareConfigLocked) {
      unlockHardwareConfig();
      return;
    }

    lockHardwareConfig();
  }

  return (
    <Card ariaLabelledBy="hardware-config-title">
      <CardHeader
        eyebrow={t(locale, 'hardware.eyebrow')}
        title={t(locale, 'hardware.title')}
        titleId="hardware-config-title"
        trailing={
          <div
            aria-label={t(locale, 'serial.configState')}
            className={`inline-flex h-7 items-center justify-center gap-2 rounded-sm border px-2.5 font-mono text-[0.64rem] font-medium uppercase tracking-[0.08em] ${
              hardwareConfigLocked
                ? 'border-accent/40 bg-card text-accent'
                : 'border-hairline bg-card text-meta'
            }`}
          >
            {hardwareConfigLocked ? (
              <Lock size={12} strokeWidth={1.6} />
            ) : (
              <SlidersHorizontal size={12} strokeWidth={1.6} />
            )}
            {t(
              locale,
              hardwareConfigLocked ? 'serial.configLocked' : 'serial.configDraft',
            )}
          </div>
        }
      />
      <CardBody className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <HardwareSelect<EegSerialBaudRate>
            id="serial-baud-rate"
            label={t(locale, 'serial.baudRate')}
            hint={t(locale, 'serial.baudRateHint')}
            value={baudRate}
            options={EEG_SERIAL_BAUD_RATES}
            disabled={!canEditFields}
            formatOption={formatBaudRate}
            onChange={setBaudRate}
          />
          <HardwareSelect<EegHardwareSampleRateHz>
            id="hardware-sample-rate"
            label={t(locale, 'serial.sampleRate')}
            value={hardwareConfig.sampleRateHz}
            options={EEG_HARDWARE_SAMPLE_RATES_HZ}
            disabled={!canEditFields}
            formatOption={formatSampleRate}
            onChange={(sampleRateHz) => setHardwareConfig({ sampleRateHz })}
          />
          <HardwareSelect<EegHardwareGain>
            id="hardware-gain"
            label={t(locale, 'serial.gain')}
            value={hardwareConfig.gain}
            options={EEG_HARDWARE_GAINS}
            disabled={!canEditFields}
            formatOption={(gain) => `${gain}x`}
            onChange={(gain) => setHardwareConfig({ gain })}
          />
          <Field label={t(locale, 'serial.rld')} htmlFor="hardware-rld">
            <ToggleSwitch
              id="hardware-rld"
              checked={hardwareConfig.rldEnabled}
              disabled={!canEditFields}
              label={t(
                locale,
                hardwareConfig.rldEnabled ? 'serial.rldOn' : 'serial.rldOff',
              )}
              onCheckedChange={(rldEnabled) => setHardwareConfig({ rldEnabled })}
              className="self-start"
            />
          </Field>
          <HardwareSelect<EegHardwareAcLeadOffMode>
            id="hardware-ac-lead-off"
            label={t(locale, 'serial.acLeadOff')}
            value={hardwareConfig.acLeadOffMode}
            options={EEG_HARDWARE_AC_LEAD_OFF_MODES}
            disabled={!canEditFields}
            formatOption={(mode) => formatAcLeadOffMode(locale, mode)}
            onChange={(acLeadOffMode) => setHardwareConfig({ acLeadOffMode })}
          />
        </div>

        <div className="flex items-center justify-end border-t border-hairline pt-4">
          <Button
            onClick={handleConfigButtonClick}
            disabled={!canClickConfigButton}
            variant={hardwareConfigLocked ? 'ghost' : 'primary'}
            className="w-full sm:w-auto"
          >
            {hardwareConfigLocked ? (
              <RotateCcw size={14} strokeWidth={1.5} />
            ) : (
              <Check size={14} strokeWidth={1.5} />
            )}
            {t(
              locale,
              hardwareConfigLocked
                ? 'connection.resetSerialConfig'
                : 'serial.confirmConfig',
            )}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
