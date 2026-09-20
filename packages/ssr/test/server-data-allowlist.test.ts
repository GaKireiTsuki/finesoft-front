vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
import { describe, expect, test, vi } from "vite-plus/test";
import { markPublic } from "@finesoft/web";
import { type BasePage } from "@finesoft/web";

vi.mock("@finesoft/core", async () => import("../../core/src/index"));

import { serializeServerData } from "../src/server-data";

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

        const out = serializeServerData({ pages: [{ intent: { id: "profile" }, data: page }] });
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

        const out = serializeServerData({ pages: [{ intent: { id: "profile" }, data: page }] });
        expect(out).toContain("atk_x");
    });

    test("unmarked page emits only base fields without private diagnostics", () => {
        const page = { id: "p", pageType: "profile", title: "Alice", apiToken: "SECRET" };
        expect(
            serializeServerData({ pages: [{ intent: { id: "profile" }, data: page }] }),
        ).not.toContain("SECRET");
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
        const out = serializeServerData(
            { pages: [{ intent: { id: "profile" }, data: page }] },
            {
                onUnmarkedPage: "base-fields",
            },
        );
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
            serializeServerData(
                { pages: [{ intent: { id: "profile" }, data: page }] },
                {
                    onUnmarkedPage: "strict",
                },
            ),
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
        const out = serializeServerData({ pages: [{ intent: { id: "profile" }, data: page }] });
        expect(out).toContain("\\u003C");
        expect(out).not.toContain("</script>");
    });
});
