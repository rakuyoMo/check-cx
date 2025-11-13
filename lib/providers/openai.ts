/**
 * OpenAI Provider 健康检查（使用官方 openai SDK）
 */

import OpenAI from "openai";

import type { CheckResult, HealthStatus, ProviderConfig } from "../types";
import { DEFAULT_ENDPOINTS } from "../types";

/**
 * 默认超时时间 (毫秒)
 * 与其他 Provider 保持一致
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 性能降级阈值 (毫秒)
 * 与其他 Provider 保持一致
 */
const DEGRADED_THRESHOLD_MS = 6_000;

/**
 * 从配置的 endpoint 推导 openai SDK 的 baseURL
 *
 * - 支持默认的 https://api.openai.com/v1/chat/completions
 * - 支持自定义 /v1/chat/completions 或 Azure 兼容的 /chat/completions 路径
 */
function deriveOpenAIBaseURL(endpoint: string | null | undefined): string {
  const raw = endpoint || DEFAULT_ENDPOINTS.openai;

  // 去掉查询参数
  const [withoutQuery] = raw.split("?");
  let base = withoutQuery;

  // 去掉 /chat/completions 这类具体路径，保留前缀
  const chatIndex = base.indexOf("/chat/completions");
  if (chatIndex !== -1) {
    base = base.slice(0, chatIndex);
  }

  // 对于标准 OpenAI，确保以 /v1 结尾
  const v1Index = base.indexOf("/v1");
  if (v1Index !== -1) {
    base = base.slice(0, v1Index + "/v1".length);
  } else if (base.includes("api.openai.com")) {
    // 若未显式包含 /v1，但域名是 api.openai.com，则补上 /v1
    base = `${base.replace(/\/$/, "")}/v1`;
  }

  return base;
}

/**
 * 检查 OpenAI API 健康状态（流式）
 */
export async function checkOpenAI(
  config: ProviderConfig
): Promise<CheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  const displayEndpoint = config.endpoint || DEFAULT_ENDPOINTS.openai;

  try {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: deriveOpenAIBaseURL(config.endpoint),
      // 某些代理/网关（例如启用了 Cloudflare「封锁 AI 爬虫」规则的站点）
      // 会对默认的 OpenAI User-Agent（如 `OpenAI/TS ...`）返回 402 Your request was blocked.
      // 这里统一改成一个普通应用的 UA，避免被误判为爬虫。
      defaultHeaders: {
        "User-Agent": "check-cx/0.1.0",
      },
    });

    // 使用 Chat Completions 流式接口进行最小请求
    const stream = await client.chat.completions.create(
      {
        model: config.model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        temperature: 0,
        stream: true,
      },
      { signal: controller.signal }
    );

    // 读取完整的流式响应（内容本身不重要，只要能成功流式返回即可）
    for await (const chunk of stream) {
      // 这里不需要组装完整内容，仅保证流可读
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      chunk.choices?.[0]?.delta?.content;
    }

    const latencyMs = Date.now() - startedAt;
    const status: HealthStatus =
      latencyMs <= DEGRADED_THRESHOLD_MS ? "operational" : "degraded";

    const message =
      status === "degraded"
        ? `响应成功但耗时 ${latencyMs}ms`
        : `流式响应正常 (${latencyMs}ms)`;

    return {
      id: config.id,
      name: config.name,
      type: config.type,
      endpoint: displayEndpoint,
      model: config.model,
      status,
      latencyMs,
      checkedAt: new Date().toISOString(),
      message,
    };
  } catch (error) {
    const err = error as Error & { name?: string };
    const message =
      err?.name === "AbortError" ? "请求超时" : err?.message || "未知错误";

    return {
      id: config.id,
      name: config.name,
      type: config.type,
      endpoint: displayEndpoint,
      model: config.model,
      status: "failed",
      latencyMs: null,
      checkedAt: new Date().toISOString(),
      message,
    };
  } finally {
    clearTimeout(timeout);
  }
}
