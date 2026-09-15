import { expect, test } from "vite-plus/test";
import {
    defineWebApp,
    Framework,
    createNavigationController,
    createNavigationSessionAdapter,
    createSessionStore,
    leaf,
    stack,
    serializeNavigation,
} from "../../src/index";

test.each(["deny", "redirect", "commit"] as const)(
    "session accepts only committed hydration: %s",
    async (mode) => {
        const definition = defineWebApp({
            id: "restore",
            controllers: ["home", "saved"].map((id) => ({
                id,
                handler: () => ({ id, pageType: id, title: id }),
            })),
            routes: [
                { path: "/", intentId: "home" },
                {
                    path: "/saved",
                    intentId: "saved",
                    beforeLoad: [
                        () =>
                            mode === "commit"
                                ? { kind: "next" }
                                : mode === "deny"
                                  ? { kind: "deny", status: 403, message: "Denied" }
                                  : { kind: "redirect", status: 302, url: "/" },
                    ],
                },
            ],
            getErrorPage: (_, title) => ({ id: "error", pageType: "error", title }),
        });
        const framework = Framework.create({ definition });
        const navigation = createNavigationController({
            framework,
            initial: stack(leaf("home", {}, { url: "/" })),
        });
        await navigation.resolve();
        const original = navigation.getSnapshot();
        let draft = "original";
        const session = createSessionStore({
            storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
            navigation: createNavigationSessionAdapter(navigation),
        });
        session.scope.set("original", "original scope");
        const originalScope = session.scope;
        session.register({
            key: "draft",
            version: 1,
            capture: () => draft,
            decode: (x) => String(x),
            restore: (x) => {
                draft = String(x);
            },
        });
        const result = await session.restore({
            version: 1,
            capturedAt: 1,
            navigation: serializeNavigation(stack(leaf("saved", {}, { url: "/saved" }))),
            scoped: { saved: "saved scope" },
            slices: { draft: { version: 1, data: "saved draft" } },
        });
        expect(result.status).toBe(mode === "commit" ? "restored" : "failed");
        if (mode === "commit") {
            expect(navigation.getSnapshot()).not.toBe(original);
            expect(draft).toBe("saved draft");
            expect(session.scope.get("saved")).toBe("saved scope");
        } else {
            expect(navigation.getSnapshot()).toBe(original);
            expect(session.scope).toBe(originalScope);
            expect(session.scope.get("original")).toBe("original scope");
            expect(draft).toBe("original");
        }
        await session.dispose();
        await navigation.dispose();
        await framework.dispose();
    },
);
