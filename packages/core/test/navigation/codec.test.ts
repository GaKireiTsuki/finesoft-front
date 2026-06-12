import { describe, expect, test } from "vite-plus/test";
import {
    createActiveLeafCodec,
    createFullStateCodec,
    DEFAULT_NAV_PARAM,
    decodeNavigationTreeParam,
    encodeNavigationTreeParam,
    type NavigationRouterLike,
} from "../../src/navigation/codec";
import { leaf, split, stack, tabs } from "../../src/navigation/nodes";
import { NavigationError, type NavigationNode } from "../../src/navigation/types";
import { Router } from "../../src/router/router";

// 真实 Router：用其 getRoutes() 摘要驱动 codec 的反查（端到端验证摘要格式契约）。
function realRouter(): Router {
    const router = new Router();
    router.add("/", "home");
    router.add("/products/:id", "product");
    router.add("/blog/:slug?", "blog");
    router.add("/search", "search");
    return router;
}

// 轻量 stub：仅实现 codec 依赖的 NavigationRouterLike 读取面。
function stubRouter(
    routes: string[],
    reverse?: NavigationRouterLike["reverse"],
): NavigationRouterLike {
    return { getRoutes: () => routes, reverse };
}

describe("createActiveLeafCodec — encode (reverse active leaf)", () => {
    test("single leaf with a path param reverses to its route URL", () => {
        const codec = createActiveLeafCodec();
        expect(codec.encode(leaf("product", { id: 42 }), realRouter())).toBe("/products/42");
    });

    test("leaf with no params reverses to a static route", () => {
        const codec = createActiveLeafCodec();
        expect(codec.encode(leaf("home"), realRouter())).toBe("/");
    });

    test("leftover (non-path) params become a sorted query string", () => {
        const codec = createActiveLeafCodec();
        // id consumed by path; sort + page stay as query, sorted by key for stability.
        expect(codec.encode(leaf("product", { id: 7, sort: "asc", page: 2 }), realRouter())).toBe(
            "/products/7?page=2&sort=asc",
        );
    });

    test("static route carries all params as query (sorted)", () => {
        const codec = createActiveLeafCodec();
        expect(codec.encode(leaf("search", { q: "hi", page: 3 }), realRouter())).toBe(
            "/search?page=3&q=hi",
        );
    });

    test("optional path segment is omitted when the param is missing", () => {
        const codec = createActiveLeafCodec();
        // `/blog/:slug?` with no slug reverses to the static prefix `/blog`.
        expect(codec.encode(leaf("blog"), realRouter())).toBe("/blog");
    });

    test("optional path segment is filled when the param is present", () => {
        const codec = createActiveLeafCodec();
        expect(codec.encode(leaf("blog", { slug: "hello" }), realRouter())).toBe("/blog/hello");
    });

    test("the ACTIVE leaf of a composed tree drives the URL", () => {
        const codec = createActiveLeafCodec();
        const tree: NavigationNode = tabs({
            active: "shop",
            branches: {
                home: leaf("home"),
                shop: stack([leaf("home"), leaf("product", { id: 99 })]),
            },
        });
        expect(codec.encode(tree, realRouter())).toBe("/products/99");
    });

    test("split active leaf = last non-empty column's visible leaf", () => {
        const codec = createActiveLeafCodec();
        const tree: NavigationNode = split([
            { id: "list", content: leaf("search", { q: "x" }) },
            { id: "detail", content: leaf("product", { id: 5 }) },
        ]);
        expect(codec.encode(tree, realRouter())).toBe("/products/5");
    });

    test("falls back to '/' when no route matches the intent", () => {
        const codec = createActiveLeafCodec();
        expect(codec.encode(leaf("unknown-intent"), realRouter())).toBe("/");
    });

    test("falls back to '/' when the tree has no visible leaf (empty stack)", () => {
        const codec = createActiveLeafCodec();
        expect(codec.encode(stack([]), realRouter())).toBe("/");
    });

    test("special characters in path params are percent-encoded", () => {
        const codec = createActiveLeafCodec();
        expect(codec.encode(leaf("product", { id: "a b/c" }), realRouter())).toBe(
            "/products/a%20b%2Fc",
        );
    });

    test("prefers Router.reverse when the router provides it", () => {
        const codec = createActiveLeafCodec();
        const router = stubRouter(
            ["/products/:id → product"],
            (intentId, params) => `/custom/${intentId}/${String(params.id)}`,
        );
        expect(codec.encode(leaf("product", { id: 1 }), router)).toBe("/custom/product/1");
    });

    test("falls back to summary reverse when Router.reverse returns undefined", () => {
        const codec = createActiveLeafCodec();
        const router = stubRouter(["/products/:id → product"], () => undefined);
        expect(codec.encode(leaf("product", { id: 8 }), router)).toBe("/products/8");
    });
});

