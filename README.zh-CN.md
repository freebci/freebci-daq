# 浏览器 EEG 采集平台

一个静态 React + TypeScript + Vite 浏览器应用，用于通过 Web Serial 采集 EEG。应用会打开串口 EEG 设备，发送 reset/config/start 命令，解析 int24 EEG 帧，可选写入原始 CSV，并实时展示滤波波形、频域分析、EI 专注度和 0/1 focus 状态。

当前唯一启用的连接路径是 `serial`。`src/transport/` 保留内部连接抽象和共享 EEG 帧协议工具，未来桥接传输可以接入同一条解码样本流水线；当前版本不包含 Web Bluetooth/GATT/Notify 工作流。

## 环境要求

- 支持 Web Serial 的 Chrome 或 Edge。
- `localhost`、`127.0.0.1` 或 HTTPS。
- 端到端采集测试需要真实 EEG 串口硬件。
- 启用原始 CSV 写入时需要 File System Access API。

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

运行单个测试文件：

```bash
npx vitest run tests/serialEegProtocol.test.ts
```

## 工作流

1. 确认串口硬件参数。
2. 确认采集点位/通道绑定。
3. 打开串口。
4. 应用发送 `EEGRST`，等待 reset ACK；随后发送硬件配置并等待 config ACK。
5. 开始采集时发送采集启动命令，并解析持续到达的 EEG 帧。
6. CSV、波形总线、FFT 分析、EI、focus、热力图和 AI 五频带特征都消费解码后的样本批次。

每个新数据流的前 40 秒视为初始不可信期，不写入 CSV，也不进入 focus 判定。

## 关键路径

| 区域 | 路径 |
| --- | --- |
| 串口适配器和协议 | `src/serial/` |
| 连接抽象和共享 EEG 帧协议工具 | `src/transport/` |
| 采集 actions 和不可序列化 refs | `src/hooks/useAcquisitionActions.ts` |
| 可序列化 UI/app 状态 | `src/store/eegStore.ts` |
| EEG 分析常量 | `src/config/eeg.ts` |
| 串口常量 | `src/config/serial.ts` |
| FFT/滤波/频域分析 | `src/analysis/` |
| 原始/滤波波形观察者总线 | `src/state/` |

## 状态边界

Zustand 只保存可序列化 UI 状态。`SerialPort`、reader、文件写入流、串口解析器、`EegFrequencyAnalyzer` 实例等运行时对象都放在 `useAcquisitionActions()` 的 ref 中。

## 验证

代码变更后运行：

```bash
npm test
npm run build
```