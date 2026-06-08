# Serial EEG Protocol

This document is the firmware-facing wire protocol implemented by the web frontend. The transport is Web Serial only; no backend service is involved.

Web Serial baudRate: 921600

## Transport

Web Serial open options used by the frontend:

```text
baudRate = 921600
```

Firmware should use UART 8N1, no parity, no flow control. Do not emit debug logs on the same port while the frontend is connected; unknown text on the upstream path is treated as invalid stream bytes.

All text commands and ACKs are ASCII/UTF-8 comma-separated lines terminated by LF (`\n`). The frontend also accepts CRLF (`\r\n`) for firmware ACKs. Binary EEG data frames are not line-delimited.

## Supported Parameters

```text
PROTOCOL_VERSION: 1
SR:   125, 250, 500, 1000, 2000, 4000, 8000
CH:   1, 2, 3, 4, 5, 6, 7, 8
GAIN: 1, 2, 3, 4, 6, 8, 12, 24, 48
RLD:  ON, OFF
AC:   FDR4, 7_8HZ, 31_2HZ, OFF
```

`CH` is the channel count requested by the web frontend. Firmware must crop/pack exactly `CH` channels in channel order `ch0..chN-1` until the next accepted `EEGCFG`.

## Downstream Commands

### Initialization Reset

```text
EEGRST,<version:uint8>
EEGRST,1\n
```

The frontend sends `EEGRST,1\n` immediately after opening the serial port. Firmware must treat it as a hard session reset regardless of its current state: stop acquisition, stop any initialization in progress, clear runtime/config-applied state, discard pending partial packets, and wait for a following `EEGCFG`.

On reset completion, firmware must reply with `EEGRSTACK,<seq>,OK\n`. Firmware must not echo `EEGRST` upstream. Every new frontend serial connection sends `EEGRST` and waits for `EEGRSTACK` before any config is sent, so reconnect means the whole firmware session starts from a clean state.

### Hardware Config

```text
EEGCFG,<version:uint8>,SR=<sampleRateHz>,CH=<channelCount>,GAIN=<gain>,RLD=<ON|OFF>,AC=<FDR4|7_8HZ|31_2HZ|OFF>
EEGCFG,1,SR=250,CH=2,GAIN=24,RLD=ON,AC=FDR4\n
```

On a valid and applied config, firmware replies with `EEGCFGACK,<seq>,OK\n`. The frontend sends one `EEGCFG` during connection after `EEGRSTACK`. The frontend does not send `EEGCFG` again on `SW,START`; if parameters or site/channel bindings change, the user must reconnect so the frontend sends a fresh `EEGRST -> EEGRSTACK -> EEGCFG -> EEGCFGACK` sequence.

Firmware should not start streaming after `EEGCFG`; streaming starts only after `SW,START` is accepted.

### Acquisition Switch

```text
SW,<START|STOP>
SW,START\n
SW,STOP\n
```

On `SW,START`, firmware must start binary data frames only after it has sent `SWACK,<seq>,OK\n`. If no valid config has been applied since reset, reject start with `SWACK,<seq>,ERR,CONFIG_REQUIRED,<reason>\n`.

On `SW,STOP`, firmware should stop binary data output and reply `SWACK,<seq>,OK\n`. If firmware is already stopped or config was cleared, `SWACK,<seq>,ERR,CONFIG_REQUIRED,<reason>\n` is tolerated by the frontend and treated as non-fatal during stop cleanup.

## ACK Lines

```text
EEGRSTACK,<seq>,OK
EEGRSTACK,<seq>,ERR,<code>,<reason>
EEGCFGACK,<seq>,OK
EEGCFGACK,<seq>,ERR,<code>,<reason>
SWACK,<seq>,OK
SWACK,<seq>,ERR,<code>,<reason>
```

ACK grammar is strict:

```text
OK  ACK: exactly 3 comma-separated fields
ERR ACK: exactly 5 comma-separated fields, code and reason non-empty
seq: decimal uint32, 0..4294967295
```

`<seq>` is a firmware-side control ACK sequence for diagnostics. The frontend does not require ACK seq to equal a specific value; it only requires the current pending command to receive the next syntactically valid OK ACK before timeout. `EEGRSTACK`, `EEGCFGACK`, and `SWACK` seq values do not participate in data packet drop accounting.

Frontend timeouts:

```text
EEGRSTACK timeout: 2000 ms
EEGCFGACK timeout: 2000 ms
SWACK timeout:     2000 ms
```

