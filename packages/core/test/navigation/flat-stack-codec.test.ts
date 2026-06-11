import { describe, expect, test } from "vite-plus/test";
import { createFlatStackCodec } from "../../src/navigation/codec";
import { leaf, stack } from "../../src/navigation/nodes";
import { Router } from "../../src/router/router";

describe("flat stack codec", () => {
    test("decode：可路由 URL → 单叶栈", () => {
        const router = new Router();
        router.add("/item/:id", "detail");
        const codec = createFlatStackCodec();
        expect(codec.decode("/item/7", router)).toEqual(stack([leaf("detail", { id: "7" })]));
    });

    test("decode：多段路径 + 多参数", () => {
        const router = new Router();
        router.add("/user/:userId/post/:postId", "userPost");
        const codec = createFlatStackCodec();
        expect(codec.decode("/user/42/post/99", router)).toEqual(
            stack([leaf("userPost", { userId: "42", postId: "99" })]),
        );
    });

    test("decode：静态路由（无参数）", () => {
        const router = new Router();
        router.add("/home", "home");
        const codec = createFlatStackCodec();
        expect(codec.decode("/home", router)).toEqual(stack([leaf("home", {})]));
    });

    test("encode：取激活叶子的 URL", () => {
        const router = new Router();
        router.add("/item/:id", "detail");
        const codec = createFlatStackCodec();
        const url = codec.encode(stack([leaf("home"), leaf("detail", { id: "7" })]), router);
        expect(url).toBe("/item/7");
    });

    test("encode：栈为空时回退 /", () => {
        const router = new Router();
        const codec = createFlatStackCodec();
        expect(codec.encode(stack([]), router)).toBe("/");
    });

    test("encode：无对应路由时回退 /", () => {
        const router = new Router();
        router.add("/other", "other");
        const codec = createFlatStackCodec();
        // leaf "unknown" 无路由可反查
        expect(codec.encode(stack([leaf("unknown", {})]), router)).toBe("/");
    });

    test("decode：不可路由 URL → undefined（保留当前树）", () => {
        const codec = createFlatStackCodec();
        expect(codec.decode("/nope", new Router())).toBeUndefined();
    });

    test("decode：query 参数也回填进 params", () => {
        const router = new Router();
        router.add("/search", "search");
        const codec = createFlatStackCodec();
        expect(codec.decode("/search?q=hello", router)).toEqual(
            stack([leaf("search", { q: "hello" })]),
        );
    });
});
