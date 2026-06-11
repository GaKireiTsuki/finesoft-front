/**
 * Navigation — URL 编解码器（Codec）
 *
 * Codec 负责把导航树与 URL 互转。两种内置策略对应两类需求：
 *
 * - `createActiveLeafCodec`（默认）：URL 只反映「激活叶子」（通过 Router 反查 intent+params
 *   生成路径），完整树通过 history.state / hydration 旁路传输。`decode` 把 URL 还原为单个
 *   LeafNode —— 这正是今天的扁平单页行为（向后兼容），除非 URL 上带有结构化覆盖参数（`__nav`），
 *   此时整棵树会被还原。
 * - `createFullStateCodec`：把整棵树编码进一个保留 query 参数（默认 `__nav`），支持完整深链。
 *   `decode` 无损还原整棵树。
 *
 * 两者在各自契约内都健壮且无损。开发者也可实现自定义 `NavigationCodec`。
 *
 * 设计约束（与现有代码库一致）：
 * - `Router.resolve` 是异步的，但 `decode` 契约为同步。因此 `createActiveLeafCodec.decode`
 *   在「无结构化覆盖」时返回 `undefined`，由调用方（controller/runner）用 `await router.resolve(url)`
 *   走异步路径完成 LeafNode 重建（含 codec 校验）—— 这与现有 SSR/CSR runner 的做法一致。
 *   仅当 URL 带 `__nav` 覆盖时，`decode` 才同步还原整棵树。
 * - 反查 URL（encode 的核心）：若运行期传入的 `router` 暴露了 `reverse(intentId, params)`，
 *   则优先使用；否则基于 `router.getRoutes()` 自带一套反查实现，零侵入、向前兼容。
 */

import { stableStringify } from "../prefetched-intents/stable-stringify";
import type { RouteParams } from "../router/types";
import { isLeafNode, leaf, stack } from "./nodes";
import { findNode, resolveActivePath } from "./operations";
import { deserializeNavigation, serializeNavigation } from "./serialization";
import { NavigationError, type NavigationNode } from "./types";

// =====================================================================
// Codec 契约
// =====================================================================

/**
 * Router 的最小读取面 —— codec 只依赖这两个公共方法，避免与 Router 实现耦合。
 * （`reverse` 为可选：若 Router 将来提供则优先使用。）
 */
export interface NavigationRouterLike {
    /** 所有已注册路由的 `"pattern → intentId"` 摘要 */
    getRoutes(): string[];
    /** 可选：把 intentId + 参数反查为 URL（若实现则 encode 优先使用） */
    reverse?(intentId: string, params: RouteParams): string | undefined;
}

/**
 * 导航 URL 编解码器。
 * - `encode`：把导航树映射为 URL。
 * - `decode`：把 URL 还原为导航树；无法（或无需）从 URL 同步还原时返回 `undefined`。
 */
export interface NavigationCodec {
    encode(tree: NavigationNode, router: NavigationRouterLike): string;
    decode(url: string, router: NavigationRouterLike): NavigationNode | undefined;
}

/** 默认结构化覆盖参数名（full-state 编码所用的保留 query key）。 */
export const DEFAULT_NAV_PARAM = "__nav";

// =====================================================================
// 共享：URL 解析 / 反查 / 紧凑编码
// =====================================================================

const URL_BASE = "http://localhost";

/** 解析 URL 为 path + 可变 query（保持插入顺序）。解析失败时退化为手工切分。 */
function parseUrlParts(url: string): { path: string; query: URLSearchParams } {
    try {
        const parsed = new URL(url, URL_BASE);
        return { path: parsed.pathname, query: parsed.searchParams };
    } catch {
        const path = url.split("?")[0].split("#")[0];
        const queryStr = url.includes("?") ? url.slice(url.indexOf("?") + 1).split("#")[0] : "";
        return { path: path || "/", query: new URLSearchParams(queryStr) };
    }
}

/** 把 path + query 组装回相对 URL（query 为空则省略 `?`）。 */
function buildRelativeUrl(path: string, query: URLSearchParams): string {
    const qs = query.toString();
    return qs ? `${path}?${qs}` : path;
}

/**
 * 解析 `router.getRoutes()` 的 `"pattern → intentId"` 摘要为结构化条目。
 * 分隔符是固定的 `" → "`（见 Router.getRoutes），用 `indexOf` 切分以容忍 pattern/intentId 内的字符。
 */
interface ParsedRoute {
    readonly pattern: string;
    readonly intentId: string;
}

