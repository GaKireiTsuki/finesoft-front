/**
 * After building core and web, run `vp exec node scripts/verify-web-package.mjs`.
 * Resolves package exports with Node and TypeScript, without source aliases.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumer = mkdtempSync(join(tmpdir(), "finesoft-web-package-"));
const results = [];
const failures = [];

try {
    const packageScope = join(consumer, "node_modules/@finesoft");
    mkdirSync(packageScope, { recursive: true });
    for (const name of ["core", "web"]) {
        symlinkSync(join(repository, "packages", name), join(packageScope, name), "dir");
    }
    for (const [format, extension] of [
        ["ESM", "mts"],
        ["CommonJS", "cts"],
    ]) {
        const js =
            format === "ESM"
                ? 'import { Container } from "@finesoft/core"; import { Framework, Router, defineWebApp } from "@finesoft/web";'
                : 'const { Container } = require("@finesoft/core"); const { Framework, Router, defineWebApp } = require("@finesoft/web");';
        try {
            execFileSync(
                process.execPath,
                [
                    "--input-type=" + (format === "ESM" ? "module" : "commonjs"),
                    "-e",
                    js +
                        '\nconst framework = Framework.create({ definition: defineWebApp({ id: "artifact", routes: [], getErrorPage: (_, title) => ({ id: "error", pageType: "error", title }) }) }); if (!(framework.container instanceof Container) || !(framework.router instanceof Router)) throw new Error("package constructor identity mismatch"); void framework.dispose();',
                ],
                { cwd: consumer, stdio: "pipe" },
            );
            results.push(`${format}: Node package-name load and shared core identity passed`);
        } catch (error) {
            failures.push(
                `${format}: Node package-name load failed: ${error.stderr?.toString().trim() ?? error.message}`,
            );
        }

        const sourcePath = join(consumer, `consumer.${extension}`);
        writeFileSync(
            sourcePath,
            `
import { Container, type Intent, createRuntime, defineApp, defineOperation, createToken, provide } from "@finesoft/core";
import { Framework, Router, defineWebApp } from "@finesoft/web";
const framework: Framework = Framework.create({ definition: defineWebApp({ id: "artifact", routes: [], getErrorPage: (_, title) => ({ id: "error", pageType: "error", title }) }) });
const container: Container = framework.container;
const router: Router = framework.router;
const intent: Intent<string> = { id: "artifact-check" };
const token = createToken<number>("value");
const double = defineOperation({ id: "double", kind: "query", handler: (n: number) => n * 2 });
const runtime = createRuntime({ app: defineApp({ id: "check", operations: [double], providers: [provide({ token, lifetime: "scope", create: () => 42 })] }) });
const numberResult: Promise<number> = runtime.execute(double, 21);
// @ts-expect-error Input reference must reject strings through built declarations.
runtime.execute(double, "wrong");
const tokenResult: Promise<number> = runtime.createExecution().context.get(token);
const closing: Promise<void> = framework.dispose();
void [container, router, intent, numberResult, tokenResult, closing];
`,
        );
        const options = {
            module: ts.ModuleKind.NodeNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            target: ts.ScriptTarget.ESNext,
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            types: [],
        };
        const program = ts.createProgram([sourcePath], options);
        const diagnostics = ts.getPreEmitDiagnostics(program);
        if (diagnostics.length) {
            failures.push(
                `${format}: consumer declaration check failed: ${diagnostics.map((diagnostic) => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`).join("; ")}`,
            );
            continue;
        }
        const declarationExtension = format === "ESM" ? ".d.mts" : ".d.cts";
        const expectedEntries = ["core", "web"].map((name) =>
            realpathSync(join(repository, "packages", name, "dist/index" + declarationExtension)),
        );
        const loadedFiles = new Set(
            program.getSourceFiles().map((file) => realpathSync(file.fileName)),
        );
        for (const entry of expectedEntries)
            assert(loadedFiles.has(entry), `TypeScript did not resolve declared entry ${entry}`);
        for (const file of loadedFiles) {
            if (/\/packages\/(core|web)\//.test(file))
                assert(file.includes("/dist/"), `TypeScript bypassed package artifacts: ${file}`);
        }
        results.push(
            `${format}: NodeNext consumer type-check passed via ${declarationExtension} entries (no source aliases)`,
        );
    }
    console.log(JSON.stringify({ results, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
} finally {
    rmSync(consumer, { recursive: true, force: true });
}
