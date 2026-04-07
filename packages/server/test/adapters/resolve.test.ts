import { describe, expect, test, vi } from "vite-plus/test";

const {
    autoAdapter,
    cloudflareAdapter,
    netlifyAdapter,
    nodeAdapter,
    staticAdapter,
    vercelAdapter,
} = vi.hoisted(() => ({
    autoAdapter: vi.fn(),
    cloudflareAdapter: vi.fn(),
    netlifyAdapter: vi.fn(),
    nodeAdapter: vi.fn(),
    staticAdapter: vi.fn(),
    vercelAdapter: vi.fn(),
}));

vi.mock("../../src/adapters/auto", () => ({
    autoAdapter,
}));

vi.mock("../../src/adapters/cloudflare", () => ({
    cloudflareAdapter,
}));

vi.mock("../../src/adapters/netlify", () => ({
    netlifyAdapter,
}));

vi.mock("../../src/adapters/node", () => ({
    nodeAdapter,
}));

vi.mock("../../src/adapters/static", () => ({
    staticAdapter,
}));

vi.mock("../../src/adapters/vercel", () => ({
    vercelAdapter,
}));

import { resolveAdapter } from "../../src/adapters/resolve";

describe("resolveAdapter", () => {
    test("maps known adapter strings to their factories", () => {
        const adapters = {
            auto: { name: "auto", build: vi.fn() },
            cloudflare: { name: "cloudflare", build: vi.fn() },
            netlify: { name: "netlify", build: vi.fn() },
            node: { name: "node", build: vi.fn() },
            static: { name: "static", build: vi.fn() },
            vercel: { name: "vercel", build: vi.fn() },
        };

        autoAdapter.mockReturnValue(adapters.auto);
        cloudflareAdapter.mockReturnValue(adapters.cloudflare);
        netlifyAdapter.mockReturnValue(adapters.netlify);
        nodeAdapter.mockReturnValue(adapters.node);
        staticAdapter.mockReturnValue(adapters.static);
        vercelAdapter.mockReturnValue(adapters.vercel);

        expect(resolveAdapter("auto")).toBe(adapters.auto);
        expect(resolveAdapter("cloudflare")).toBe(adapters.cloudflare);
        expect(resolveAdapter("netlify")).toBe(adapters.netlify);
        expect(resolveAdapter("node")).toBe(adapters.node);
        expect(resolveAdapter("static")).toBe(adapters.static);
        expect(resolveAdapter("vercel")).toBe(adapters.vercel);
    });

    test("passes adapter objects through and rejects unknown strings", () => {
        const customAdapter = { name: "custom", build: vi.fn() };

        expect(resolveAdapter(customAdapter as never)).toBe(customAdapter);
        expect(() => resolveAdapter("mystery")).toThrow(
            '[finesoft] Unknown adapter: "mystery". Available: vercel, cloudflare, netlify, node, static, auto',
        );
    });
});
