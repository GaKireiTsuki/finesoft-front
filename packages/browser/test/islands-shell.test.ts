import { describe, expect, test } from "vite-plus/test";
import { FakeElement, makeFakeDocumentWithRoot, stubDomGlobals } from "./fake-dom";
import { resolveIslandsShell } from "../src/islands-shell";

// ---------------------------------------------------------------------------
// 注册全局 document stub（使 resolveIslandsShell 内 document.createElement 可用）
// ---------------------------------------------------------------------------
stubDomGlobals();

// ---------------------------------------------------------------------------
// resolveIslandsShell — 方案 C islands shell 约定
// ---------------------------------------------------------------------------

describe("resolveIslandsShell", () => {
    /** 构造一个带 id="app" root 的 fake document 并替换全局 document stub。 */
    function makeTarget(): FakeElement {
        const target = new FakeElement("div");
        const fakeDoc = makeFakeDocumentWithRoot("app", target);
        // 替换全局 document，使 resolveIslandsShell 内的 document.createElement 走 fake
        Object.assign(globalThis.document as object, fakeDoc);
        return target;
    }

    test("SSR shell 已在：复用 chrome + outlet，hydrate === true（chrome-root 有子节点）", () => {
        const target = makeTarget();

        // 预置 SSR shell
        const chrome = new FakeElement("div");
        chrome.setAttribute("data-fs-chrome", "");
        // 模拟 SSR 渲过内容（含子节点）
        const ssrChild = new FakeElement("header");
        chrome.appendChild(ssrChild);

        const outlet = new FakeElement("main");
        outlet.setAttribute("data-fs-outlet", "");

        target.appendChild(chrome);
        target.appendChild(outlet);

        const result = resolveIslandsShell(target as unknown as HTMLElement);

        expect(result.chromeRoot).toBe(chrome);
        expect(result.outlet).toBe(outlet);
        expect(result.hydrate).toBe(true);
        // 不新建：target 仍只有两个子节点
        expect((target as unknown as FakeElement).children).toHaveLength(2);
    });

    test("纯 CSR：空 target → 建出 [data-fs-chrome] + [data-fs-outlet] 兄弟，hydrate === false", () => {
        const target = makeTarget();

        const result = resolveIslandsShell(target as unknown as HTMLElement);

        expect(result.hydrate).toBe(false);

        // 两者均 appended 到 target
        const children = (target as unknown as FakeElement).children;
        expect(children).toHaveLength(2);
        expect(children[0]!.hasAttribute("data-fs-chrome")).toBe(true);
        expect(children[1]!.hasAttribute("data-fs-outlet")).toBe(true);

        // 返回的引用即刚 append 的元素
        expect(result.chromeRoot).toBe(children[0]);
        expect(result.outlet).toBe(children[1]);
    });

    test("退化（有 [data-fs-chrome] 但缺 [data-fs-outlet]）→ 抛错", () => {
        const target = makeTarget();

        const chrome = new FakeElement("div");
        chrome.setAttribute("data-fs-chrome", "");
        target.appendChild(chrome);
        // 刻意不加 [data-fs-outlet]

        expect(() => resolveIslandsShell(target as unknown as HTMLElement)).toThrow(
            "[resolveIslandsShell]",
        );
    });
});
