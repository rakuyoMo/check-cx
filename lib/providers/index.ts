/**
 * Provider 检查统一入口
 */

import type { CheckResult, ProviderConfig } from "../types";
import { logError, getErrorMessage } from "../utils";
import { checkOpenAI } from "./openai";
import { checkGemini } from "./gemini";
import { checkAnthropic } from "./anthropic";

// 最多尝试 3 次：初始一次 + 2 次重试
const MAX_REQUEST_ABORT_RETRIES = 2;
const FAILURE_CONFIRM_RETRIES = 1;
const REQUEST_ABORTED_PATTERN = /request was aborted\.?/i;

/**
 * 检查单个 Provider
 */
async function checkProvider(config: ProviderConfig): Promise<CheckResult> {
  switch (config.type) {
    case "openai":
      return checkOpenAI(config);
    case "gemini":
      return checkGemini(config);
    case "anthropic":
      return checkAnthropic(config);
    default:
      throw new Error(`Unsupported provider: ${config.type satisfies never}`);
  }
}

function shouldRetryRequestAborted(message: string | undefined): boolean {
  if (!message) {
    return false;
  }
  return REQUEST_ABORTED_PATTERN.test(message);
}

async function checkWithRetry(config: ProviderConfig): Promise<CheckResult> {
  for (let attempt = 0; attempt <= MAX_REQUEST_ABORT_RETRIES; attempt += 1) {
    try {
      const result = await checkProvider(config);
      if (
        result.status === "failed" &&
        shouldRetryRequestAborted(result.message) &&
        attempt < MAX_REQUEST_ABORT_RETRIES
      ) {
        console.warn(
          `[check-cx] ${config.name} 请求异常（Request was aborted），正在重试第 ${
            attempt + 2
          } 次`
        );
        continue;
      }
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      if (
        shouldRetryRequestAborted(message) &&
        attempt < MAX_REQUEST_ABORT_RETRIES
      ) {
        console.warn(
          `[check-cx] ${config.name} 请求异常（Request was aborted），正在重试第 ${
            attempt + 2
          } 次`
        );
        continue;
      }

      logError(`检查 ${config.name} (${config.type}) 失败`, error);
      return {
        id: config.id,
        name: config.name,
        type: config.type,
        endpoint: config.endpoint,
        model: config.model,
        status: "failed",
        latencyMs: null,
        pingLatencyMs: null,
        checkedAt: new Date().toISOString(),
        message,
      };
    }
  }

  // 理论上不会触发，这里仅为类型系统兜底
  throw new Error("Unexpected retry loop exit");
}

/**
 * 批量执行 Provider 健康检查
 * @param configs Provider 配置列表
 * @returns 检查结果列表,按名称排序
 */
export async function runProviderChecks(
  configs: ProviderConfig[]
): Promise<CheckResult[]> {
  if (configs.length === 0) {
    return [];
  }

  const results = await Promise.all(
    configs.map((config) => checkWithRetry(config))
  );

  for (
    let attempt = 0;
    attempt < FAILURE_CONFIRM_RETRIES;
    attempt += 1
  ) {
    const failedIndices = results.reduce<number[]>((acc, result, index) => {
      if (result.status === "failed") {
        acc.push(index);
      }
      return acc;
    }, []);

    if (failedIndices.length === 0) {
      break;
    }

    console.warn(
      `[check-cx] 发现 ${failedIndices.length} 个 Provider 检测失败，触发第 ${
        attempt + 1
      } 次重试确认`
    );

    const retryResults = await Promise.all(
      failedIndices.map((index) => checkWithRetry(configs[index]))
    );

    let hasRemainingFailures = false;
    retryResults.forEach((retryResult, offset) => {
      const resultIndex = failedIndices[offset];
      results[resultIndex] = retryResult;
      if (retryResult.status === "failed") {
        hasRemainingFailures = true;
      }
    });

    if (!hasRemainingFailures) {
      break;
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// 导出各 Provider 的检查函数供外部使用
export { checkOpenAI } from "./openai";
export { checkGemini } from "./gemini";
export { checkAnthropic } from "./anthropic";
