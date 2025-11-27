"use client";

import { useEffect, useState } from "react";

import { ProviderIcon } from "@/components/provider-icon";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { PROVIDER_LABEL, STATUS_META } from "@/lib/core/status";
import type { TimelineItem } from "@/lib/types";
import { cn, formatLocalTime } from "@/lib/utils";

interface StatusTimelineProps {
  /** 时间线条目列表，通常为最近 60 条按时间倒序的检测结果 */
  items: TimelineItem[];
  /** 距离下一次轮询刷新的剩余毫秒数，用于展示倒计时徽标 */
  nextRefreshInMs?: number | null;
}

/** 时间线最多绘制的片段数量，对应每个 Provider 保留的历史点数上限 */
const SEGMENT_LIMIT = 60;
const formatRemainingTime = (ms: number) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}分${seconds.toString().padStart(2, "0")}秒`;
  }
  return `${seconds}秒`;
};

const formatLatency = (value: number | null | undefined) =>
  typeof value === "number" ? `${value} ms` : "—";

/**
 * 单个 Provider 的状态时间线
 * 使用固定长度的分段条展示最近若干次检测的成功/降级/失败情况
 */
export function StatusTimeline({ items, nextRefreshInMs }: StatusTimelineProps) {
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [activeSegmentKey, setActiveSegmentKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(pointer: coarse)");
    const updatePointerType = () => {
      const hasTouch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
      const nextIsCoarse = media.matches || hasTouch;
      setIsCoarsePointer((prev) => {
        if (prev && !nextIsCoarse) {
          setActiveSegmentKey(null);
        }
        return nextIsCoarse;
      });
    };

    updatePointerType();
    media.addEventListener("change", updatePointerType);

    return () => media.removeEventListener("change", updatePointerType);
  }, []);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
        该模型处于维护状态。
      </div>
    );
  }

  const segments = Array.from({ length: SEGMENT_LIMIT }, (_, index) =>
    items[index] ?? null
  );
  const nextRefreshLabel =
    typeof nextRefreshInMs === "number" ? formatRemainingTime(nextRefreshInMs) : null;

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-white/5 via-transparent to-white/5 blur-xl" />
        <div className="relative h-7 w-full border border-border/60 bg-background/80 shadow-inner">
          <div className="flex h-full w-full flex-row-reverse gap-px">
            {segments.map((segment, index) => {
              if (!segment) {
                return (
                  <div
                    key={`placeholder-${index}`}
                    className="flex-1 bg-border/70"
                    aria-label="未采样"
                  />
                );
              }

              const preset = STATUS_META[segment.status];
              const formattedTime = formatLocalTime(segment.checkedAt);
              const segmentKey = `${segment.id}-${segment.checkedAt}`;
              const isOpen = activeSegmentKey === segmentKey;

              return (
                <HoverCard
                  key={segmentKey}
                  open={isOpen}
                  openDelay={isCoarsePointer ? 0 : 120}
                  onOpenChange={(nextOpen) =>
                    setActiveSegmentKey(nextOpen ? segmentKey : null)
                  }
                >
                  <HoverCardTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "relative block h-full w-full flex-1 transition-all duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/60",
                        preset?.dot
                      )}
                      aria-label={`${formattedTime} · ${preset.label} · 对话 ${formatLatency(
                        segment.latencyMs
                      )} · Ping ${formatLatency(segment.pingLatencyMs)}`}
                      onClick={() =>
                        setActiveSegmentKey((current) =>
                          current === segmentKey ? null : segmentKey
                        )
                      }
                    />
                  </HoverCardTrigger>
                  <HoverCardContent
                    side="top"
                    className="w-60 space-y-1 rounded-xl border border-border/80 p-3 text-[11px] text-foreground shadow-lg shadow-black/30 backdrop-blur"
                  >
                    <p className="text-xs font-semibold">
                      {preset.label} · {formattedTime}
                    </p>
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <ProviderIcon type={segment.type} size={14} />
                      {PROVIDER_LABEL[segment.type]}
                      <span className="font-mono text-foreground">{segment.model}</span>
                    </p>
                    <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                      <span>对话首字 {formatLatency(segment.latencyMs)}</span>
                      <span>端点 Ping {formatLatency(segment.pingLatencyMs)}</span>
                    </div>
                    <p className="line-clamp-3 text-[11px] text-foreground">
                      {segment.message}
                    </p>
                  </HoverCardContent>
                </HoverCard>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground">
        <span>最早</span>
        {nextRefreshLabel ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary/80">
            下次刷新 {nextRefreshLabel}
          </span>
        ) : (
          <span className="text-muted-foreground/70">手动刷新</span>
        )}
        <span>最近</span>
      </div>
    </div>
  );
}