const ROUTE_SUMMARY_SEP = " → ";

function parseRouteSummaries(router: NavigationRouterLike): ParsedRoute[] {
    const out: ParsedRoute[] = [];
    for (const summary of router.getRoutes()) {
        const idx = summary.indexOf(ROUTE_SUMMARY_SEP);
        if (idx === -1) continue;
        const pattern = summary.slice(0, idx);
        const intentId = summary.slice(idx + ROUTE_SUMMARY_SEP.length);
        if (pattern && intentId) out.push({ pattern, intentId });
    }
    return out;
}

/** 把 RouteParams 的单个值规范为可放进 URL 的字符串；不可表示的值返回 undefined。 */
function paramToString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string") return value;
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
    if (typeof value === "boolean") return String(value);
    return undefined;
}

/**
 * 基于路由摘要把 intentId + params 反查为 URL。
 * 选第一条 intentId 匹配、且其所有「必填」path 参数都能从 params 取到的 pattern：
 * - 用 params 替换 `:name` / `:name?` 片段（可选段缺失则整段省略）；
 * - 已用于 path 的键不再出现在 query；剩余可序列化的键追加为 query。
 * 没有任何路由匹配时返回 undefined。
 */
function reverseFromRoutes(
    routes: readonly ParsedRoute[],
    intentId: string,
    params: RouteParams,
): string | undefined {
    for (const route of routes) {
        if (route.intentId !== intentId) continue;
        const built = substitutePattern(route.pattern, params);
        if (built) return built;
    }
    return undefined;
}

/** 单条 pattern 的占位替换；任一必填段缺失则返回 undefined（视为不匹配）。 */
function substitutePattern(pattern: string, params: RouteParams): string | undefined {
    const consumed = new Set<string>();
    let ok = true;

    // 切分时保留分隔，逐段处理 `/:name` 与 `/:name?`。
    const path = pattern
        .split(/(\/:[\w]+\??)/)
        .map((segment) => {
            const m = segment.match(/^\/:(\w+)(\?)?$/);
            if (!m) return segment;
            const name = m[1];
            const optional = m[2] === "?";
            const value = paramToString(params[name]);
            if (value === undefined) {
                if (optional) return ""; // 可选段缺失 → 省略
                ok = false;
                return "";
            }
            consumed.add(name);
            return `/${encodeURIComponent(value)}`;
        })
        .join("");

    if (!ok) return undefined;

    const finalPath = path === "" ? "/" : path;

    // 未消费且可序列化的参数追加为 query（保持稳定顺序：按键名排序）。
    const query = new URLSearchParams();
    for (const key of Object.keys(params).sort()) {
        if (consumed.has(key)) continue;
        const value = paramToString(params[key]);
        if (value !== undefined) query.set(key, value);
    }
    return buildRelativeUrl(finalPath, query);
}

/** 反查入口：优先用 Router.reverse（若实现），否则用路由摘要反查。 */
function reverseUrl(
    router: NavigationRouterLike,
    intentId: string,
    params: RouteParams,
): string | undefined {
    if (typeof router.reverse === "function") {
        const viaRouter = router.reverse(intentId, params);
        if (viaRouter !== undefined) return viaRouter;
    }
    return reverseFromRoutes(parseRouteSummaries(router), intentId, params);
}

// =====================================================================
// 紧凑、URL 安全、稳定的整树编码（full-state）
// =====================================================================

/**
 * 把整棵树编码为紧凑、URL 安全、确定性的字符串。
 * 用 `serializeNavigationStable`（keys 排序）保证相同树产出相同串，再做 base64url。
 */
export function encodeNavigationTreeParam(tree: NavigationNode): string {
    const stable = stableStringify(serializeNavigation(tree));
    return base64UrlEncode(stable);
}

/**
 * 还原 `encodeNavigationTreeParam` 的输出为导航树；畸形输入抛 NavigationError。
 */
export function decodeNavigationTreeParam(encoded: string): NavigationNode {
    let json: string;
    try {
        json = base64UrlDecode(encoded);
    } catch {
        throw new NavigationError("导航参数解码失败：非法的 base64url");
    }
    let data: unknown;
    try {
        data = JSON.parse(json);
    } catch {
        throw new NavigationError("导航参数解码失败：非法的 JSON");
    }
    return deserializeNavigation(data);
}

