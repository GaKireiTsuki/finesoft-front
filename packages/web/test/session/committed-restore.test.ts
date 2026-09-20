import { expect, test, vi } from "vite-plus/test";
import {
    createNavigationSessionAdapter,
    createSessionStore,
    leaf,
    serializeNavigation,
    stack,
} from "../../src/index";

test.each([true, false])(
    "session restores slices only after a committed hydration: %s",
    async (commits) => {
        const original = { tree: stack([leaf("home")]), destinations: [] };
        const candidate = { tree: stack([leaf("saved")]), destinations: [] };
        let current = original;
        const controller = {
            getTree: () => current.tree,
            getSnapshot: () => current,
            hydrate: vi.fn(async () => {
                if (commits) current = candidate;
                return candidate;
            }),
        };
        let draft = "original";
        const session = createSessionStore({
            storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
            navigation: createNavigationSessionAdapter(controller as never),
        });
        session.register<string>({
            key: "draft",
            version: 1,
            capture: () => draft,
            decode: (value) => String(value),
            restore: (value) => {
                draft = value;
            },
        });
        const result = await session.restore({
            version: 2,
            capturedAt: 1,
            navigation: serializeNavigation(candidate.tree),
            scoped: {},
            slices: { draft: { version: 1, data: "saved" } },
        });
        expect(result.status).toBe(commits ? "restored" : "failed");
        expect(draft).toBe(commits ? "saved" : "original");
        await session.dispose();
    },
);
