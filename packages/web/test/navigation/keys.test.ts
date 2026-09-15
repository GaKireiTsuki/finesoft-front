import { describe, expect, test } from "vite-plus/test";
import { entryKey } from "../../src/navigation/keys";

describe("entryKey", () => {
    test("intent + 空格 + stableStringify(params)", () => {
        expect(entryKey("home", {})).toBe("home {}");
        expect(entryKey("detail", { id: 7 })).toBe('detail {"id":7}');
    });
    test("params 键序无关（stableStringify 排序）", () => {
        expect(entryKey("x", { a: 1, b: 2 })).toBe(entryKey("x", { b: 2, a: 1 }));
    });
    test("分隔符是真 ASCII 空格(0x20)，非 null/其它", () => {
        expect(entryKey("a", {}).charCodeAt(1)).toBe(0x20);
    });
});
