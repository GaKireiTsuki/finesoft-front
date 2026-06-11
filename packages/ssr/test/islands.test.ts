import { describe, expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { renderIslandsHtml } from "../src/islands";
import type { NavigationSnapshot } from "@finesoft/core";

function snap(destinations: NavigationSnapshot["destinations"]): NavigationSnapshot {
    return { tree: { kind: "leaf", intent: "x", params: {} }, destinations };
}

describe("renderIslandsHtml", () => {
    test("wraps a single destination in a shared-marker container", async () => {
        const s = snap([{ intent: "detail", params: { id: "1" }, page: { id: "p" } as never }]);
        const html = await renderIslandsHtml(
            s,
            (e) => `<p>${e.intent}:${(e.page as { id: string }).id}</p>`,
        );
        expect(html).toContain('<div data-fs-entry data-fs-intent="detail" data-fs-key=');
        expect(html).toContain("<p>detail:p</p></div>");
    });

    test("renders all visible destinations in order (split multi-column)", async () => {
        const s = snap([
            { intent: "list", params: {}, page: { id: "l" } as never },
            { intent: "detail", params: { id: "2" }, page: { id: "d" } as never },
        ]);
        const calls: string[] = [];
        const html = await renderIslandsHtml(s, (e) => {
            calls.push(e.intent);
            return `[${e.intent}]`;
        });
        expect(calls).toEqual(["list", "detail"]);
        expect(html.indexOf("[list]")).toBeLessThan(html.indexOf("[detail]"));
    });

    test("empty destinations → empty string", async () => {
        expect(await renderIslandsHtml(snap([]), () => "x")).toBe("");
    });

    test("awaits async renderEntry (Vue renderToString 形态)", async () => {
        const s = snap([{ intent: "a", params: {}, page: { id: "a" } as never }]);
        expect(await renderIslandsHtml(s, async (e) => `async:${e.intent}`)).toContain("async:a");
    });
});
