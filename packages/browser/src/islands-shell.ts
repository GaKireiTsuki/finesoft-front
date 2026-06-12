/**
 * islands 应用 shell（方案 C）：chrome-root 与 outlet 为兄弟。
 *
 * SSR 已渲 → target 内已有 `[data-fs-chrome]` + `[data-fs-outlet]`，复用之，`hydrate` 取决于
 * chrome-root 是否有内容（SSR 渲过 → true）。纯 CSR（无 SSR shell）→ 建出二者兄弟，`hydrate=false`。
 * 编排器经 `[data-fs-outlet]` 找 outlet（与此约定同源）。
 */
export interface IslandsShell {
    readonly chromeRoot: HTMLElement;
    readonly outlet: HTMLElement;
    /** chrome-root 是否含 SSR 内容（true → 应水合 chrome，false → 客户端新建）。 */
    readonly hydrate: boolean;
}

export function resolveIslandsShell(target: HTMLElement): IslandsShell {
    const existingChrome = target.querySelector<HTMLElement>("[data-fs-chrome]");
    if (existingChrome !== null) {
        const outlet = target.querySelector<HTMLElement>("[data-fs-outlet]");
        if (outlet === null) {
            throw new Error(
                "[resolveIslandsShell] 找到 [data-fs-chrome] 但缺 [data-fs-outlet]；SSR shell 应同时含两者。",
            );
        }
        return { chromeRoot: existingChrome, outlet, hydrate: existingChrome.firstChild !== null };
    }
    // 纯 CSR 兜底：建 chrome-root + outlet 兄弟。
    const chromeRoot = document.createElement("div");
    chromeRoot.setAttribute("data-fs-chrome", "");
    const outlet = document.createElement("main");
    outlet.setAttribute("data-fs-outlet", "");
    target.append(chromeRoot, outlet);
    return { chromeRoot, outlet, hydrate: false };
}
