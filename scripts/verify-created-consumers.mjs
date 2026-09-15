/** Check the actual scaffolder output outside the monorepo, against a locally packed front. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = new URL("../", import.meta.url).pathname;
const evidence = root + "reports/application-boundaries/created-consumers";
await fs.mkdir(evidence, { recursive: true });
const run = (args, cwd) =>
    execFileSync("vp", args, { cwd, encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });
await fs.writeFile(
    evidence + "/prepare.log",
    run(["exec", "node", "scripts/prepare-create-cli.mjs"], root),
);
const packed = JSON.parse(
    await fs.readFile(root + "reports/application-boundaries/packed/result.json"),
);
const scratch = await fs.mkdtemp(path.join(tmpdir(), "front-created-consumers-"));
const result = [];
try {
    for (const name of [
        "react",
        "react-minimal",
        "vue",
        "vue-minimal",
        "svelte",
        "svelte-minimal",
    ]) {
        const source = root + "packages/create-app/templates/" + name;
        const config = JSON.parse(await fs.readFile(source + "/tsconfig.json"));
        assert.equal(config.extends, undefined);
        assert.equal(config.compilerOptions.paths, undefined);
        const pkg = JSON.parse(await fs.readFile(source + "/package.json"));
        assert.ok(!JSON.stringify(pkg).includes("workspace:"));
        assert.ok(!JSON.stringify(pkg).includes("catalog:"));
        await fs.copyFile(source + "/tsconfig.json", evidence + "/" + name + "-tsconfig.json");
        if (!name.endsWith("-minimal")) {
            result.push({
                name,
                independentConfiguration: "passed",
                build: "full version built and exercised in workspace matrix",
            });
            continue;
        }
        const cwd = scratch + "/" + name;
        await fs.cp(source, cwd, { recursive: true });
        pkg.dependencies["@finesoft/front"] = "file:" + packed.tarball;
        pkg.packageManager = "pnpm@11.20.0";
        await fs.writeFile(cwd + "/package.json", JSON.stringify(pkg, null, 2));
        await fs.writeFile(evidence + "/" + name + "-install.log", run(["install"], cwd));
        await fs.writeFile(evidence + "/" + name + "-build.log", run(["run", "build"], cwd));
        const output = await fs.stat(cwd + "/dist/server/ssr.js");
        assert.ok(output.size > 0);
        await fs.copyFile(cwd + "/package.json", evidence + "/" + name + "-package.json");
        result.push({
            name,
            independentConfiguration: "passed",
            build: "installed local tarball and built client/SSR outside workspace",
            ssrBytes: output.size,
        });
    }
    await fs.writeFile(
        evidence + "/result.json",
        JSON.stringify({ tarballSha256: packed.sha256, result }, null, 2),
    );
    console.log(
        "All six generated configs independent; React/Vue/Svelte minimal installed and built outside workspace.",
    );
} finally {
    await fs.rm(scratch, { recursive: true, force: true });
}
