import { describe, expect, test, vi } from "vite-plus/test";
import { Container } from "@finesoft/core";
import { runAfterLoadGuards, runBeforeLoadGuards } from "../../src/middleware/pipeline";
import { deny, next, redirect, rewrite } from "../../src/middleware/types";

const navigationContext = {
    url: "/account?tab=profile",
    path: "/account",
    params: { tab: "profile" },
    intent: { id: "account", params: { tab: "profile" } },
    isServer: false,
    container: new Container(),
    getCookie: () => undefined,
    getHeader: () => undefined,
};

const postLoadContext = {
    ...navigationContext,
    page: {
        id: "account-page",
        pageType: "account",
        title: "Account",
    },
};

describe("middleware pipeline", () => {
    test.each([runBeforeLoadGuards, runAfterLoadGuards])(
        "preserves cancellation before and after an asynchronous guard",
        async (run) => {
            const controller = new AbortController();
            const context = { ...postLoadContext, signal: controller.signal };
            const later = vi.fn(() => next());
            const cancelled = run(
                [
                    async () => {
                        await Promise.resolve();
                        controller.abort();
                        return redirect("/stale");
                    },
                    later,
                ],
                context,
            );
            await expect(cancelled).rejects.toMatchObject({ code: "cancelled" });
            expect(later).not.toHaveBeenCalled();
            await expect(run([later], context)).rejects.toMatchObject({ code: "cancelled" });
            expect(later).not.toHaveBeenCalled();
        },
    );

    test.each([runBeforeLoadGuards, runAfterLoadGuards])(
        "propagates a guard failure without running subsequent guards",
        async (run) => {
            const error = new Error("guard failed");
            const later = vi.fn(() => next());
            await expect(
                run(
                    [
                        () => {
                            throw error;
                        },
                        later,
                    ],
                    postLoadContext,
                ),
            ).rejects.toBe(error);
            expect(later).not.toHaveBeenCalled();
        },
    );

    test("creates middleware results with helper factories", () => {
        expect(next()).toEqual({ kind: "next" });
        expect(redirect("/login")).toEqual({
            kind: "redirect",
            url: "/login",
            status: 302,
        });
        expect(redirect("/moved", 301)).toEqual({
            kind: "redirect",
            url: "/moved",
            status: 301,
        });
        expect(rewrite("/canonical")).toEqual({
            kind: "rewrite",
            url: "/canonical",
        });
        expect(deny()).toEqual({
            kind: "deny",
            status: 403,
            message: "Forbidden",
        });
        expect(deny(401, "Unauthorized")).toEqual({
            kind: "deny",
            status: 401,
            message: "Unauthorized",
        });
    });

    test("short-circuits beforeLoad guards on the first non-next result", async () => {
        const first = vi.fn(async () => next());
        const second = vi.fn(async () => redirect("/login"));
        const third = vi.fn(async () => deny(403, "blocked"));

        await expect(
            runBeforeLoadGuards([first, second, third], navigationContext),
        ).resolves.toEqual({
            kind: "redirect",
            url: "/login",
            status: 302,
        });
        expect(third).not.toHaveBeenCalled();
    });

    test("returns next when all afterLoad guards continue", async () => {
        const first = vi.fn(async () => next());
        const second = vi.fn(async () => next());

        await expect(runAfterLoadGuards([first, second], postLoadContext)).resolves.toEqual({
            kind: "next",
        });
    });

    test("short-circuits afterLoad guards on deny results", async () => {
        const first = vi.fn(async () => next());
        const second = vi.fn(async () => deny(401, "stop"));
        const third = vi.fn(async () => rewrite("/should-not-run"));

        await expect(runAfterLoadGuards([first, second, third], postLoadContext)).resolves.toEqual({
            kind: "deny",
            status: 401,
            message: "stop",
        });
        expect(third).not.toHaveBeenCalled();
    });
});
