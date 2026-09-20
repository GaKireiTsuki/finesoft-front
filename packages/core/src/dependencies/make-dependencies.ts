import type { Logger, LoggerFactory } from "../logger/types";
import type { EventRecorder } from "../metrics/types";
import type { LocaleAttributes, Translator } from "../i18n/types";
import type { PlatformInfo } from "../utils/platform";
import { createToken } from "./token";
// ===== 重新导出 Logger 类型 =====
export type { Logger, LoggerFactory };
export type { TranslationMessages } from "../i18n/messages";

// ===== 依赖接口 =====

/** 存储接口 */
export interface Storage {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
}

/** Feature Flags */
export interface FeatureFlags {
    isEnabled(key: string): boolean;
    getString(key: string): string | undefined;
    getNumber(key: string): number | undefined;
}

/** Feature Flags Provider — 用于从远程/外部源加载 flags */
export interface FeatureFlagsProvider {
    isEnabled(key: string): boolean;
    getString?(key: string): string | undefined;
    getNumber?(key: string): number | undefined;
}

// ===== Service tokens =====

export const DEP_KEYS = {
    LOGGER: createToken<Logger>("logger"),
    LOGGER_FACTORY: createToken<LoggerFactory>("loggerFactory"),
    STORAGE: createToken<Storage>("storage"),
    FEATURE_FLAGS: createToken<FeatureFlags>("featureFlags"),
    FETCH: createToken<typeof globalThis.fetch>("fetch"),
    /**
     * `fetch` 包了 SSRF 防护（拒绝 private / loopback / 保留 IP + DNS resolve 后逐 IP 校验）。
     * 当 controller 用用户可控的 URL 发起请求（图片代理、链接预览、回调等），
     * 优先 resolve 这个 key 而不是 `FETCH`。要 opt-out 可手动调 `secureFetch(baseFetch, { allowInternalHosts: true })`。
     */
    SAFE_FETCH: createToken<typeof globalThis.fetch>("safeFetch"),
    EVENT_RECORDER: createToken<EventRecorder>("eventRecorder"),
    LOCALE: createToken<LocaleAttributes>("locale"),
    PLATFORM: createToken<PlatformInfo>("platform"),
    TRANSLATOR: createToken<Translator>("translator"),
} as const;
