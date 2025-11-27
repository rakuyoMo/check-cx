# Check CX 架构概览

本项目是基于 **Next.js App Router + Supabase** 的 AI 对话健康监控面板，整体数据流为：

> Provider 检查 → 写入 Supabase → 聚合历史快照 → API 输出 → 前端可视化

本文档从架构视角说明关键模块及它们之间的协作关系。

## 1. 运行时组件

- **Next.js 应用层**
  - `app/page.tsx`：服务端渲染首页，调用 `loadDashboardData("missing")` 获取首屏数据。
  - `app/api/dashboard/route.ts`：提供 `/api/dashboard` JSON 接口，前端轮询时调用。
  - `app/layout.tsx`：在 RootLayout 级别引入 `@/lib/core/poller`，以便在服务器侧初始化后台轮询器。

- **后台轮询器（Server 端常驻任务）**
  - 入口：`lib/core/poller.ts`
  - 通过 `globalThis.__checkCxPoller` 确保在 Next.js 热更新/多次导入场景下只存在一个 `setInterval`。
  - 周期性执行：
    1. 从 Supabase 读取启用的 `check_configs`
    2. 调用 `lib/providers` 下具体 Provider 检查实现
    3. 将结果写入 `check_history`，并按 Provider 限制为最近 60 条

- **官方状态轮询器**
  - 入口：`lib/core/official-status-poller.ts`
  - 独立于业务检测结果，按 `OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS` 定期拉取各 Provider 的官方状态页。
  - 结果缓存在内存 `Map<ProviderType, OfficialStatusResult>` 中，由 `loadDashboardData` 在聚合时挂载到最新一次检查结果上。

- **Supabase 数据库**
  - 表 `check_configs`：检测目标配置（endpoint / model / api_key / enabled）。
  - 表 `check_history`：检测历史明细，按 `config_id` 关联配置。

## 2. 核心数据流

1. **配置加载**
   - `lib/database/config-loader.ts` 使用 `createClient()` 访问 Supabase，读取 `enabled = true` 的 `check_configs`。
   - 返回的行数据被组装为 `ProviderConfig`，供 Provider 检查模块使用。

2. **健康检查执行**
   - `lib/providers/index.ts#runProviderChecks` 根据 `ProviderConfig.type` 调用：
     - `checkOpenAI(config)`（`lib/providers/openai.ts`）
     - `checkGemini(config)`（`lib/providers/gemini.ts`）
     - `checkAnthropic(config)`（`lib/providers/anthropic.ts`）
   - 检查实现遵循统一的 `CheckResult` 结构，包含：
     - 对话首字延迟 `latencyMs`
     - 端点 Ping 延迟 `pingLatencyMs`
     - 健康状态 `status`（`operational/degraded/failed`）

3. **历史记录写入与裁剪**
   - `lib/database/history.ts#appendHistory` 负责将本轮 `CheckResult` 写入 `check_history` 表。
   - 写入后调用 `cleanupOldHistory()`，按 `MAX_POINTS_PER_PROVIDER = 60` 清理各 Provider 多余的旧记录。

4. **Dashboard 数据聚合**
   - `lib/core/dashboard-data.ts#loadDashboardData`：
     - 从数据库读取历史快照 `HistorySnapshot`。
     - 根据 `refreshMode` 决定是否触发一次新的 Provider 检查。
     - 计算：
       - `providerTimelines`: 每个 Provider 的时间线（最新在前）
       - `lastUpdated`：全局最近一次检查时间
       - `pollIntervalLabel/pollIntervalMs`：检查间隔配置
       - `generatedAt`：本次聚合的服务器时间戳（用于前端倒计时）
     - 将官方状态缓存（如 OpenAI / Anthropic 状态页）挂载到各 Provider 的 `latest.officialStatus` 上。

5. **前端展示与轮询**
   - `components/dashboard-view.tsx`：
     - 首屏使用 SSR 注入的 `initialData` 渲染 Dashboard。
     - 依据 `pollIntervalMs` 启动 `setInterval` 定时调用 `/api/dashboard` 刷新数据。
     - 使用 `generatedAt` 与最近一次 `checkedAt` 计算“距离下一次刷新”的倒计时。
   - `components/status-timeline.tsx`：
     - 将每个 Provider 最近最多 60 条记录压缩为固定长度的时间线条。
     - 使用颜色/Tooltip 展示成功、降级、失败与延迟信息。

