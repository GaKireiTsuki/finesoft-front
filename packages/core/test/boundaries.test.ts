import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { findForbiddenCoreDependencies } from "./utils/core-boundaries";

test("core has no platform or Web dependency", () => {
    expect(findForbiddenCoreDependencies()).toEqual([]);
});

test.each([
    "@finesoft/web",
    "@finesoft/front",
    "@finesoft/front/web",
    "@finesoft/front/browser",
    "@finesoft/front/node",
    "vite-plus",
    "vite-plus/pack",
])("rejects a core value import through %s", (specifier) => {
    const root = makeFixture(`import { dependency } from ${JSON.stringify(specifier)};`);
    expect(findForbiddenCoreDependencies(root)).toContain(`sample.ts: ${specifier}`);
});

test("rejects variable dynamic Node imports through an internal dependency", () => {
    const root = makeFixture('export { dependency } from "./nested/dependency";');
    mkdirSync(join(root, "nested"));
    writeFileSync(
        join(root, "nested/dependency.ts"),
        'const specifier = "node:dns/promises"; export const dependency = import(specifier);',
    );
    expect(findForbiddenCoreDependencies(root)).toContain(
        "nested/dependency.ts: node:dns/promises",
    );
});

test("permits pure relative core helpers", () => {
    const root = makeFixture('export { dependency } from "./dependency";');
    writeFileSync(join(root, "dependency.ts"), 'export const dependency = "portable";');
    expect(findForbiddenCoreDependencies(root)).toEqual([]);
});

const fixtures: string[] = [];
function makeFixture(source: string): string {
    const root = mkdtempSync(join(tmpdir(), "finesoft-core-boundary-"));
    fixtures.push(root);
    writeFileSync(join(root, "sample.ts"), source);
    return root;
}

afterEach(() => {
    for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});
