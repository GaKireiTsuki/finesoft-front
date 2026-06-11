import { describe, expect, test } from "vite-plus/test";
import { islandContainerAttributes } from "../../src/navigation/islands";

describe("islandContainerAttributes", () => {
    test("returns the data-fs-* marker attribute set（client/server 共用单一来源）", () => {
        expect(islandContainerAttributes("detail", 'detail {"id":"1"}')).toEqual({
            "data-fs-entry": "",
            "data-fs-intent": "detail",
            "data-fs-key": 'detail {"id":"1"}',
        });
    });
});
