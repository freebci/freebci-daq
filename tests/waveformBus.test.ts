import { describe, expect, it } from 'vitest';
import { createWaveformBus } from '../src/state/waveformBus';

describe('waveform bus', () => {
  it('keeps lead-off flags aligned with raw samples', () => {
    const bus = createWaveformBus();
    const values = new Float32Array(3);
    const leadOff = new Uint8Array(3);

    bus.push(1, 'ch0', { leadOff: false });
    bus.push(2, 'ch0', { leadOff: true });
    bus.push(3, 'ch0', { leadOff: true });

    expect(bus.copyLatest(values, 3, 'ch0')).toBe(3);
    expect(bus.copyLatestLeadOff(leadOff, 3, 'ch0')).toBe(3);
    expect([...values]).toEqual([1, 2, 3]);
    expect([...leadOff]).toEqual([0, 1, 1]);
  });

  it('clears lead-off flags on reset', () => {
    const bus = createWaveformBus();
    const leadOff = new Uint8Array(1);

    bus.push(1, 'ch0', { leadOff: true });
    bus.reset();

    expect(bus.copyLatestLeadOff(leadOff, 1, 'ch0')).toBe(0);
  });

  it('can backfill the latest samples as lead-off', () => {
    const bus = createWaveformBus();
    const leadOff = new Uint8Array(4);

    bus.push(1, 'ch0');
    bus.push(2, 'ch0');
    bus.push(3, 'ch0');
    bus.push(4, 'ch0');
    bus.markLatestLeadOff(3, 'ch0');

    expect(bus.copyLatestLeadOff(leadOff, 4, 'ch0')).toBe(4);
    expect([...leadOff]).toEqual([0, 1, 1, 1]);
  });
});