Recommended error codes:

```text
BAD_FORMAT
UNSUPPORTED_VERSION
UNSUPPORTED_SR
UNSUPPORTED_CH
UNSUPPORTED_GAIN
UNSUPPORTED_RLD
UNSUPPORTED_AC
CONFIG_REQUIRED
BUSY
INTERNAL_ERROR
```

The frontend displays unknown error codes as-is.

## Binary EEG Data Frame

```text
byte0      magic0 = 0xA5
byte1      magic1 = 0x5A
byte2      type   = 0x01
byte3..6   seq:uint32 little-endian, data-frame sequence
byte7      count:uint8, samples per packet, valid range 1..64
byte8..    count * CH * int24 little-endian samples
```

Frame length is exactly:

```text
8 + count * CH * 3 bytes
```

There is no checksum, length field, or delimiter. Firmware should send complete frames back-to-back after `SWACK,<seq>,OK\n` for START.

Samples are sample-major:

```text
sample0: ch0, ch1, ... chN-1
sample1: ch0, ch1, ... chN-1
...
```

Each channel value is a signed int24 two's-complement little-endian ADC code, range `-8388608..8388607`. The frontend converts each raw code to volts as:

```text
volts = rawCode * 2.5 / GAIN / 0x7fffff
```

`seq` is only for binary data frames. It should increment by 1 per data frame and wrap naturally from `4294967295` to `0`. The frontend supports uint32 wrap. Backward/stale jumps are not counted as dropped packets, but firmware should keep `seq` monotonic during a stream.

Drop accounting:

```text
expected = previousDataSeq + 1 (uint32 wrap)
gap = actualSeq - expected (uint32 forward distance)
droppedPackets = gap when 0 < gap <= 0x7fffffff, else 0
droppedSamples = droppedPackets * currentFrame.count
```

The frontend resets the data seq baseline when `SWACK,<seq>,OK` for START is received. The first data frame after START establishes the baseline and does not count as dropped, regardless of its seq value.

`count` may vary between frames because it is read from every frame, but firmware should keep it constant within one START..STOP stream so dropped sample estimates are exact. Recommended default: `count = 20`.

Throughput example for 8 channels at 1000 Hz with `count = 20`:

```text
payload = 8 * 1000 * 3 = 24000 bytes/s
packets = 1000 / 20 = 50 packets/s
header  = 50 * 8 = 400 bytes/s
total   = 24400 bytes/s
UART 8N1 line rate ~= 244000 bps
```

This is below the current `921600` baud setting.

## Lead-Off Detection

```text
FDR4:   使用 fDR/4 作为交流脱落检测频率
7_8HZ:  使用 7.8 Hz 作为交流脱落检测频率
31_2HZ: 使用 31.2 Hz 作为交流脱落检测频率
OFF:    关闭脱落检测
```

The frontend does not consume a separate lead-off/status packet. When `AC` is not `OFF`, it runs software detection directly on the streamed EEG samples. When the frontend marks a channel as lead-off, that channel's waveform segment is rendered yellow.

## Frontend Session Timeline

The frontend only opens serial after hardware parameters and site/channel bindings are confirmed. This keeps the `CH` sent during connection aligned with the parser and later CSV/analysis channel list.

Connection:

```text
open serial at 921600
frontend -> EEGRST,1\n
firmware -> EEGRSTACK,<seq>,OK\n
frontend -> EEGCFG,1,SR=...,CH=...,GAIN=...,RLD=...,AC=...\n
firmware -> EEGCFGACK,<seq>,OK\n
frontend marks serial connection ready
```

Start stream:

```text
frontend resets local parser buffer and stale data seq baseline
frontend -> SW,START\n
firmware -> SWACK,<seq>,OK\n
frontend resets data seq baseline
firmware -> binary EEG data frames
```

Stop stream:

```text
frontend -> SW,STOP\n
firmware -> SWACK,<seq>,OK\n
firmware stops binary EEG data frames
```

## Invalid Upstream Data

Firmware must not echo frontend commands upstream. If the frontend reads any upstream text line beginning with `EEGRST,`, `EEGCFG,`, or `SW,`, it reports `Serial loopback/echo detected` and immediately closes the current serial connection.

Unknown text lines, malformed ACK lines, invalid data frame types, invalid `count`, and garbage before magic are recorded as invalid frames. During active streaming they can surface as diagnostics and should be avoided by firmware.