describe("createActiveLeafCodec — decode", () => {
    test("returns undefined for a plain URL (controller does async Router.resolve)", () => {
        const codec = createActiveLeafCodec();
        expect(codec.decode("/products/42", realRouter())).toBeUndefined();
    });

    test("restores the WHOLE tree when a __nav structural overlay is present", () => {
        const codec = createActiveLeafCodec();
        const tree: NavigationNode = tabs({
            active: "b",
            branches: { a: leaf("a"), b: leaf("b", { x: 1 }) },
        });
        const url = `/anything?${DEFAULT_NAV_PARAM}=${encodeNavigationTreeParam(tree)}`;
        expect(codec.decode(url, realRouter())).toEqual(tree);
    });

    test("ignores an empty __nav param (treated as absent)", () => {
        const codec = createActiveLeafCodec();
        expect(codec.decode(`/x?${DEFAULT_NAV_PARAM}=`, realRouter())).toBeUndefined();
    });

    test("throws NavigationError on a malformed __nav overlay", () => {
        const codec = createActiveLeafCodec();
        expect(() =>
            codec.decode(`/x?${DEFAULT_NAV_PARAM}=%%%not-base64%%%`, realRouter()),
        ).toThrow(NavigationError);
    });
});

describe("createFullStateCodec — encode/decode round-trip", () => {
    test("encodes the whole tree into the reserved param and restores it losslessly", () => {
        const codec = createFullStateCodec();
        const tree: NavigationNode = split([
            { id: "sidebar", content: leaf("home") },
            {
                id: "content",
                content: tabs({
                    active: "browse",
                    branches: {
                        browse: stack([leaf("search", { q: "a" }), leaf("product", { id: 1 })]),
                        settings: split([{ id: "panel", content: leaf("blog") }, { id: "extra" }]),
                    },
                }),
            },
        ]);
        const url = codec.encode(tree, realRouter());
        expect(url).toContain(`${DEFAULT_NAV_PARAM}=`);
        expect(codec.decode(url, realRouter())).toEqual(tree);
    });

    test("a single leaf round-trips (full-state path is backward compatible)", () => {
        const codec = createFullStateCodec();
        const tree = leaf("product", { id: 42, sort: "asc" });
        const url = codec.encode(tree, realRouter());
        expect(codec.decode(url, realRouter())).toEqual(tree);
    });

    test("empty split columns (undefined content) survive the round-trip", () => {
        const codec = createFullStateCodec();
        const tree = split([{ id: "list", content: leaf("home") }, { id: "detail" }]);
        const out = codec.decode(codec.encode(tree, realRouter()), realRouter());
        expect(out).toEqual(tree);
        expect((out as ReturnType<typeof split>).columns[1].content).toBeUndefined();
    });

    test("rich JSON params (numbers, booleans, null, arrays, nested) survive", () => {
        const codec = createFullStateCodec();
        const tree = leaf("product", {
            id: 1.5,
            on: true,
            nil: null,
            arr: [1, "two", false],
            nested: { deep: { v: 9 } },
        });
        expect(codec.decode(codec.encode(tree, realRouter()), realRouter())).toEqual(tree);
    });

    test("Unicode params survive the URL-safe encoding", () => {
        const codec = createFullStateCodec();
        const tree = leaf("blog", { slug: "café—日本語—🚀" });
        expect(codec.decode(codec.encode(tree, realRouter()), realRouter())).toEqual(tree);
    });

    test("the base path reflects the active leaf (preserves app-relevant path)", () => {
        const codec = createFullStateCodec();
        const tree: NavigationNode = stack([leaf("home"), leaf("product", { id: 7 })]);
        const url = codec.encode(tree, realRouter());
        expect(url.startsWith("/products/7?")).toBe(true);
        expect(codec.decode(url, realRouter())).toEqual(tree);
    });

    test("a custom param name is honored on both encode and decode", () => {
        const codec = createFullStateCodec({ param: "nav" });
        const tree = leaf("home");
        const url = codec.encode(tree, realRouter());
        expect(url).toContain("nav=");
        expect(url).not.toContain(`${DEFAULT_NAV_PARAM}=`);
        expect(codec.decode(url, realRouter())).toEqual(tree);
    });

    test("decode returns undefined when the reserved param is absent", () => {
        const codec = createFullStateCodec();
        expect(codec.decode("/products/42", realRouter())).toBeUndefined();
    });

    test("decode ignores an empty reserved param", () => {
        const codec = createFullStateCodec();
        expect(codec.decode(`/x?${DEFAULT_NAV_PARAM}=`, realRouter())).toBeUndefined();
    });

    test("throws NavigationError on malformed reserved-param payload", () => {
        const codec = createFullStateCodec();
        // valid base64url that decodes to invalid JSON.
        const garbage = encodeNavigationTreeParam(leaf("x")).slice(0, 4) + "AAAA";
        expect(() => codec.decode(`/x?${DEFAULT_NAV_PARAM}=${garbage}`, realRouter())).toThrow(
            NavigationError,
        );
    });
});

