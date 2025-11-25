"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ProviderIcon } from "@/components/provider-icon";
import { StatusTimeline } from "@/components/status-timeline";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { ProviderTimeline } from "@/lib/types";
import type { GroupDashboardData } from "@/lib/core/group-data";
import { PROVIDER_LABEL, STATUS_META, OFFICIAL_STATUS_META } from "@/lib/core/status";
import { cn, formatLocalTime } from "@/lib/utils";

interface GroupDashboardViewProps {
  groupName: string;
  initialData: GroupDashboardData;
}

/** 计算所有 Provider 中最近一次检查的时间戳（毫秒） */
const getLatestCheckTimestamp = (timelines: ProviderTimeline[]) => {
  const timestamps = timelines.map((timeline) =>
    new Date(timeline.latest.checkedAt).getTime()
  );
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
};

const computeRemainingMs = (
  pollIntervalMs: number | null | undefined,
  latestCheckTimestamp: number | null,
  clock: number = Date.now()
) => {
  if (!pollIntervalMs || pollIntervalMs <= 0 || latestCheckTimestamp === null) {
    return null;
  }
  const remaining = pollIntervalMs - (clock - latestCheckTimestamp);
  return Math.max(0, remaining);
};

const formatLatency = (value: number | null | undefined) =>
  typeof value === "number" ? `${value} ms` : "—";

