/**
 * 重载 DOM 自动恢复（spec §4.5）—— islands 应用 opt-in。
 *
 * 标 `data-restore-root` 的容器内：表单值 / <details> / 滚动自动捕获进会话作用域
 * `scope[entryKey].__dom`（随会话快照落盘），刷新/冷启动重挂后回填。受控输入派发合成
 * input/change 驱动 v-model。安全：仅 data-restore-root 内、有 name/data-restore-key 的字段，
 * 排除 password 与 data-restore-ignore。
 */

import type { NavigationScopedState } from "@finesoft/core";

interface DomState {
    readonly fields?: Record<string, string | boolean>;
    readonly details?: Record<string, boolean>;
    readonly scroll?: Record<string, { top: number; left: number }>;
}

export interface DomRestoreOptions {
    /** 会话作用域（来自 SessionHandle.scope）；DOM 状态写进 `scope[key].__dom`。 */
    readonly scope: NavigationScopedState;
    /** 回填调度（默认 requestAnimationFrame；测试可注入同步执行）。 */
    readonly schedule?: (cb: () => void) => void;
}

export interface DomRestore {
    /** 捕获一个 island container 的 DOM 状态进 scope（供测试 + 内部接线复用）。 */
    captureEntry(container: HTMLElement): void;
    /** 回填一个 island container（从 scope 读，scheduled）。 */
    restoreEntry(container: HTMLElement): void;
    /** 接线进 outlet（fs:* / input / pagehide + boot catch-up）。 */
    attach(outlet: HTMLElement): void;
    /** 解绑全部监听（幂等）。 */
    dispose(): void;
}

/** 取 container 内全部 data-restore-root 子树（容器自身若标了也算）。 */
function restoreRoots(container: HTMLElement): HTMLElement[] {
    const roots: HTMLElement[] = [];
    if (container.hasAttribute("data-restore-root")) roots.push(container);
    for (const el of container.querySelectorAll<HTMLElement>("[data-restore-root]")) roots.push(el);
    return roots;
}

/** 字段键：data-restore-key 优先，否则 name；都无返回 undefined（不捕获）。 */
function fieldKey(el: Element): string | undefined {
    const rk = el.getAttribute("data-restore-key");
    if (rk) return rk;
    const name = (el as HTMLInputElement).name;
    return name || undefined;
}

function keyOf(container: HTMLElement): string | undefined {
    return container.getAttribute("data-fs-key") ?? undefined;
}