## 3. 模块边界与职责

- `lib/core/`
  - `poller.ts`：后台轮询主循环，负责调度 Provider 检查和历史写入。
  - `dashboard-data.ts`：只读聚合层，负责将历史快照与配置转换为前端可用的 `DashboardData`。
  - `global-state.ts`：对 `globalThis` 上的轮询器状态和缓存进行封装，避免直接操作全局变量。
  - `polling-config.ts`：统一解析轮询相关环境变量，包含检查间隔和官方状态检查间隔。
  - `status.ts`：健康状态枚举及 UI 文案配置（badge 样式、颜色等）。

- `lib/providers/`
  - 各 Provider 文件实现特定 API 的“最小健康检查”，以**流式接口 + 最小 token**为主，避免引入额外负载。
  - `stream-check.ts` 提供通用的流式检测逻辑，Gemini 等 Provider 在其基础上实现自定义流解析。
  - `endpoint-ping.ts` 独立测量 HTTP Origin 的 Ping 延迟，用于区分“模型本身慢”与“网络/网关慢”。

- `lib/database/`
  - 与业务无关的数据库访问逻辑，统一通过 `createClient()` 访问 Supabase。
  - 通过 `historySnapshotStore` 暴露 `fetch/append/prune` 等接口，隐藏 RPC/SQL 细节。
- `lib/core/health-snapshot-service.ts`
  - 负责把 `historySnapshotStore`、`runProviderChecks`、缓存与官方状态粘合在一起。
  - 对 Dashboard 与分组 API 暴露 `loadSnapshotForScope`、`buildProviderTimelines`，彻底避免重复实现。

- `lib/official-status/`
  - 封装 OpenAI / Anthropic 等官方状态接口的调用与解析，将复杂的 JSON 响应映射为 `OfficialStatusResult`。
  - 通过 `checkOfficialStatus` / `checkAllOfficialStatuses` 提供统一调用入口。

- `lib/types/` 与 `lib/utils/`
  - 所有业务相关类型从 `lib/types/index.ts` 单点输出，避免跨模块循环依赖。
  - 常用工具函数（`cn`、`appendQuery`、`formatLocalTime`、`logError` 等）集中在 `lib/utils` 下，防止散落小工具函数。

## 4. 缓存与并发设计

- **轮询幂等性**
  - 通过 `global-state.ts` 中的 `isPollerRunning()` 和 `getPollerTimer()` 确保：
    - 在单个 Node.js 进程内不会同时运行两轮检测。
    - 在 Next.js 热重载时不会重复注册 `setInterval`。

- **历史缓存**
  - `PingCacheEntry` 目前用于缓存最近一次聚合过的历史快照，并通过键 `pollIntervalMs + providerIds` 进行区分。
  - 当短时间内多次请求 Dashboard API 时，可以复用上一次检测结果，避免在 poll 间隔内重复触发完整轮询。

- **官方状态缓存**
  - 官方状态只依赖远程状态页，与具体配置无关。
  - 通过 `officialStatusCache` 存放在内存中，减少对外部状态 API 的压力。

## 5. 扩展与演进建议

- 新增 Provider 时：
  - 在 `lib/types/provider.ts` 中扩展 `ProviderType` 和 `DEFAULT_ENDPOINTS`。
  - 在 `lib/providers/<name>.ts` 中实现检查函数，并在 `lib/providers/index.ts` 的 `checkProvider` / `runProviderChecks` 中接入。
  - 如果该 Provider 有官方状态页，可在 `lib/official-status` 下增加对应解析器并在 `checkOfficialStatus` 中注册。

- 观测与告警：
  - 当前通过 `console.log` 输出详细的轮询日志，适合接入托管平台日志面板。
  - 企业级场景可以进一步对接 APM/日志系统（如 Datadog、Grafana Loki），将 `CheckResult` 聚合为指标用于告警。

更多运维与排障细节见 `docs/OPERATIONS.md`，扩展 Provider 的具体步骤见 `docs/EXTENDING_PROVIDERS.md`。