/** Provider 卡片组件 */
function ProviderCard({
  timeline,
  timeToNextRefresh,
  isCoarsePointer,
  activeOfficialCardId,
  setActiveOfficialCardId,
}: {
  timeline: ProviderTimeline;
  timeToNextRefresh: number | null;
  isCoarsePointer: boolean;
  activeOfficialCardId: string | null;
  setActiveOfficialCardId: (id: string | null) => void;
}) {
  const { id, latest, items } = timeline;
  const preset = STATUS_META[latest.status];
  const officialStatus = latest.officialStatus;
  const officialStatusMeta = officialStatus
    ? OFFICIAL_STATUS_META[officialStatus.status]
    : null;

  return (
    <Card
      key={id}
      className="relative z-0 border bg-card/80 shadow-lg shadow-primary/5 transition hover:z-20 hover:border-primary/40 focus-within:z-20"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
        <div className="absolute inset-y-0 right-[-30%] h-[200%] w-[60%] rounded-full bg-gradient-to-tr from-primary/10 via-transparent to-transparent blur-3xl" />
      </div>
      <CardHeader className="relative z-10 gap-5 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/70">
            <ProviderIcon type={latest.type} size={22} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <CardTitle className="text-lg">{latest.name}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {PROVIDER_LABEL[latest.type]} ·{" "}
              <span className="font-mono">{latest.model}</span>
            </p>
          </div>
          <Badge variant={preset.badge} className="text-xs">
            {preset.label}
          </Badge>
        </div>

        <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
              最近检查
            </p>
            <p className="mt-1 text-foreground">
              {formatLocalTime(latest.checkedAt)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
              对话首字
            </p>
            <p className="mt-1 text-foreground">
              {formatLatency(latest.latencyMs)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
              端点 Ping
            </p>
            <p className="mt-1 text-foreground">
              {formatLatency(latest.pingLatencyMs)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
              官方状态
            </p>
            <p className="mt-1 text-foreground">
              {officialStatus && officialStatusMeta ? (
                <HoverCard
                  openDelay={isCoarsePointer ? 0 : 200}
                  open={
                    isCoarsePointer
                      ? activeOfficialCardId === id
                      : undefined
                  }
                  onOpenChange={
                    isCoarsePointer
                      ? (nextOpen) =>
                          setActiveOfficialCardId(nextOpen ? id : null)
                      : undefined
                  }
                >
                  <HoverCardTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-sm font-medium transition hover:border-border/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60",
                        officialStatusMeta.color
                      )}
                      aria-label={`官方状态：${officialStatusMeta.label}，点按查看详情`}
                      onClick={
                        isCoarsePointer
                          ? () => {
                              setActiveOfficialCardId(
                                activeOfficialCardId === id ? null : id
                              );
                            }
                          : undefined
                      }
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-current"
                        aria-hidden="true"
                      />
                      {officialStatusMeta.label}
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent className="space-y-2 text-sm">
                    <div>
                      <p className="text-base font-medium text-foreground">
                        {officialStatusMeta.label}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        最近更新：{formatLocalTime(officialStatus.checkedAt)}
                      </p>
                    </div>
                    <p className="text-sm text-foreground">
                      {officialStatus.message || "暂无官方说明"}
                    </p>
                    {officialStatus.affectedComponents &&
                      officialStatus.affectedComponents.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">
                            受影响组件
                          </p>
                          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground">
                            {officialStatus.affectedComponents.map((component, index) => (
                              <li key={`${component}-${index}`}>{component}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                  </HoverCardContent>
                </HoverCard>
              ) : (
                <span className="text-gray-500">—</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
              检测次数
            </p>
            <p className="mt-1 text-foreground">{items.length} 次检测</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="relative z-10 border-t border-border/60 pt-4">
        <StatusTimeline items={items} nextRefreshInMs={timeToNextRefresh} />
      </CardContent>
    </Card>
  );
}

/**
 * 分组 Dashboard 视图
 * - 展示单个分组内的所有 Provider 卡片
 * - 支持客户端定时刷新
 */
export function GroupDashboardView({ groupName, initialData }: GroupDashboardViewProps) {
  const [data, setData] = useState(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const lockRef = useRef(false);
  const [timeToNextRefresh, setTimeToNextRefresh] = useState<number | null>(() =>
    computeRemainingMs(
      initialData.pollIntervalMs,
      getLatestCheckTimestamp(initialData.providerTimelines),
      initialData.generatedAt
    )
  );
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [activeOfficialCardId, setActiveOfficialCardId] = useState<string | null>(null);
  const latestCheckTimestamp = useMemo(
    () => getLatestCheckTimestamp(data.providerTimelines),
    [data.providerTimelines]
  );

  const refresh = useCallback(async () => {
    if (lockRef.current) {
      return;
    }
    lockRef.current = true;
    setIsRefreshing(true);
    try {
      const response = await fetch(`/api/group/${encodeURIComponent(groupName)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("刷新数据失败");
      }
      const next = (await response.json()) as GroupDashboardData;
      setData(next);
    } catch (error) {
      console.error("[check-cx] 分组自动刷新失败", error);
    } finally {
      setIsRefreshing(false);
      lockRef.current = false;
    }
  }, [groupName]);

  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(pointer: coarse)");

    const updatePointerType = () => {
      const hasTouch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
      setIsCoarsePointer(media.matches || hasTouch);
    };

    updatePointerType();
    media.addEventListener("change", updatePointerType);

    return () => media.removeEventListener("change", updatePointerType);
  }, []);

  useEffect(() => {
    if (!isCoarsePointer) {
      setActiveOfficialCardId(null);
    }
  }, [isCoarsePointer]);

  useEffect(() => {
    if (!data.pollIntervalMs || data.pollIntervalMs <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, data.pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [data.pollIntervalMs, refresh]);

  useEffect(() => {
    if (!data.pollIntervalMs || data.pollIntervalMs <= 0 || latestCheckTimestamp === null) {
      setTimeToNextRefresh(null);
      return;
    }

    const updateCountdown = () => {
      setTimeToNextRefresh(
        computeRemainingMs(data.pollIntervalMs, latestCheckTimestamp)
      );
    };

    updateCountdown();
    const countdownTimer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(countdownTimer);
  }, [data.pollIntervalMs, latestCheckTimestamp]);

  const { providerTimelines, total, lastUpdated, pollIntervalLabel, displayName } = data;
  const lastUpdatedLabel = useMemo(
    () => (lastUpdated ? formatLocalTime(lastUpdated) : null),
    [lastUpdated]
  );

  // 根据卡片数量决定宽屏列数
  const gridColsClass = useMemo(() => {
    if (total > 4) {
      return "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3";
    }
    return "grid-cols-1 lg:grid-cols-2";
  }, [total]);

  // 计算状态统计
  const statusSummary = useMemo(() => {
    const counts = { operational: 0, degraded: 0, failed: 0, maintenance: 0 };
    for (const timeline of providerTimelines) {
      const status = timeline.latest.status;
      if (status in counts) {
        counts[status as keyof typeof counts]++;
      }
    }
    return counts;
  }, [providerTimelines]);

  return (
    <>
      <header className="rounded-3xl border bg-card/70 p-8 shadow-sm backdrop-blur-sm">
        <div className="space-y-2">
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <span className="relative flex h-4 w-4 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            分组视图
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {displayName}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{total} 个配置</span>
            {statusSummary.operational > 0 && (
              <Badge variant="success" className="text-xs">
                {statusSummary.operational} 正常
              </Badge>
            )}
            {statusSummary.degraded > 0 && (
              <Badge variant="warning" className="text-xs">
                {statusSummary.degraded} 延迟
              </Badge>
            )}
            {statusSummary.failed > 0 && (
              <Badge variant="danger" className="text-xs">
                {statusSummary.failed} 异常
              </Badge>
            )}
            {statusSummary.maintenance > 0 && (
              <Badge variant="secondary" className="text-xs">
                {statusSummary.maintenance} 维护
              </Badge>
            )}
          </div>
          {lastUpdatedLabel ? (
            <p className="text-sm text-muted-foreground">
              最近更新：{lastUpdatedLabel} · 数据每 {pollIntervalLabel} 自动刷新{" "}
              {isRefreshing && <span className="text-primary">（同步中…）</span>}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              该分组下暂无检测记录
            </p>
          )}
        </div>
      </header>

      {total === 0 ? (
        <Card className="border-dashed bg-card/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              该分组下暂无配置
            </CardTitle>
          </CardHeader>
        </Card>
      ) : (
        <section className={`grid gap-6 ${gridColsClass}`}>
          {providerTimelines.map((timeline) => (
            <ProviderCard
              key={timeline.id}
              timeline={timeline}
              timeToNextRefresh={timeToNextRefresh}
              isCoarsePointer={isCoarsePointer}
              activeOfficialCardId={activeOfficialCardId}
              setActiveOfficialCardId={setActiveOfficialCardId}
            />
          ))}
        </section>
      )}
    </>
  );
}
