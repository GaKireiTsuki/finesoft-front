import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vite-plus";
import { expect, test } from "vite-plus/test";

const require = createRequire(import.meta.url);
const toolingRequire = createRequire(realpathSync(require.resolve("vite-plus/package.json")));
const runnerVersion = JSON.parse(
    readFileSync(toolingRequire.resolve("vitest/package.json"), "utf8"),
).version;

test.each([
    ["ESM", defineConfig],
    ["CJS", require("vite-plus").defineConfig],
])("%s coverage guard accepts the installed runner and still rejects mismatches", (_, config) => {
    const root = mkdtempSync(join(tmpdir(), "front-coverage-guard-"));
    const provider = join(root, "node_modules/@vitest/coverage-v8");
    mkdirSync(provider, { recursive: true });
    function check(version) {
        writeFileSync(join(provider, "package.json"), JSON.stringify({ version }));
        const guard = config({}).plugins.find(
            (plugin) => plugin.name === "vite-plus:coverage-version-guard",
        );
        guard.configureVitest({
            vitest: {
                config: { root, coverage: { enabled: true, provider: "v8" } },
                enableCoverage: async () => {},
            },
        });
    }
    try {
        expect(() => check(runnerVersion)).not.toThrow();
        expect(() => check("0.0.0")).toThrow(
            "A coverage provider must match the test runner version",
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
