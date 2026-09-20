/** Repeated generator timings against a disposable copy of the full React template. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const source = path.resolve(
    workspace,
    process.argv[2] ?? "packages/server/src/controller-types.ts",
);
const evidence = path.resolve(
    workspace,
    process.argv[3] ?? "reports/controller-type-latency/generator.json",
);
const { createControllerTypeWatcher, generateControllerTypes, releaseControllerTypes } =
    await import(pathToFileURL(source).href);
const count = Number(process.argv[4] ?? 8);
assert.ok(Number.isInteger(count) && count >= 2);
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "front-type-latency-")));
const template = path.join(workspace, "templates/react");
const samples = [];
const watching = process.argv[5] === "watch";
let watcher;
let watchedFiles = [];
const measure = (kind) => {
    ts.performance.clearMarks();
    ts.performance.clearMeasures();
    const start = performance.now();
    const result = watcher ? watcher.update(watchedFiles) : generateControllerTypes({ root });
    const elapsedMs = Math.round((performance.now() - start) * 1000) / 1000;
    const phases = {};
    ts.performance.forEachMeasure((name, ms) => {
        phases[name] = Math.round(ms * 10) / 10;
    });
    global.gc?.();
    samples.push({
        kind,
        elapsedMs,
        ...(result.cache ? { cache: result.cache } : {}),
        changed: result.changed.map((file) => path.relative(root, file)),
        phases,
        ...(global.gc
            ? { heapMiB: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10 }
            : {}),
    });
    return result;
};
try {
    fs.cpSync(template, root, {
        recursive: true,
        filter: (file) =>
            !path
                .relative(template, file)
                .split(path.sep)
                .some((part) => ["node_modules", "dist", ".finesoft"].includes(part)),
    });
    fs.symlinkSync(path.join(template, "node_modules"), path.join(root, "node_modules"), "dir");
    const routes = path.join(root, "src/app-definition.ts");
    watchedFiles = [routes];
    const initial = fs.readFileSync(routes, "utf8");
    const generated = path.join(root, ".finesoft/controller-types.d.ts");
    ts.performance.enable();
    assert.equal(measure("cold").controllers, 2);
    if (watching) watcher = createControllerTypeWatcher({ root });
    for (let i = 0; i < count; i++) {
        const numeric = i % 2 === 1;
        fs.writeFileSync(routes, numeric ? initial : initial.replace("id: int()", "id: str()"));
        assert.ok(measure("route-change").changed.includes(generated));
        assert.match(fs.readFileSync(generated, "utf8"), numeric ? /id: number/ : /id: string/);
        assert.deepEqual(measure("unchanged").changed, []);
    }
    if (watching) {
        for (let i = 0; i < count; i++) {
            fs.writeFileSync(
                routes,
                initial.replace(
                    'q: withDefault(str(), "")',
                    `q: withDefault(str(), ""), unique${i}: str()`,
                ),
            );
            assert.equal(measure("new-schema").cache, "generated");
            assert.match(fs.readFileSync(generated, "utf8"), new RegExp(`unique${i}: string`));
            assert.deepEqual(measure("unchanged").changed, []);
        }
    }
    const median = (values) => {
        const sorted = [...values].sort((a, b) => a - b);
        return (
            (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) /
            2
        );
    };
    const changed = samples
        .filter((sample) => sample.kind === "route-change")
        .map((sample) => sample.elapsedMs)
        .sort((a, b) => a - b);
    const result = {
        source: path.relative(workspace, source),
        node: process.version,
        fixture: "full React template; same route alternates between int() and str()",
        medianMs:
            Math.round(
                (changed[Math.floor((count - 1) / 2)] + changed[Math.floor(count / 2)]) * 5,
            ) / 10,
        minMs: changed[0],
        maxMs: changed.at(-1),
        samples,
        ...(watching
            ? {
                  cachedUpdateUs:
                      median(samples.filter((s) => s.cache === "reused").map((s) => s.elapsedMs)) *
                      1000,
                  duplicateSaveUs:
                      median(
                          samples.filter((s) => s.cache === "unchanged").map((s) => s.elapsedMs),
                      ) * 1000,
                  newSchemaMs: median(
                      samples.filter((s) => s.kind === "new-schema").map((s) => s.elapsedMs),
                  ),
              }
            : {}),
    };
    watcher?.close();
    releaseControllerTypes?.(root);
    global.gc?.();
    if (global.gc)
        result.releasedHeapMiB =
            Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
    fs.mkdirSync(path.dirname(evidence), { recursive: true });
    fs.writeFileSync(evidence, JSON.stringify(result, null, 2));
    console.log(
        JSON.stringify({
            source: result.source,
            medianMs: result.medianMs,
            minMs: result.minMs,
            maxMs: result.maxMs,
            ...(watching
                ? {
                      cachedUpdateUs: result.cachedUpdateUs,
                      duplicateSaveUs: result.duplicateSaveUs,
                      newSchemaMs: result.newSchemaMs,
                  }
                : {}),
        }),
    );
} finally {
    watcher?.close();
    releaseControllerTypes?.(root);
    ts.performance.disable();
    fs.rmSync(root, { recursive: true, force: true });
}
