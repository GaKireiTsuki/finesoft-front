import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
const root = new URL("../", import.meta.url).pathname;
const fixture = await mkdtemp(resolve(tmpdir(), "front-publish-transform-"));
const run = (name) =>
    execFileSync(process.execPath, [root + "scripts/" + name + "-front-publish.mjs"], {
        cwd: fixture,
        stdio: "pipe",
    });
try {
    const original = await readFile(root + "packages/front/package.json");
    await writeFile(fixture + "/package.json", original);
    assert.throws(() => run("prepare")); // A failed preparation restores the exact manifest.
    assert.deepEqual(await readFile(fixture + "/package.json"), original);
    await assert.rejects(access(fixture + "/package.json.publish-backup"));
    await mkdir(fixture + "/dist");
    await writeFile(fixture + "/dist/index.mjs", "export {};\n");
    await writeFile(fixture + "/dist/index.mjs.map", "{}\n");
    run("prepare");
    const prepared = JSON.parse(await readFile(fixture + "/package.json"));
    assert.equal(prepared.devDependencies, undefined);
    assert.ok(prepared.files.includes("dist/index.mjs"));
    assert.ok(!prepared.files.includes("dist/index.mjs.map"));
    assert.throws(() => run("prepare")); // A duplicate invocation cannot clobber the backup.
    run("restore");
    assert.deepEqual(await readFile(fixture + "/package.json"), original);
    run("restore"); // Idempotent postpack/cleanup.
    console.log(
        "publish transforms: success, failure, duplicate prepare and idempotent restore passed",
    );
} finally {
    await rm(fixture, { recursive: true, force: true });
}
