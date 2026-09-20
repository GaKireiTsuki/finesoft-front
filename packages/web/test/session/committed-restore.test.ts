import { expect, test } from "vite-plus/test";
import {
    createWebRuntime,
    createWebSession,
    defineWebApp,
    deny,
    next,
    createSessionStore,
    leaf,
    serializeNavigation,
    stack,
} from "../../src/index";

test.each([true, false])(
    "session restores slices only after a committed hydration: %s",
    async (commits) => {
        const web = createWebRuntime({
            definition: defineWebApp({
                id: "committed-restore",
                pages: ["home", "saved"].map((id) => ({
                    id,
                    handler: () => ({ id, pageType: id, title: id }),
                })),
                getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
                beforeCommit: [
                    ({ candidate }) =>
                        !commits && candidate.destinations[0]?.intent === "saved"
                            ? deny(403, "Denied")
                            : next(),
                ],
            }),
        });
        const navigation = createWebSession({ web, initial: stack(leaf("home")) });
        const original = await navigation.start();
        const saved = stack(leaf("saved"));
        let draft = "original";
        const session = createSessionStore({
            storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
            navigation,
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
            navigation: serializeNavigation(saved),
            scoped: {},
            slices: { draft: { version: 1, data: "saved" } },
        });
        expect(result.status).toBe(commits ? "restored" : "failed");
        expect(draft).toBe(commits ? "saved" : "original");
        if (commits) expect(navigation.captureNavigation()).toEqual(serializeNavigation(saved));
        else expect(navigation.getSnapshot()).toBe(original);
        await session.dispose();
        await navigation.dispose();
        await web.dispose();
    },
);
