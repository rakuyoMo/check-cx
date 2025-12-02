/**
 * 历史记录管理模块
 */

import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "../supabase/server";
import type { CheckResult, HistorySnapshot } from "../types";
import { logError } from "../utils";

/**
 * 每个 Provider 最多保留的历史记录数
 */
export const MAX_POINTS_PER_PROVIDER = 60;

const RPC_RECENT_HISTORY = "get_recent_check_history";
const RPC_PRUNE_HISTORY = "prune_check_history";

export interface HistoryQueryOptions {
  allowedIds?: Iterable<string> | null;
}

interface RpcHistoryRow {
  config_id: string;
  status: string;
  latency_ms: number | null;
  ping_latency_ms: number | null;
  checked_at: string;
  message: string | null;
  name: string;
  type: string;
  model: string;
  endpoint: string | null;
  group_name: string | null;
}

/**
 * SnapshotStore 负责与数据库交互，提供统一的读/写/清理接口
 */
class SnapshotStore {
  async fetch(options?: HistoryQueryOptions): Promise<HistorySnapshot> {
    const normalizedIds = normalizeAllowedIds(options?.allowedIds);
    if (Array.isArray(normalizedIds) && normalizedIds.length === 0) {
      return {};
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      RPC_RECENT_HISTORY,
      {
        limit_per_config: MAX_POINTS_PER_PROVIDER,
        target_config_ids: normalizedIds,
      }
    );

    if (error) {
      logError("获取历史快照失败", error);
      if (isMissingFunctionError(error)) {
        return fallbackFetchSnapshot(supabase, normalizedIds);
      }
      return {};
    }

    return mapRowsToSnapshot(data as RpcHistoryRow[] | null);
  }

  async append(results: CheckResult[]): Promise<void> {
    if (results.length === 0) {
      return;
    }

    const supabase = await createClient();
    const records = results.map((result) => ({
      config_id: result.id,
      status: result.status,
      latency_ms: result.latencyMs,
      ping_latency_ms: result.pingLatencyMs,
      checked_at: result.checkedAt,
      message: result.message,
    }));

    const { error } = await supabase.from("check_history").insert(records);
    if (error) {
      logError("写入历史记录失败", error);
      return;
    }

    await this.pruneInternal(supabase);
  }

  async prune(limit: number = MAX_POINTS_PER_PROVIDER): Promise<void> {
    const supabase = await createClient();
    await this.pruneInternal(supabase, limit);
  }

  private async pruneInternal(
    supabase: SupabaseClient<any, string>,
    limit: number = MAX_POINTS_PER_PROVIDER
  ): Promise<void> {
    const { error } = await supabase.rpc(RPC_PRUNE_HISTORY, {
      limit_per_config: limit,
    });

    if (error) {
      logError("清理历史记录失败", error);
      if (isMissingFunctionError(error)) {
        await fallbackPruneHistory(supabase, limit);
      }
    }
  }
}

export const historySnapshotStore = new SnapshotStore();

/**
 * 兼容旧接口：读取全部历史快照
 */
export async function loadHistory(
  options?: HistoryQueryOptions
): Promise<HistorySnapshot> {
  return historySnapshotStore.fetch(options);
}

/**
 * 兼容旧接口：写入并返回最新快照
 */
export async function appendHistory(
  results: CheckResult[]
): Promise<HistorySnapshot> {
  await historySnapshotStore.append(results);
  return historySnapshotStore.fetch();
}

function normalizeAllowedIds(
  ids?: Iterable<string> | null
): string[] | null {
  if (!ids) {
    return null;
  }
  const array = Array.from(ids).filter(Boolean);
  return array.length > 0 ? array : [];
}

function mapRowsToSnapshot(rows: RpcHistoryRow[] | null): HistorySnapshot {
  if (!rows || rows.length === 0) {
    return {};
  }

  const history: HistorySnapshot = {};
  for (const row of rows) {
    const result: CheckResult = {
      id: row.config_id,
      name: row.name,
      type: row.type as CheckResult["type"],
      endpoint: row.endpoint ?? "",
      model: row.model,
      status: row.status as CheckResult["status"],
      latencyMs: row.latency_ms,
      pingLatencyMs: row.ping_latency_ms,
      checkedAt: row.checked_at,
      message: row.message ?? "",
      groupName: row.group_name,
    };

    if (!history[result.id]) {
      history[result.id] = [];
    }
    history[result.id].push(result);
  }

  for (const key of Object.keys(history)) {
    history[key] = history[key]
      .sort(
        (a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()
      )
      .slice(0, MAX_POINTS_PER_PROVIDER);
  }

  return history;
}

function isMissingFunctionError(error: PostgrestError | null): boolean {
  if (!error?.message) {
    return false;
  }
  return (
    error.message.includes(RPC_RECENT_HISTORY) ||
    error.message.includes(RPC_PRUNE_HISTORY)
  );
}

async function fallbackFetchSnapshot(
  supabase: SupabaseClient<any, string>,
  allowedIds: string[] | null
): Promise<HistorySnapshot> {
  try {
    let query = supabase
      .from("check_history")
      .select(
        `
        id,
        config_id,
        status,
        latency_ms,
        ping_latency_ms,
        checked_at,
        message,
        check_configs (
          id,
          name,
          type,
          model,
          endpoint,
          group_name
        )
      `
      )
      .order("checked_at", { ascending: false });

    if (allowedIds) {
      query = query.in("config_id", allowedIds);
    }

    const { data, error } = await query;
    if (error) {
      logError("fallback 模式下读取历史失败", error);
      return {};
    }

    const history: HistorySnapshot = {};
    for (const record of data || []) {
      const configs = record.check_configs;
      if (!configs || !Array.isArray(configs) || configs.length === 0) {
        continue;
      }
      const config = configs[0];

      const result: CheckResult = {
        id: config.id,
        name: config.name,
        type: config.type,
        endpoint: config.endpoint,
        model: config.model,
        status: record.status as CheckResult["status"],
        latencyMs: record.latency_ms,
        pingLatencyMs: record.ping_latency_ms ?? null,
        checkedAt: record.checked_at,
        message: record.message ?? "",
        groupName: config.group_name ?? null,
      };

      if (!history[result.id]) {
        history[result.id] = [];
      }
      history[result.id].push(result);
    }

    for (const key of Object.keys(history)) {
      history[key] = history[key]
        .sort(
          (a, b) =>
            new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()
        )
        .slice(0, MAX_POINTS_PER_PROVIDER);
    }

    return history;
  } catch (error) {
    logError("fallback 模式下读取历史异常", error);
    return {};
  }
}

async function fallbackPruneHistory(
  supabase: SupabaseClient<any, string>,
  limit: number
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("check_history")
      .select("id, config_id, checked_at")
      .order("config_id")
      .order("checked_at", { ascending: false });

    if (error || !data) {
      if (error) {
        logError("fallback 模式下查询历史失败", error);
      }
      return;
    }

    const deleteIds: string[] = [];
    const seen = new Map<string, number>();
    for (const record of data) {
      const count = seen.get(record.config_id) ?? 0;
      if (count >= limit) {
        deleteIds.push(record.id);
      } else {
        seen.set(record.config_id, count + 1);
      }
    }

    if (deleteIds.length === 0) {
      return;
    }

    const { error: deleteError } = await supabase
      .from("check_history")
      .delete()
      .in("id", deleteIds);

    if (deleteError) {
      logError("fallback 模式下删除历史失败", deleteError);
    }
  } catch (error) {
    logError("fallback 模式下清理历史异常", error);
  }
}
