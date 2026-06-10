import { describe, expect, test, vi } from "vite-plus/test";
import { markPublic, type BasePage } from "../../core/src/index";

vi.mock("@finesoft/core", async () => import("../../core/src/index"));

import { __resetUnmarkedPageWarning, serializeServerData } from "../src/server-data";

interface ProfilePage extends BasePage {
    email?: string;
    apiToken?: string;
    internalNotes?: string;
}

describe("serializeServerData — markPublic allowlist", () => {
    test("strips fields not in the markPublic whitelist", () => {
        const page = markPublic<ProfilePage>(
            {
                id: "p",
                pageType: "profile",
                title: "Alice",
                email: "alice@example.com",
                apiToken: "FLAG{should-not-leak}",
                internalNotes: "secret",
            },
            ["id", "pageType", "title", "email"],
        );

        const out = serializeServerData([{ intent: { id: "profile" }, data: page }]);
        expect(out).toContain("alice@example.com");
        expect(out).not.toContain("FLAG{should-not-leak}");
        expect(out).not.toContain("internalNotes");
    });

    test("markPublic(page, true) opts out and keeps all fields", () => {
        const page = markPublic<ProfilePage>(
            {
                id: "p",
                pageType: "profile",
                title: "Alice",
                apiToken: "atk_x",
            },
            true,
        );

        const out = serializeServerData([{ intent: { id: "profile" }, data: page }]);
        expect(out).toContain("atk_x");
    });

    test("unmarked page is still fully serialized (back-compat) but warns once", () => {
        // The "warn once" guard is a module-level flag; reset it so this assertion
        // doesn't depend on whether an earlier test already tripped the warning.
        __resetUnmarkedPageWarning();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const page: ProfilePage = {
                id: "p",
                pageType: "profile",
                title: "Alice",
                apiToken: "still-leaks-back-compat",
            };
            const out = serializeServerData([{ intent: { id: "profile" }, data: page }]);
            expect(out).toContain("still-leaks-back-compat");
            expect(warn).toHaveBeenCalled();
            expect(String(warn.mock.calls[0][0])).toContain("markPublic");
        } finally {
            warn.mockRestore();
        }
    });

    test("onUnmarkedPage='base-fields' keeps only BasePage fields", () => {
        const page: ProfilePage = {
            id: "p",
            pageType: "profile",
            title: "Alice",
            description: "hi",
            apiToken: "leak",
            email: "leak@x",
        };
        const out = serializeServerData([{ intent: { id: "profile" }, data: page }], {
            onUnmarkedPage: "base-fields",
        });
        expect(out).toContain('"title":"Alice"');
        expect(out).toContain('"description":"hi"');
        expect(out).not.toContain("leak");
        expect(out).not.toContain("apiToken");
        expect(out).not.toContain("email");
    });

    test("onUnmarkedPage='strict' throws on unmarked page", () => {
        const page: ProfilePage = {
            id: "p",
            pageType: "profile",
            title: "X",
            apiToken: "leak",
        };
        expect(() =>
            serializeServerData([{ intent: { id: "profile" }, data: page }], {
                onUnmarkedPage: "strict",
            }),
        ).toThrow(/markPublic/);
    });

    test("HTML escapes still apply on top of allowlist", () => {
        const page = markPublic<ProfilePage>(
            {
                id: "p",
                pageType: "profile",
                title: "</script><script>alert(1)</script>",
            },
            ["id", "pageType", "title"],
        );
        const out = serializeServerData([{ intent: { id: "profile" }, data: page }]);
        expect(out).toContain("\\u003C");
        expect(out).not.toContain("</script>");
    });
});