describe("encodeNavigationTreeParam / decodeNavigationTreeParam", () => {
    test("output is URL-safe (no '+', '/', or '=' characters)", () => {
        const tree = leaf("blog", { slug: "a/b+c==d 日本" });
        const encoded = encodeNavigationTreeParam(tree);
        expect(encoded).not.toMatch(/[+/=]/);
    });

    test("encoding is deterministic regardless of params key order", () => {
        const a = encodeNavigationTreeParam(leaf("x", { b: 2, a: 1 }));
        const b = encodeNavigationTreeParam(leaf("x", { a: 1, b: 2 }));
        expect(a).toBe(b);
    });

    test("structurally different trees encode differently", () => {
        expect(encodeNavigationTreeParam(leaf("x"))).not.toBe(encodeNavigationTreeParam(leaf("y")));
    });

    test("decode rejects non-base64url garbage", () => {
        expect(() => decodeNavigationTreeParam("@@@@")).toThrow(NavigationError);
    });

    test("decode rejects valid base64url whose JSON is not a navigation node", () => {
        // base64url("{}") — valid base64url, valid JSON, but not a node → structure validation throws.
        const emptyObject = base64UrlOf("{}");
        expect(() => decodeNavigationTreeParam(emptyObject)).toThrow(NavigationError);
        // base64url of an unknown-kind node.
        const bogusKind = base64UrlOf(JSON.stringify({ kind: "bogus" }));
        expect(() => decodeNavigationTreeParam(bogusKind)).toThrow(NavigationError);
    });

    test("a real node survives the round-trip (sanity for the negative cases above)", () => {
        const encoded = encodeNavigationTreeParam(leaf("x", { id: 1 }));
        expect(decodeNavigationTreeParam(encoded)).toEqual(leaf("x", { id: 1 }));
    });
});

// 把 ASCII JSON 串编码为 base64url，模拟「合法 base64url 但非导航节点」的负例输入。
// 测试环境（vite-plus/test）提供 btoa，与生产 base64 路径一致。
function base64UrlOf(json: string): string {
    return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
