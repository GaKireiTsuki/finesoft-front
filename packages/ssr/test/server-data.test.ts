vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
import { expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { markPublic } from "@finesoft/web";
import { materializeServerData, serializeServerData } from "../src/server-data";

test("escapes HTML-sensitive characters and line separators", () => {
    const serialized = serializeServerData({
        pages: [
            {
                intent: { id: "page" },
                data: {
                    title: "</script><script>alert(1)</script>\u2028\u2029<>",
                },
            },
        ],
    });

    expect(serialized).toContain("\\u003C");
    expect(serialized).toContain("\\u003E");
    expect(serialized).toContain("\\u002F");
    expect(serialized).toContain("\\u2028");
    expect(serialized).toContain("\\u2029");
    expect(serialized).not.toContain("</script>");
});

test("strict policy survives materialization without revisiting request-backed getters", () => {
    const raw = {
        pages: [{ intent: { id: "home" }, data: { id: "home", pageType: "home", title: "Home" } }],
    };
    const unmarked = materializeServerData(raw);
    expect(() => serializeServerData(unmarked, { onUnmarkedPage: "strict" })).toThrow(
        "markPublic-required",
    );
    expect(() => serializeServerData(raw, { onUnmarkedPage: "strict" })).toThrow(
        "markPublic-required",
    );
    let live = true;
    const marked = materializeServerData({
        pages: [
            {
                intent: { id: "home" },
                data: markPublic(
                    {
                        get title() {
                            if (!live) throw Error("disposed");
                            return "Home";
                        },
                    },
                    ["title"],
                ),
            },
        ],
    });
    live = false;
    expect(serializeServerData(marked, { onUnmarkedPage: "strict" })).toContain("Home");
});
