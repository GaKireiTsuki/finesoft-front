import { expect, test } from "vite-plus/test";
import { findForbiddenCoreDependencies } from "./utils/core-boundaries";

test("core has no platform or Web dependency", () => {
    expect(findForbiddenCoreDependencies()).toEqual([]);
});
