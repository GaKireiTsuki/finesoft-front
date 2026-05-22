import { describe, expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index"));

import { serializeServerData } from "../src/server-data";

describe("serializeServerData", () => {
    test("escapes HTML-sensitive characters and line separators", () => {
        const serialized = serializeServerData([
            {
                intent: { id: "page" },
                data: {
                    html: "</script><script>alert(1)</script>\u2028\u2029<>",
                },
            },
        ]);

        expect(serialized).toContain("\\u003C");
        expect(serialized).toContain("\\u003E");
        expect(serialized).toContain("\\u002F");
        expect(serialized).toContain("\\u2028");
        expect(serialized).toContain("\\u2029");
        expect(serialized).not.toContain("</script>");
    });
});
