import { describe, expect, test, vi } from "vite-plus/test";
import { defineNavigation } from "../../src/bootstrap/define-navigation";
import { createActiveLeafCodec, type NavigationCodec } from "../../src/navigation/codec";
import { leaf, stack, tabs } from "../../src/navigation/nodes";
import type { NavigationNode } from "../../src/navigation/types";
import type { BasePage } from "../../src/models/page";

describe("defineNavigation — 规范化", () => {
    test("缺省 codec 时套用 createActiveLeafCodec()", () => {
        const def = defineNavigation({ initial: leaf("home") });
        expect(typeof def.codec.encode).toBe("function");
        expect(typeof def.codec.decode).toBe("function");
    });

    test("显式 codec 原样透传", () => {
        const codec: NavigationCodec = createActiveLeafCodec();
        const def = defineNavigation({ initial: leaf("home"), codec });
        expect(def.codec).toBe(codec);
    });

    test("守卫与 getErrorPage 透传到定义对象", () => {
        const beforeLoad = [vi.fn()];
        const afterLoad = [vi.fn()];
        const getErrorPage = (status: number, message: string): BasePage => ({
            id: `e-${status}`,
            pageType: "error",
            title: message,
        });
        const def = defineNavigation({
            initial: leaf("home"),
            beforeLoad,
            afterLoad,
            getErrorPage,
        });
        expect(def.beforeLoad).toBe(beforeLoad);
        expect(def.afterLoad).toBe(afterLoad);
        expect(def.getErrorPage).toBe(getErrorPage);
    });
});

describe("defineNavigation.toBrowserConfig — 收敛为具体树", () => {
    test("静态树原样作为 initial", () => {
        const tree = tabs({
            active: "home",
            branches: { home: stack(leaf("home")), me: stack(leaf("me")) },
        });
        const def = defineNavigation({ initial: tree });
        const cfg = def.toBrowserConfig("/");
        expect(cfg.initial).toBe(tree);
    });

    test("工厂 initial 用传入 url 求值", () => {
        const factory = vi.fn((url: string): NavigationNode | undefined =>
            url === "/me" ? leaf("me") : leaf("home"),
        );
        const def = defineNavigation({ initial: factory });

        const cfg = def.toBrowserConfig("/me");
        expect(factory).toHaveBeenCalledWith("/me");
        expect(cfg.initial).toEqual(leaf("me"));
    });

    test("工厂返回 undefined 时回退占位根 leaf", () => {
        const def = defineNavigation({
            initial: (): NavigationNode | undefined => undefined,
        });
        const cfg = def.toBrowserConfig("/whatever");
        expect(cfg.initial).toEqual({
            kind: "leaf",
            intent: "@finesoft/navigation-root",
            params: {},
        });
    });

    test("透传 codec / 守卫 / getErrorPage", () => {
        const codec = createActiveLeafCodec();
        const beforeLoad = [vi.fn()];
        const afterLoad = [vi.fn()];
        const getErrorPage = (status: number): BasePage => ({
            id: `e-${status}`,
            pageType: "error",
            title: "error",
        });
        const def = defineNavigation({
            initial: leaf("home"),
            codec,
            beforeLoad,
            afterLoad,
            getErrorPage,
        });
        const cfg = def.toBrowserConfig("/");
        expect(cfg.codec).toBe(codec);
        expect(cfg.beforeLoad).toBe(beforeLoad);
        expect(cfg.afterLoad).toBe(afterLoad);
        expect(cfg.getErrorPage).toBe(getErrorPage);
    });

    test("不传 url 时在非浏览器环境回退 '/'（不抛错）", () => {
        const factory = vi.fn((): NavigationNode | undefined => leaf("home"));
        const def = defineNavigation({ initial: factory });
        const cfg = def.toBrowserConfig();
        expect(factory).toHaveBeenCalledWith("/");
        expect(cfg.initial).toEqual(leaf("home"));
    });
});

describe("defineNavigation.toSSRDefinition — 收敛为骨架工厂", () => {
    test("静态树 → 恒返回该树的工厂（对任意 url）", () => {
        const tree = leaf("home");
        const def = defineNavigation({ initial: tree });
        const ssr = def.toSSRDefinition();
        expect(ssr.initial?.("/")).toBe(tree);
        expect(ssr.initial?.("/anything?x=1")).toBe(tree);
    });

    test("工厂 initial 原样作为骨架工厂（含返回 undefined 的单页回退语义）", () => {
        const factory = (url: string): NavigationNode | undefined =>
            url.startsWith("/app") ? leaf("app") : undefined;
        const def = defineNavigation({ initial: factory });
        const ssr = def.toSSRDefinition();
        expect(ssr.initial?.("/app/x")).toEqual(leaf("app"));
        // 返回 undefined → SSR 侧回退「Router.resolve → 单 LeafNode」（今天的单页）。
        expect(ssr.initial?.("/other")).toBeUndefined();
    });

    test("codec 必填且透传，守卫透传，但不含 getErrorPage（SSR runner 自带）", () => {
        const codec = createActiveLeafCodec();
        const beforeLoad = [vi.fn()];
        const afterLoad = [vi.fn()];
        const def = defineNavigation({
            initial: leaf("home"),
            codec,
            beforeLoad,
            afterLoad,
            getErrorPage: (): BasePage => ({ id: "e", pageType: "error", title: "error" }),
        });
        const ssr = def.toSSRDefinition();
        expect(ssr.codec).toBe(codec);
        expect(ssr.beforeLoad).toBe(beforeLoad);
        expect(ssr.afterLoad).toBe(afterLoad);
        expect("getErrorPage" in ssr).toBe(false);
    });
});

describe("defineNavigation — 单 LeafNode = 扁平单页等价", () => {
    test("单 leaf 树同时收敛出相同结构（browser=树本身，ssr=恒返回该树）", () => {
        const tree = leaf("home", { id: 1 });
        const def = defineNavigation({ initial: tree });
        expect(def.toBrowserConfig("/").initial).toBe(tree);
        expect(def.toSSRDefinition().initial?.("/")).toBe(tree);
    });
});