export function createDomRestore(options: DomRestoreOptions): DomRestore {
    const { scope } = options;
    const schedule =
        options.schedule ??
        ((cb: () => void) => {
            if (typeof requestAnimationFrame === "function") requestAnimationFrame(cb);
            else cb();
        });

    function collect(container: HTMLElement): DomState {
        const fields: Record<string, string | boolean> = {};
        const details: Record<string, boolean> = {};
        const scroll: Record<string, { top: number; left: number }> = {};
        for (const root of restoreRoots(container)) {
            for (const el of root.querySelectorAll<HTMLInputElement>("input, textarea, select")) {
                if ((el as HTMLInputElement).type === "password") continue;
                if (el.hasAttribute("data-restore-ignore")) continue;
                const key = fieldKey(el);
                if (!key) continue;
                const type = (el as HTMLInputElement).type;
                fields[key] =
                    type === "checkbox" || type === "radio"
                        ? (el as HTMLInputElement).checked
                        : el.value;
            }
            for (const d of root.querySelectorAll<HTMLDetailsElement>("details")) {
                const key = d.getAttribute("data-restore-key");
                if (key) details[key] = d.open;
            }
            for (const s of root.querySelectorAll<HTMLElement>("[data-restore-scroll]")) {
                const key =
                    s.getAttribute("data-restore-key") ?? s.getAttribute("data-restore-scroll");
                if (key) scroll[key] = { top: s.scrollTop, left: s.scrollLeft };
            }
        }
        return { fields, details, scroll };
    }

    function captureEntry(container: HTMLElement): void {
        const key = keyOf(container);
        if (!key) return;
        const bag = (scope.get(key) as Record<string, unknown> | undefined) ?? {};
        scope.set(key, { ...bag, __dom: collect(container) });
    }

    function apply(container: HTMLElement, dom: DomState): void {
        for (const root of restoreRoots(container)) {
            for (const [key, val] of Object.entries(dom.fields ?? {})) {
                // 键为应用定义的 name / data-restore-key（受信，非用户输入）；不做选择器转义。
                const el = root.querySelector<HTMLInputElement>(
                    `[data-restore-key="${key}"], [name="${key}"]`,
                );
                if (!el) continue;
                if (typeof val === "boolean") {
                    (el as HTMLInputElement).checked = val;
                } else {
                    el.value = val;
                }
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
            }
            for (const [key, open] of Object.entries(dom.details ?? {})) {
                const d = root.querySelector<HTMLDetailsElement>(
                    `details[data-restore-key="${key}"]`,
                );
                if (d) d.open = open;
            }
            for (const [key, pos] of Object.entries(dom.scroll ?? {})) {
                const s = root.querySelector<HTMLElement>(
                    `[data-restore-scroll="${key}"], [data-restore-key="${key}"]`,
                );
                if (s) {
                    s.scrollTop = pos.top;
                    s.scrollLeft = pos.left;
                }
            }
        }
    }

    function restoreEntry(container: HTMLElement): void {
        const key = keyOf(container);
        if (!key) return;
        const dom = (scope.get(key) as { __dom?: DomState } | undefined)?.__dom;
        if (!dom) return;
        schedule(() => apply(container, dom));
    }

    let boundOutlet: HTMLElement | undefined;

    /** Walk from event target up to the nearest island container ([data-fs-entry]). */
    function containerOf(target: EventTarget | null): HTMLElement | undefined {
        return (target as HTMLElement | null)?.closest<HTMLElement>("[data-fs-entry]") ?? undefined;
    }

    const onEnter = (e: Event): void => {
        const c = containerOf(e.target);
        if (c) restoreEntry(c);
    };
    const onConceal = (e: Event): void => {
        const c = containerOf(e.target);
        if (c) captureEntry(c);
    };
    const onEdit = (e: Event): void => {
        const c = containerOf(e.target);
        if (c) captureEntry(c);
    };
    const flushVisible = (): void => {
        if (!boundOutlet) return;
        for (const c of boundOutlet.querySelectorAll<HTMLElement>("[data-fs-entry]"))
            captureEntry(c);
    };
    const onVisibility = (): void => {
        if (document.visibilityState === "hidden") flushVisible();
    };

    function attach(outlet: HTMLElement): void {
        boundOutlet = outlet;
        outlet.addEventListener("fs:enter", onEnter);
        outlet.addEventListener("fs:conceal", onConceal);
        outlet.addEventListener("input", onEdit, true);
        outlet.addEventListener("change", onEdit, true);
        window.addEventListener("pagehide", flushVisible);
        document.addEventListener("visibilitychange", onVisibility);
        // boot catch-up: islands may already be mounted (fs:enter already fired) when attach runs;
        // restore each one now (scope was restored by the session layer just before attach).
        for (const c of outlet.querySelectorAll<HTMLElement>("[data-fs-entry]")) restoreEntry(c);
    }

    function dispose(): void {
        if (!boundOutlet) return;
        boundOutlet.removeEventListener("fs:enter", onEnter);
        boundOutlet.removeEventListener("fs:conceal", onConceal);
        boundOutlet.removeEventListener("input", onEdit, true);
        boundOutlet.removeEventListener("change", onEdit, true);
        window.removeEventListener("pagehide", flushVisible);
        document.removeEventListener("visibilitychange", onVisibility);
        boundOutlet = undefined;
    }

    return { captureEntry, restoreEntry, attach, dispose };
}
