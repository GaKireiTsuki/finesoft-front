import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, expect, test } from "vite-plus/test";
import { generateFrontTypes } from "../src/public-types";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { force: true, recursive: true });
});
function fixture(config: string, dependencies: Record<string, string> = { react: "*" }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "front-public-types-"));
    roots.push(root);
    fs.symlinkSync(
        fileURLToPath(new URL("../../../templates/react/node_modules", import.meta.url)),
        path.join(root, "node_modules"),
        "dir",
    );
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ type: "module", dependencies }),
    );
    fs.writeFileSync(path.join(root, "tsconfig.json"), config);
    return root;
}
function read(root: string) {
    return ts.readConfigFile(path.join(root, "tsconfig.json"), (file) => ts.sys.readFile(file))
        .config;
}

test("maintains only selected native types and does not rewrite unchanged files", () => {
    const root = fixture('{"compilerOptions":{"strict":true}}');
    expect(generateFrontTypes({ root })).toHaveLength(2);
    const output = fs.readFileSync(path.join(root, ".finesoft/front.d.ts"), "utf8");
    expect(output).toContain("react: typeof react");
    expect(output).not.toMatch(/vue|svelte/);
    expect(read(root).compilerOptions.paths["@finesoft/front"]).toEqual(["./.finesoft/front.d.ts"]);
    expect(generateFrontTypes({ root })).toEqual([]);
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    expect(generateFrontTypes({ root })).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, ".finesoft/front.d.ts"), "utf8")).not.toContain(
        "react:",
    );
});

test.each([
    '{/*keep*/ "compilerOptions":{"strict":true,},}',
    '{/*keep*/ "compilerOptions":{},}',
    "{/*keep*/}",
])("preserves JSONC comments and trailing commas: %s", (config) => {
    const root = fixture(config);
    generateFrontTypes({ root });
    expect(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8")).toContain("/*keep*/");
    expect(read(root).compilerOptions.paths["@finesoft/front"]).toHaveLength(1);
    expect(generateFrontTypes({ root })).toEqual([]);
});

test("keeps inherited aliases and resolves the root alias relative to baseUrl", () => {
    const root = fixture('{"extends":"./config/base.json","compilerOptions":{"baseUrl":"./src"}}');
    fs.mkdirSync(path.join(root, "config"));
    fs.writeFileSync(
        path.join(root, "config/base.json"),
        '{"compilerOptions":{"paths":{"@models/*":["../models/*"]}}}',
    );
    generateFrontTypes({ root });
    expect(read(root).compilerOptions.paths).toEqual({
        "@models/*": ["../models/*"],
        "@finesoft/front": ["../.finesoft/front.d.ts"],
    });
});

test("preserves an explicit user-owned root alias", () => {
    const original = '{"compilerOptions":{"paths":{"@finesoft/front":["./custom.ts"]}}}';
    const root = fixture(original);
    expect(generateFrontTypes({ root })).toEqual([]);
    expect(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8")).toBe(original);
    expect(fs.existsSync(path.join(root, ".finesoft/front.d.ts"))).toBe(false);
});

test("generated declarations cannot follow a symlink outside the project", () => {
    const root = fixture("{}");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "front-public-types-outside-"));
    roots.push(outside);
    fs.symlinkSync(outside, path.join(root, ".finesoft"), "dir");
    expect(() => generateFrontTypes({ root })).toThrow("cannot edit outside");
    expect(fs.readdirSync(outside)).toEqual([]);
});
