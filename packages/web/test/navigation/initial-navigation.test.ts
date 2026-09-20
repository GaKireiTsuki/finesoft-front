import { expect, test } from "vite-plus/test";
import {
    createActiveLeafCodec,
    createWebRuntime,
    defineWebApp,
    leaf,
    resolveInitialNavigation,
    stack,
} from "../../src";
import { int } from "@finesoft/core";

const page = (id: string, path: string) => ({
    id,
    routes: [path],
    handler: () => ({ id, pageType: id, title: id }),
});
function runtime() {
    return createWebRuntime({
        definition: defineWebApp({
            id: "initial",
            pages: [
                page("detail", "/item/:id"),
                page("userPost", "/user/:userId/post/:postId"),
                page("home", "/home"),
                page("search", "/search"),
            ],
            getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
        }),
    });
}
test.each([
    ["/item/7", "detail", { id: "7" }],
    ["/user/42/post/99", "userPost", { userId: "42", postId: "99" }],
    ["/home", "home", {}],
    ["/search?q=hello", "search", { q: "hello" }],
])("initial navigation resolves %s using the page's router", async (url, intent, params) => {
    const web = runtime();
    expect(await resolveInitialNavigation(web, url)).toMatchObject({
        tree: { kind: "stack", entries: [{ intent, params }] },
    });
    await web.dispose();
});
test("unknown URL produces no target and active-leaf encoding covers ordinary stacks", async () => {
    const web = runtime();
    const codec = createActiveLeafCodec();
    expect(await resolveInitialNavigation(web, "/missing")).toBeUndefined();
    expect(codec.encode(stack([leaf("home"), leaf("detail", { id: "7" })]), web.router)).toBe(
        "/item/7",
    );
    expect(codec.encode(stack([]), web.router)).toBe("/");
    expect(codec.encode(stack(leaf("unknown")), web.router)).toBe("/");
    await web.dispose();
});
test("application navigation receives the validated match and retains the URL alias", async () => {
    let received: unknown;
    const web = createWebRuntime({
        definition: defineWebApp({
            id: "typed",
            pages: [
                {
                    id: "detail",
                    routes: [{ path: "/item/:id", params: { id: int() } }],
                    handler: () => ({ id: "detail", pageType: "detail", title: "Detail" }),
                },
            ],
            navigation(input) {
                received = input;
                return input.target && stack(input.target);
            },
            getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
        }),
    });
    const result = await resolveInitialNavigation(web, "/item/42");
    expect(received).toMatchObject({
        match: { intent: { id: "detail", params: { id: 42 } } },
        target: { intent: "detail", params: { id: 42 }, url: "/item/42" },
    });
    expect(result?.tree).toMatchObject({ entries: [{ params: { id: 42 } }] });
    await web.dispose();
});
