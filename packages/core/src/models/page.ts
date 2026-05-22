/**
 * BasePage — 所有页面共享的基础属性
 *
 * 具体页面类型由应用层定义并扩展此接口。
 *
 * SSR prefetch 数据序列化时的可见性由 `FINESOFT_PUBLIC` symbol 控制 —— 见
 * `markPublic` / `isPublicMarked`。没有 marker 时 `serializeServerData` 仍按全字段
 * 序列化（向后兼容），但会在 dev 启动后打印一次告警，下一个 major 会改为只序列化
 * `BasePage` 的标准字段（id/pageType/title/description/url）。
 */

export interface BasePage {
    id: string;
    pageType: string;
    title: string;
    description?: string;
    url?: string;
}

/**
 * 显式声明 page 对象里哪些字段可以跨 SSR/CSR 边界进入 HTML。未列出的字段在
 * `serializeServerData` 时会被剥除，杜绝整 page 对象（含 apiToken、内部备注等）
 * 被无意中 hydrate 到客户端的失误。
 *
 * 用 symbol 而非普通字段名：避免和应用自己的字段冲突，且 `JSON.stringify` 自动
 * 忽略 symbol key，所以 marker 永远不会出现在序列化输出里。
 */
export const FINESOFT_PUBLIC: unique symbol = Symbol.for("finesoft.publicFields");

/** 标准 BasePage 字段 —— marker 缺失但显式标注时使用。 */
export const BASE_PAGE_FIELDS = ["id", "pageType", "title", "description", "url"] as const;

/**
 * 把 `publicFields` 列表写到 page 上，供 `serializeServerData` 读取。
 * 推荐做法是不要直接渲染原始 page 对象，而是经过这个函数显式声明 contract：
 *
 * ```ts
 * return markPublic(
 *     {
 *         id: "profile",
 *         pageType: "profile",
 *         title: user.name,
 *         email: user.email,
 *         apiToken: user.apiToken,        // 仍在对象上，给服务端别处用
 *     },
 *     ["id", "pageType", "title", "email"], // 但 prefetch 只 serialize 这些
 * );
 * ```
 *
 * 也可以传 `true` 表示「所有字段都安全」—— 当作 opt-out，等价于不调用本函数。
 */
export function markPublic<P extends BasePage>(
    page: P,
    publicFields: readonly (keyof P)[] | true,
): P {
    if (publicFields === true) {
        Object.defineProperty(page, FINESOFT_PUBLIC, {
            value: true,
            enumerable: false,
            configurable: true,
            writable: false,
        });
        return page;
    }
    Object.defineProperty(page, FINESOFT_PUBLIC, {
        value: Object.freeze([...publicFields]),
        enumerable: false,
        configurable: true,
        writable: false,
    });
    return page;
}

/** True 如果 page 用 `markPublic` 显式标过。 */
export function isPublicMarked(page: unknown): boolean {
    return (
        typeof page === "object" &&
        page !== null &&
        (page as Record<symbol, unknown>)[FINESOFT_PUBLIC] !== undefined
    );
}

/** 取出 `markPublic` 写入的字段白名单；`true` 表示全开放，`null` 表示未标注。 */
export function getPublicFields(page: unknown): readonly string[] | true | null {
    if (typeof page !== "object" || page === null) return null;
    const v = (page as Record<symbol, unknown>)[FINESOFT_PUBLIC];
    if (v === undefined) return null;
    if (v === true) return true;
    if (Array.isArray(v)) return v as readonly string[];
    return null;
}
