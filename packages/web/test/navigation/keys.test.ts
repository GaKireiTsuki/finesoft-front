import { describe, expect, test } from "vite-plus/test";
import { resourceKey } from "../../src/navigation/keys";

describe("resourceKey", () => {
    test("intent + 空格 + stableStringify(params)", () => {
        expect(resourceKey("home", {})).toBe('["home",null,null,{}]');
        expect(resourceKey("detail", { id: 7 })).toBe('["detail",null,null,{"id":7}]');
    });
    test("params 键序无关（stableStringify 排序）", () => {
        expect(resourceKey("x", { a: 1, b: 2 })).toBe(resourceKey("x", { b: 2, a: 1 }));
    });
    test("分隔符是真 ASCII 空格(0x20)，非 null/其它", () => {
        expect(resourceKey("a", {}, { identity: "one" })).not.toBe(
            resourceKey("a", {}, { identity: "two" }),
        );
    });
});
