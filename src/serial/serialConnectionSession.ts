import {
  SerialEegProtocolParser,
  type SerialEegFrame,
  type SerialEegInvalidFrame,
  type SerialEegLoopbackEcho,
} from './serialEegProtocol';
import type { SerialAcquisitionSwitchAck } from './serialAcquisitionSwitch';
import type { SerialInitializationResetAck } from './serialInitialization';
import type {
  SerialHardwareConfigAck,
  SerialHardwareGain,
} from './serialHardwareConfig';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error: Error) => void;
}

export interface SerialConnectionSessionOptions {
  gain: SerialHardwareGain;
  channelCount: number;
  onFrame: (frame: SerialEegFrame) => void;
  onInvalidFrame: (frame: SerialEegInvalidFrame) => void;
  onSwitchAck?: (ack: SerialAcquisitionSwitchAck) => void;
  onSwitchAckError?: (line: string) => void;
  onLoopbackEcho?: (echo: SerialEegLoopbackEcho) => void;
}

export interface SerialConnectionSession {
  parser: SerialEegProtocolParser;
  waitForResetAck: () => Promise<void>;
  cancelResetAck: (error?: Error) => void;
  waitForConfigAck: () => Promise<void>;
  cancelConfigAck: (error?: Error) => void;
}

export function createSerialConnectionSession({
  gain,
  channelCount,
  onFrame,
  onInvalidFrame,
  onSwitchAck,
  onSwitchAckError,
  onLoopbackEcho,
}: SerialConnectionSessionOptions): SerialConnectionSession {
  let pendingResetAck: Deferred<void> | null = null;
  let pendingConfigAck: Deferred<void> | null = null;

  const settleResetAck = (error?: Error): void => {
    const pending = pendingResetAck;
    if (!pending) {
      return;
    }

    pendingResetAck = null;
    if (error) {
      pending.reject(error);
    } else {
      pending.resolve(undefined);
    }
  };

  const settleConfigAck = (error?: Error): void => {
    const pending = pendingConfigAck;
    if (!pending) {
      return;
    }

    pendingConfigAck = null;
    if (error) {
      pending.reject(error);
    } else {
      pending.resolve(undefined);
    }
  };

  return {
    parser: new SerialEegProtocolParser(
      {
        onResetAck: (ack) => {
          if (!ack.ok) {
            settleResetAck(createSerialResetAckError(ack));
            return;
          }

          settleResetAck();
        },
        onResetAckError: (line) => {
          settleResetAck(new Error(`Invalid serial initialization reset ACK: ${line}`));
        },
        onConfigAck: (ack) => {
          if (!ack.ok) {
            settleConfigAck(createSerialConfigAckError(ack));
            return;
          }

          settleConfigAck();
        },
        onConfigAckError: (line) => {
          settleConfigAck(new Error(`Invalid serial hardware config ACK: ${line}`));
        },
        onSwitchAck,
        onSwitchAckError,
        onLoopbackEcho: (echo) => {
          settleResetAck(createSerialLoopbackEchoError(echo));
          settleConfigAck(createSerialLoopbackEchoError(echo));
          onLoopbackEcho?.(echo);
        },
        onFrame,
        onInvalidFrame,
      },
      { gain, channelCount },
    ),
    waitForResetAck: () => {
      if (pendingResetAck) {
        throw new Error('Serial initialization reset ACK is already pending.');
      }

      pendingResetAck = createDeferred<void>();
      return pendingResetAck.promise;
    },
    cancelResetAck: (error = new Error('Serial initialization reset ACK cancelled.')) => {
      settleResetAck(error);
    },
    waitForConfigAck: () => {
      if (pendingConfigAck) {
        throw new Error('Serial hardware config ACK is already pending.');
      }

      pendingConfigAck = createDeferred<void>();
      return pendingConfigAck.promise;
    },
    cancelConfigAck: (error = new Error('Serial hardware config ACK cancelled.')) => {
      settleConfigAck(error);
    },
  };
}

export function createSerialLoopbackEchoError(echo: SerialEegLoopbackEcho): Error {
  const matchDetail = echo.exactMatch ? 'exact outbound command echo' : 'frontend command upstream';
  return new Error(
    `Serial loopback/echo detected: command=${echo.command}, ${matchDetail}, line=${echo.line}`,
  );
}

function createDeferred<T>(): Deferred<T> {
  let resolve: Deferred<T>['resolve'] = () => undefined;
  let reject: Deferred<T>['reject'] = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createSerialResetAckError(ack: SerialInitializationResetAck): Error {
  const detail = ack.ok
    ? 'unexpected OK=false state'
    : `code=${ack.errorCode ?? 'UNKNOWN'}, reason=${ack.errorReason ?? 'unknown'}`;
  return new Error(`Serial initialization reset rejected: seq=${ack.seq}, ${detail}`);
}

function createSerialConfigAckError(ack: SerialHardwareConfigAck): Error {
  const detail = ack.ok
    ? 'unexpected OK=false state'
    : `code=${ack.errorCode ?? 'UNKNOWN'}, reason=${ack.errorReason ?? 'unknown'}`;
  return new Error(`Serial hardware config rejected: seq=${ack.seq}, ${detail}`);
}
