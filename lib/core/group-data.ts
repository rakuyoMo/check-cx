/**
 * 分组数据加载模块
 *
 * 职责：
 * - 加载指定分组的 Dashboard 数据
 * - 获取所有可用的分组列表
 */
import { loadProviderConfigsFromDB } from "../database/config-loader";
import { runProviderChecks } from "../providers";
import { appendHistory, loadHistory } from "../database/history";
import { getPollingIntervalLabel, getPollingIntervalMs } from "./polling-config";
import { getPingCacheEntry } from "./global-state";
import { ensureOfficialStatusPoller, getOfficialStatus } from "./official-status-poller";
import type {
  ProviderTimeline,
  RefreshMode,
  HistorySnapshot,
  CheckResult,
} from "../types";

// 未分组标识常量
const UNGROUPED_KEY = "__ungrouped__";
const UNGROUPED_DISPLAY_NAME = "未分组";

/**
 * 分组 Dashboard 数据结构
 */
export interface GroupDashboardData {
  groupName: string;
  displayName: string;
  providerTimelines: ProviderTimeline[];
  lastUpdated: string | null;
  total: number;
  pollIntervalLabel: string;
  pollIntervalMs: number;
  generatedAt: number;
}

/**
 * 获取所有可用的分组名称
 */
export async function getAvailableGroups(): Promise<string[]> {
  const allConfigs = await loadProviderConfigsFromDB();
  const groupSet = new Set<string>();

  for (const config of allConfigs) {
    if (config.groupName) {
      groupSet.add(config.groupName);
    }
  }

  // 如果存在未分组的配置，也添加到列表
  const hasUngrouped = allConfigs.some((config) => !config.groupName);
  if (hasUngrouped) {
    groupSet.add(UNGROUPED_KEY);
  }

  return [...groupSet].sort();
}

/**
 * 加载指定分组的 Dashboard 数据
 *
 * @param targetGroupName 目标分组名称（使用 "__ungrouped__" 表示未分组）
 * @param options.refreshMode
 *  - "always"  ：每次请求都触发一次新的检测
 *  - "missing"：仅在历史为空时触发检测（避免首屏空白）
 *  - "never"  ：只读取历史，不触发新的检测
 */
export async function loadGroupDashboardData(
  targetGroupName: string,
  options?: { refreshMode?: RefreshMode }
): Promise<GroupDashboardData | null> {
  ensureOfficialStatusPoller();

  const allConfigs = await loadProviderConfigsFromDB();

  // 筛选指定分组的配置
  const isTargetUngrouped = targetGroupName === UNGROUPED_KEY;
  const groupConfigs = allConfigs.filter((config) => {
    if (isTargetUngrouped) {
      return !config.groupName;
    }
    return config.groupName === targetGroupName;
  });

  // 分组不存在或没有配置
  if (groupConfigs.length === 0) {
    return null;
  }

  // 分离维护中的配置和正常配置
  const maintenanceConfigs = groupConfigs.filter((cfg) => cfg.is_maintenance);
  const activeConfigs = groupConfigs.filter((cfg) => !cfg.is_maintenance);

  const allowedIds = new Set(activeConfigs.map((item) => item.id));
  const pollIntervalMs = getPollingIntervalMs();
  const pollIntervalLabel = getPollingIntervalLabel();
  const providerKey =
    allowedIds.size > 0 ? [...allowedIds].sort().join("|") : "__empty__";
  const cacheKey = `group:${targetGroupName}:${pollIntervalMs}:${providerKey}`;
  const cacheEntry = getPingCacheEntry(cacheKey);

  const filterHistory = (history: HistorySnapshot): HistorySnapshot => {
    if (allowedIds.size === 0) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(history).filter(([id]) => allowedIds.has(id))
    );
  };

  const readFilteredHistory = async () => filterHistory(await loadHistory());

  const refreshHistory = async () => {
    if (allowedIds.size === 0) {
      return {};
    }
    const now = Date.now();
    if (cacheEntry.history && now - cacheEntry.lastPingAt < pollIntervalMs) {
      return cacheEntry.history;
    }
    if (cacheEntry.inflight) {
      return cacheEntry.inflight;
    }

    const inflightPromise = (async () => {
      const results = await runProviderChecks(activeConfigs);
      let nextHistory: HistorySnapshot;
      if (results.length > 0) {
        nextHistory = filterHistory(await appendHistory(results));
      } else {
        nextHistory = await readFilteredHistory();
      }
      cacheEntry.history = nextHistory;
      cacheEntry.lastPingAt = Date.now();
      return nextHistory;
    })();

    cacheEntry.inflight = inflightPromise;
    try {
      return await inflightPromise;
    } finally {
      if (cacheEntry.inflight === inflightPromise) {
        cacheEntry.inflight = undefined;
      }
    }
  };

  let history = await readFilteredHistory();
  const refreshMode = options?.refreshMode ?? "missing";

  if (refreshMode === "always") {
    history = await refreshHistory();
  } else if (
    refreshMode === "missing" &&
    allowedIds.size > 0 &&
    Object.keys(history).length === 0
  ) {
    history = await refreshHistory();
  }

  const mappedTimelines = Object.entries(history).map<ProviderTimeline | null>(
    ([id, items]) => {
      const sorted = [...items].sort(
        (a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()
      );

      if (sorted.length === 0) {
        return null;
      }

      // 附加官方状态到最新的 CheckResult
      const latest = { ...sorted[0] };
      const officialStatus = getOfficialStatus(latest.type);
      if (officialStatus) {
        latest.officialStatus = officialStatus;
      }

      return {
        id,
        items: sorted,
        latest,
      };
    }
  );

  // 为维护中的配置生成虚拟时间线
  const maintenanceTimelines = maintenanceConfigs.map<ProviderTimeline>((config) => {
    const latest: CheckResult = {
      id: config.id,
      name: config.name,
      type: config.type,
      endpoint: config.endpoint,
      model: config.model,
      status: "maintenance",
      latencyMs: null,
      pingLatencyMs: null,
      message: "配置处于维护模式",
      checkedAt: new Date().toISOString(),
      groupName: config.groupName || null,
    };

    // 附加官方状态
    const officialStatus = getOfficialStatus(config.type);
    if (officialStatus) {
      latest.officialStatus = officialStatus;
    }

    return {
      id: config.id,
      items: [],
      latest,
    };
  });

  const providerTimelines = [
    ...mappedTimelines.filter((timeline): timeline is ProviderTimeline => Boolean(timeline)),
    ...maintenanceTimelines,
  ].sort((a, b) => a.latest.name.localeCompare(b.latest.name));

  const allEntries = providerTimelines
    .flatMap((timeline) => timeline.items)
    .sort(
      (a, b) =>
        new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()
    );

  const lastUpdated = allEntries.length ? allEntries[0].checkedAt : null;
  const generatedAt = Date.now();

  return {
    groupName: targetGroupName,
    displayName: isTargetUngrouped ? UNGROUPED_DISPLAY_NAME : targetGroupName,
    providerTimelines,
    lastUpdated,
    total: providerTimelines.length,
    pollIntervalLabel,
    pollIntervalMs,
    generatedAt,
  };
}
