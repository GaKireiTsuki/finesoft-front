import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const { resolveAdapter } = vi.hoisted(() => ({
    resolveAdapter: vi.fn(),
}));

vi.mock("../../src/adapters/resolve", () => ({
    resolveAdapter,
}));

import { autoAdapter } from "../../src/adapters/auto";

afterEach(() => {
    delete process.env.VERCEL;
    delete process.env.CF_PAGES;
    delete process.env.NETLIFY;
    vi.restoreAllMocks();
    resolveAdapter.mockReset();
});

describe("autoAdapter", () => {
    test("delegates to the detected Vercel adapter", async () => {
        process.env.VERCEL = "1";

        const build = vi.fn(async () => {});
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        resolveAdapter.mockReturnValue({ name: "vercel", build });

        const ctx = { root: "/project" };
        await autoAdapter().build(ctx as never);

        expect(resolveAdapter).toHaveBeenCalledWith("vercel");
        expect(build).toHaveBeenCalledWith(ctx);
        expect(log).toHaveBeenCalledWith("  [auto] Detected platform: vercel\n");
    });

    test("delegates to the detected Cloudflare adapter", async () => {
        process.env.CF_PAGES = "1";

        const build = vi.fn(async () => {});
        resolveAdapter.mockReturnValue({ name: "cloudflare", build });

        await autoAdapter().build({ root: "/project" } as never);

        expect(resolveAdapter).toHaveBeenCalledWith("cloudflare");
        expect(build).toHaveBeenCalledTimes(1);
    });

    test("delegates to the detected Netlify adapter", async () => {
        process.env.NETLIFY = "1";

        const build = vi.fn(async () => {});
        resolveAdapter.mockReturnValue({ name: "netlify", build });

        await autoAdapter().build({ root: "/project" } as never);

        expect(resolveAdapter).toHaveBeenCalledWith("netlify");
        expect(build).toHaveBeenCalledTimes(1);
    });

    test("falls back to the Node adapter when no platform variables are present", async () => {
        const build = vi.fn(async () => {});
        resolveAdapter.mockReturnValue({ name: "node", build });

        await autoAdapter().build({ root: "/project" } as never);

        expect(resolveAdapter).toHaveBeenCalledWith("node");
        expect(build).toHaveBeenCalledTimes(1);
    });
});