/** UTF-8 安全的 base64url 编码（无 padding，`+/` → `-_`）。 */
function base64UrlEncode(input: string): string {
    const bytes = utf8Encode(input);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 = base64FromBinary(binary);
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url 解码回 UTF-8 字符串。 */
function base64UrlDecode(input: string): string {
    const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const binary = binaryFromBase64(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return utf8Decode(bytes);
}

// —— base64 ⇄ binary：优先平台原生（btoa/atob / Buffer），保证跨 SSR/CSR 一致 ——

function base64FromBinary(binary: string): string {
    if (typeof btoa === "function") return btoa(binary);
    return bufferFrom(binary, "binary").toString("base64");
}

function binaryFromBase64(base64: string): string {
    if (typeof atob === "function") return atob(base64);
    return bufferFrom(base64, "base64").toString("binary");
}

/** 仅在无 btoa/atob（Node）时使用；运行期取 globalThis.Buffer，不静态依赖 node:buffer。 */
function bufferFrom(
    input: string,
    encoding: "binary" | "base64",
): { toString(enc: string): string } {
    const buffer = (globalThis as { Buffer?: BufferLike }).Buffer;
    if (!buffer) {
        throw new NavigationError("导航参数编解码失败：当前运行时缺少 base64 能力");
    }
    return buffer.from(input, encoding);
}

interface BufferLike {
    from(input: string, encoding: string): { toString(enc: string): string };
}

// —— UTF-8 ⇄ bytes：优先 TextEncoder/TextDecoder，回退手工实现 ——

function utf8Encode(input: string): Uint8Array {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(input);
    const bytes: number[] = [];
    for (const ch of input) {
        let code = ch.codePointAt(0) as number;
        if (code < 0x80) {
            bytes.push(code);
        } else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0x10000) {
            bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        } else {
            bytes.push(
                0xf0 | (code >> 18),
                0x80 | ((code >> 12) & 0x3f),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f),
            );
        }
    }
    return Uint8Array.from(bytes);
}

function utf8Decode(bytes: Uint8Array): string {
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
    let out = "";
    for (let i = 0; i < bytes.length; ) {
        const b0 = bytes[i++];
        if (b0 < 0x80) {
            out += String.fromCodePoint(b0);
        } else if (b0 < 0xe0) {
            out += String.fromCodePoint(((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f));
        } else if (b0 < 0xf0) {
            out += String.fromCodePoint(
                ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f),
            );
        } else {
            out += String.fromCodePoint(
                ((b0 & 0x07) << 18) |
                    ((bytes[i++] & 0x3f) << 12) |
                    ((bytes[i++] & 0x3f) << 6) |
                    (bytes[i++] & 0x3f),
            );
        }
    }
    return out;
}

// =====================================================================
// createActiveLeafCodec（默认）
// =====================================================================

/**
 * 取一棵树的「激活叶子」：沿激活路径（resolveActivePath）下钻到末端节点；
 * 该末端是叶子时返回其 intent+params。激活路径未落在叶子上（如空栈）时返回 undefined。
 * 这与 controller 的「primary destination = 激活叶子」一致：URL 反映用户当前聚焦的目标
 * （stack 顶 / active tab / split 最后一个非空列）。
 */
function activeLeaf(tree: NavigationNode): { intent: string; params: RouteParams } | undefined {
    if (isLeafNode(tree)) return { intent: tree.intent, params: tree.params };
    const node = findNode(tree, resolveActivePath(tree));
    if (node !== undefined && isLeafNode(node)) {
        return { intent: node.intent, params: node.params };
    }
    return undefined;
}

/**
 * 默认 codec：
 * - `encode`：把激活叶子反查为 URL（`Router.reverse` 或路由摘要反查）；激活叶子无对应路由时回退 `"/"`。
 * - `decode`：仅在 URL 带 `__nav` 结构化覆盖时同步还原整棵树；否则返回 `undefined`，
 *   交由调用方走 `await router.resolve(url)` 异步重建单个 LeafNode（今天的行为）。
 */
export function createActiveLeafCodec(): NavigationCodec {
    return {
        encode(tree, router) {
            const target = activeLeaf(tree);
            if (target === undefined) return "/";
            return reverseUrl(router, target.intent, target.params) ?? "/";
        },
        decode(url) {
            const { query } = parseUrlParts(url);
            const overlay = query.get(DEFAULT_NAV_PARAM);
            if (overlay === null || overlay === "") return undefined;
            return decodeNavigationTreeParam(overlay);
        },
    };
}

// =====================================================================
// createFullStateCodec
// =====================================================================

/** full-state codec 选项 */
export interface FullStateCodecOptions {
    /** 保留 query 参数名（整树编码所用）；默认 `__nav`。 */
    readonly param?: string;
}

