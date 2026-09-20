import { describe, expect, test } from "vite-plus/test";
import { compilePath } from "../../src/routing/path";

describe("compilePath", () => {
    test("matches encoded segments before decoding, including encoded slashes", () => {
        const path = compilePath("/files/:name/:optional?");
        const params = path.match("/files/a%2Fb");
        expect(params).toEqual({ name: "a/b", optional: undefined });
        expect(Object.getPrototypeOf(params!)).toBeNull();
        expect(path.reverse({ name: "a/b" })).toBe("/files/a%2Fb");
    });
    test("rejects malformed percent-encoded captures without throwing", () => {
        expect(compilePath("/files/:name").match("/files/%E0%A4%A")).toBeNull();
    });
});
