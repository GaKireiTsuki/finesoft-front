/** Check the actual scaffolder output outside the monorepo, against a locally packed front. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
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
const browser = await chromium.launch({ channel: "chrome", headless: true });
async function verifyDevelopment(cwd, name) {
    const require = createRequire(cwd + "/package.json");
    const { createServer, createLogger } = await import(
        pathToFileURL(require.resolve("vite")).href
    );
    const errors = [];
    const logger = createLogger("silent");
    logger.error = (message) => errors.push(message);
    const nodeEnv = process.env.NODE_ENV;
    const server = await createServer({
        root: cwd,
        customLogger: logger,
        resolve: { tsconfigPaths: true },
        optimizeDeps: { force: true },
        server: { host: "127.0.0.1", port: 0 },
    });
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(String(error)));
    try {
        await server.listen();
        await server.environments.client.depsOptimizer?.scanProcessing;
        const address = server.httpServer.address();
        await page.goto(`http://127.0.0.1:${address.port}/`);
        await page.evaluate(async () => {
            await (
                await import("/src/main.ts")
            ).started;
        });
        const loaded = page.waitForResponse(
            (response) => new URL(response.url()).pathname === "/__finesoft/controller",
            { timeout: 10000 },
        );
        if (name.endsWith("-minimal"))
            await page.getByRole("button", { name: "Session restoration", exact: true }).click();
        else await page.locator(".product-card").first().getByRole("link").click();
        assert.equal((await loaded).status(), 200);
        await page
            .getByRole("heading", {
                name: name.endsWith("-minimal") ? "Item 2" : "Product 1",
                exact: true,
            })
            .waitFor();
        assert.deepEqual(errors, []);
        console.log(name + ": standalone cold development and server navigation passed");
    } finally {
        await page.close();
        await server.close();
        if (nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = nodeEnv;
    }
}
const typescriptVersion = JSON.parse(
    await fs.readFile(root + "node_modules/typescript/package.json", "utf8"),
).version;
const packageManager = JSON.parse(await fs.readFile(root + "package.json", "utf8")).packageManager;
const vitestVersion = JSON.parse(
    await fs.readFile(root + "node_modules/vitest/package.json", "utf8"),
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
        assert.deepEqual(config.compilerOptions.paths, {
            "@finesoft/front": ["./.finesoft/front.d.ts"],
        });
        const pkg = JSON.parse(await fs.readFile(source + "/package.json"));
        assert.equal(pkg.packageManager, packageManager);
        assert.ok(!JSON.stringify(pkg).includes("workspace:"));
        assert.ok(!JSON.stringify(pkg).includes("catalog:"));
        assert.equal(pkg.scripts.prebuild, undefined);
        assert.equal(pkg.scripts.predev, undefined);
        await fs.copyFile(source + "/tsconfig.json", evidence + "/" + name + "-tsconfig.json");
        const cwd = scratch + "/" + name;
        await fs.cp(source, cwd, { recursive: true });
        pkg.dependencies["@finesoft/front"] = "file:" + tarball;
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
        await fs.copyFile(
            cwd + "/pnpm-workspace.yaml",
            evidence + "/" + name + "-pnpm-workspace.yaml",
        );
        // Resolve through the installed Vite+ package, not the monorepo, to catch
        // scaffolds that silently reinstall Vite+'s original transitive versions.
        const toolingRequire = createRequire(
            await fs.realpath(cwd + "/node_modules/vite-plus/package.json"),
        );
        const installedToolchain = {};
        for (const dependency of ["vitest", "@vitest/mocker", "@vitest/browser"]) {
            const installed = JSON.parse(
                await fs.readFile(toolingRequire.resolve(dependency + "/package.json"), "utf8"),
            );
            assert.equal(installed.version, vitestVersion, `${name}: ${dependency}`);
            installedToolchain[dependency] = installed.version;
        }
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
        await verifyDevelopment(cwd, name);
        await fs.copyFile(
            cwd + "/package.json",
            evidence + "/" + name + "-validation-package.json",
        );
        result.push({
            name,
            installedToolchain,
            independentConfiguration: "passed",
            typecheck: "TypeScript and native component checker passed",
            build: "installed local tarball and built client/SSR outside workspace",
            development:
                "tsconfigPaths enabled; forced cold dependency scan, hydration and remote controller navigation passed",
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
    await browser.close();
    await fs.rm(scratch, { recursive: true, force: true });
}