/**
 * 整树 codec：把整棵树编码进保留 query 参数（默认 `__nav`），支持完整深链。
 * - `encode`：以激活叶子的 URL 作为基底路径（保留 app 可能依赖的 path/query），
 *   再写入保留参数承载整棵树。激活叶子无对应路由时基底退化为 `"/"`。
 * - `decode`：读取保留参数无损还原整棵树；缺失该参数时返回 `undefined`（交由调用方走默认路径）。
 */
export function createFullStateCodec(options: FullStateCodecOptions = {}): NavigationCodec {
    const param = options.param ?? DEFAULT_NAV_PARAM;
    return {
        encode(tree, router) {
            const target = activeLeaf(tree);
            const base = target ? (reverseUrl(router, target.intent, target.params) ?? "/") : "/";
            const { path, query } = parseUrlParts(base);
            query.set(param, encodeNavigationTreeParam(tree));
            return buildRelativeUrl(path, query);
        },
        decode(url) {
            const { query } = parseUrlParts(url);
            const encoded = query.get(param);
            if (encoded === null || encoded === "") return undefined;
            return decodeNavigationTreeParam(encoded);
        },
    };
}

// =====================================================================
// createFlatStackCodec（扁平栈）
// =====================================================================

/**
 * 从 pattern 字符串重建正则 + 参数名列表，用于 decode 侧的同步 URL 匹配。
 *
 * 注意：分段正则 `/(\/:[\w]+\??)/` 与 `substitutePattern`（encode 侧）完全一致，
 * 保证 `:param` / `:param?` 语法在 encode 与 decode 之间共享同一套解释——两者均基于此分割。
 */
function compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    const regexStr = pattern
        .split(/(\/:[\w]+\??)/)
        .map((segment) => {
            const m = segment.match(/^\/:(\w+)(\?)?$/);
            if (m) {
                paramNames.push(m[1]);
                return m[2] ? "(?:/([^/]+))?" : "/([^/]+)";
            }
            return segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
    return { regex: new RegExp(`^${regexStr}/?$`), paramNames };
}

interface CompiledRoute extends ParsedRoute {
    readonly regex: RegExp;
    readonly paramNames: string[];
}

function compileRoutes(router: NavigationRouterLike): CompiledRoute[] {
    return parseRouteSummaries(router).map((r) => {
        const { regex, paramNames } = compilePattern(r.pattern);
        return { ...r, regex, paramNames };
    });
}

/**
 * 同步 URL → { intentId, params }，使用 `parseUrlParts` 拆分 path+query（复用现有工具）。
 * flat-islands 的合法 URL 不含自定义 paramCodec，所以字符串提取即可，不需要异步校验。
 */
function syncMatch(
    url: string,
    routes: CompiledRoute[],
): { intentId: string; params: Record<string, string> } | undefined {
    const { path, query } = parseUrlParts(url);
    const queryParams = Object.fromEntries(query);
    for (const route of routes) {
        const m = path.match(route.regex);
        if (!m) continue;
        const params: Record<string, string> = Object.assign(Object.create(null), queryParams);
        for (let i = 0; i < route.paramNames.length; i++) {
            const raw = m[i + 1];
            if (raw !== undefined) params[route.paramNames[i]] = raw;
        }
        return { intentId: route.intentId, params };
    }
    return undefined;
}

/**
 * 扁平栈 codec —— flat-islands 用：URL ↔ 单叶栈。
 *
 * - `decode(url, router)`：同步把 URL 匹配成单叶意图，返回 `stack([leaf(intent, params)])`；
 *   不可路由时返回 `undefined`（调用方保留当前树，与 createActiveLeafCodec 约定一致）。
 * - `encode(tree, router)`：取激活叶子（activeLeaf）的 intent + params 反查 URL；
 *   无对应路由时回退 `"/"`。
 *
 * 全部复用本模块已有 helper：`parseRouteSummaries`、`parseUrlParts`、`reverseUrl`、`activeLeaf`。
 */
export function createFlatStackCodec(): NavigationCodec {
    return {
        decode(url, router) {
            const routes = compileRoutes(router);
            const match = syncMatch(url, routes);
            if (!match) return undefined;
            return stack([leaf(match.intentId, match.params)]);
        },
        encode(tree, router) {
            const target = activeLeaf(tree);
            if (target === undefined) return "/";
            return reverseUrl(router, target.intent, target.params) ?? "/";
        },
    };
}
