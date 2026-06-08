# Agent 注意事项

本仓库是一个用于 EEG Web Serial 工作流的静态 React + TypeScript + Vite 应用。不要将其改造为后端/服务端应用。生产部署为 `dist/` 的静态托管。

当前启用的连接实现只有串口。`src/transport/` 保留内部连接抽象和共享 EEG 帧协议工具，未来桥接传输应接入同一条样本流水线；当前版本不要引入任何 Web Bluetooth/GATT/Notify 代码。

## 命令

```bash
npm install
npm run dev
npm run typecheck
npm run test:unit
npm test
npm run build
npm run preview
```

运行单个测试文件：`npx vitest run tests/serialEegProtocol.test.ts`。按名称运行单个测试：`npx vitest run -t "<名称>"`。

Web Serial 行为需要在 Chrome/Edge 上通过 `localhost`、`127.0.0.1` 或 HTTPS 配合真实硬件手动测试。

## 架构

流水线：`requestSerialPort → openSerialPort → 发送 EEGRST → 发送 EEGCFG → 发送 SW,START → 串口 EEG 协议解析 → CSV（跳过前 40s）+ FFT 分析 + EI / focus 判定`。

状态分离（关键）：Zustand 仅存储**可序列化的 UI 状态**。`useAcquisitionActions()` 以 ref 方式持有不可序列化的对象：`SerialPort`、reader、串口解析器、`FileSystemWritableFileStream` 和 `EegFrequencyAnalyzer` 实例。切勿将这些放入 `src/store/eegStore.ts`。

### 关键目录

- `src/serial/` — 所有 `navigator.serial` 访问、串口协议、硬件配置和采集开关
- `src/transport/` — 内部连接抽象、共享 EEG 通道/硬件参数和二进制帧协议工具；当前只启用 `serial`
- `src/hooks/useAcquisitionActions.ts` — 串口状态机、连接超时、ref 持有的对象
- `src/store/eegStore.ts` — 公开 UI 状态、诊断日志、分析历史
- `src/config/eeg.ts` — 采样率、FFT、EI、focus 等通用 EEG 常量
- `src/config/serial.ts` — 串口波特率和 ACK/停滞超时
- `src/analysis/` — 滤波、FFT、频带功率分析
- `src/state/` — `rawWaveformBus.ts` 和 `filteredWaveformBus.ts`（观察者总线）
- `src/i18n.ts` — zh-CN 和 en-US 文案

## 边界与易错点

- 不要重新引入 Web Bluetooth、GATT、Notify、Service UUID 输入或旧 UUID 过滤逻辑。
- 当前采集入口必须走 Web Serial，并且连接前要求硬件参数锁定和采集点位绑定锁定。
- 应用层 EEG 数据使用串口协议输出的通道样本；`eegValue` 取当前 batch 的 ch0/首通道值。
- 实时 EI 趋势在 store 层使用 EMA 平滑（`EEG_ENGAGEMENT_EMA_ALPHA`）；不要对 FFT 频段功率重复平滑。
- 切换滤波器会重建分析器，并有 2 秒窗口填充间隔。不要拼接不兼容的滤波器状态。
- `RawWaveformPanel` 和 `FilteredWaveformPanel` 从观察者总线（`src/state/`）绘制，而非从 store 状态。
- SSVEP 闪烁使用 `requestAnimationFrame` 直接 DOM 操作，避免 60 Hz React 重渲染。

## 验证检查清单

代码变更后：

1. `npm test`
2. `npm run build`
3. 确认连接前必须先确认硬件参数和点位绑定。
4. 确认选择新串口设备会替换当前设备。
5. 确认诊断信息在失败时显示失败阶段和原始错误详情。
6. UI/串口变更时，在 Chrome/Edge 上通过 `localhost` 或 HTTPS + 真实硬件手动测试。
