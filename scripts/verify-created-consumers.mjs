/** Check the actual scaffolder output outside the monorepo, against a locally packed front. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url).pathname;
const evidence = path.resolve(
    root,
    process.env.FINESOFT_VERIFY_REPORT_DIR ?? "reports/template-unification/created-consumers",
);
assert.ok(process.argv[2], "Usage: vp exec node scripts/verify-created-consumers.mjs <front.tgz>");
const tarball = path.resolve(process.argv[2]);
const sha256 = createHash("sha256")
    .update(await fs.readFile(tarball))
    .digest("hex");
await fs.mkdir(evidence, { recursive: true });
const run = (args, cwd) =>
    execFileSync("vp", args, { cwd, encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });
await fs.writeFile(
    evidence + "/prepare.log",
    run(["exec", "node", "scripts/prepare-create-cli.mjs"], root),
);
const scratch = await fs.mkdtemp(path.join(tmpdir(), "front-created-consumers-"));
const result = [];
const typescriptVersion = JSON.parse(
    await fs.readFile(root + "node_modules/typescript/package.json", "utf8"),
).version;
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
        assert.equal(pkg.scripts.prebuild, undefined);
        assert.equal(pkg.scripts.predev, undefined);
        await fs.copyFile(source + "/tsconfig.json", evidence + "/" + name + "-tsconfig.json");
        const cwd = scratch + "/" + name;
        await fs.cp(source, cwd, { recursive: true });
        pkg.dependencies["@finesoft/front"] = "file:" + tarball;
        pkg.packageManager = "pnpm@11.20.0";
        await fs.writeFile(evidence + "/" + name + "-package.json", JSON.stringify(pkg, null, 2));
        pkg.devDependencies ??= {};
        // These are temporary validation-only tools. The generated manifest written to
        // evidence still records its shipped dependencies, while the scratch install
        // proves framework-specific source checking as well as ordinary TypeScript.
        // Match the repository compiler instead of accepting an unrelated automatic
        // peer upgrade (Vue's checker still uses the TypeScript JS compiler API).
        pkg.devDependencies.typescript = typescriptVersion;
        if (name.startsWith("vue")) pkg.devDependencies["vue-tsc"] = "^3.1.3";
        if (name.startsWith("svelte")) pkg.devDependencies["svelte-check"] = "^4.3.4";
        await fs.writeFile(cwd + "/package.json", JSON.stringify(pkg, null, 2));
        await fs.writeFile(evidence + "/" + name + "-install.log", run(["install"], cwd));
        await fs.writeFile(
            evidence + "/" + name + "-check.log",
            run(["check", "--no-fmt", "--no-lint"], cwd),
        );
        await fs.writeFile(
            evidence + "/" + name + "-tsc.log",
            run(["exec", "tsc", "--noEmit", "--project", "tsconfig.json"], cwd),
        );
        if (name.startsWith("vue"))
            await fs.writeFile(
                evidence + "/" + name + "-vue-tsc.log",
                run(["exec", "vue-tsc", "--noEmit", "--project", "tsconfig.json"], cwd),
            );
        if (name.startsWith("svelte"))
            await fs.writeFile(
                evidence + "/" + name + "-svelte-check.log",
                run(["exec", "svelte-check", "--tsconfig", "./tsconfig.json"], cwd),
            );
        await fs.writeFile(evidence + "/" + name + "-build.log", run(["run", "build"], cwd));
        const output = await fs.stat(cwd + "/dist/server/ssr.js");
        assert.ok(output.size > 0);
        await fs.copyFile(
            cwd + "/package.json",
            evidence + "/" + name + "-validation-package.json",
        );
        result.push({
            name,
            independentConfiguration: "passed",
            typecheck: "TypeScript and native component checker passed",
            build: "installed local tarball and built client/SSR outside workspace",
            ssrBytes: output.size,
        });
    }
    await fs.writeFile(
        evidence + "/result.json",
        JSON.stringify({ tarball, tarballSha256: sha256, result }, null, 2),
    );
    console.log(
        "All six generated applications installed the explicit local tarball and built outside the workspace.",
    );
} finally {
    await fs.rm(scratch, { recursive: true, force: true });
}
