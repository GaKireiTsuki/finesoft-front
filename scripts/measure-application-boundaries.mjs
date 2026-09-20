/** Same-function bundle/request measurements plus complete consumer and framework source inventories. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";
const root = new URL("../", import.meta.url).pathname;
const output = root + "reports/application-boundaries/costs";
await fs.mkdir(output, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const baseline = JSON.parse(
    await fs.readFile(root + "reports/architecture-baseline/baseline-costs.json"),
);
const inventory = JSON.parse(
    await fs.readFile(root + "reports/architecture-baseline/source-cost-inventory.json"),
);
async function files(dir) {
    return (
        await Promise.all(
            (
                await fs.readdir(dir, { withFileTypes: true })
            ).map((e) =>
                e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)],
            ),
        )
    ).flat();
}
const assembly = (p) =>
    /\/(main|ssr|bootstrap|app-definition|views|instance)\.[^/]+$/.test(p) ||
    p.endsWith("/lib/render.ts");
async function initialClientGraph(base) {
    const html = await fs.readFile(base + "/dist/client/index.html", "utf8");
    const script = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/);
    if (!script) throw Error("Missing built module script: " + base);
    const visited = new Set();
    async function walk(file) {
        if (visited.has(file)) return;
        visited.add(file);
        const ast = ts.createSourceFile(
            file,
            await fs.readFile(file, "utf8"),
            ts.ScriptTarget.Latest,
            true,
        );
        for (const node of ast.statements) {
            if (
                (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
                node.moduleSpecifier &&
                ts.isStringLiteral(node.moduleSpecifier) &&
                node.moduleSpecifier.text.startsWith(".")
            ) {
                await walk(path.resolve(path.dirname(file), node.moduleSpecifier.text));
            }
        }
    }
    await walk(path.join(base, "dist/client", script[1].replace(/^\//, "")));
    const entries = await Promise.all(
        [...visited].map(async (file) => {
            const data = await fs.readFile(file);
            return {
                path: path.relative(base, file),
                bytes: data.length,
                gzipBytes: gzipSync(data).length,
            };
        }),
    );
    return {
        files: entries,
        bytes: entries.reduce((n, e) => n + e.bytes, 0),
        gzipBytes: entries.reduce((n, e) => n + e.gzipBytes, 0),
    };
}
const count = (entries) => ({
    files: entries.length,
    lines: entries.reduce((n, e) => n + e.lines, 0),
});
const totals = (entries) => ({
    allSource: count(entries),
    assembly: count(entries.filter((e) => assembly(e.path))),
    controllers: count(entries.filter((e) => e.path.includes("/controllers/"))),
    wrappers: count(entries.filter((e) => /\/App\.|\/components\/PageRenderer\./.test(e.path))),
});
const result = {
    stagedTree: git("write-tree"),
    baseline: baseline.sourceCommit,
    head: git("rev-parse", "HEAD"),
    workingTreeDiffSha256: createHash("sha256").update(git("diff", "HEAD")).digest("hex"),
    timestamp: new Date().toISOString(),
    runtime: process.version,
    method: "Same six templates, default production build. JS sums all client chunks; gzip each independently. Source includes comments/blanks; moved definitions/views/instance plus historical Svelte lib/render counted. Five fresh-process imports may use warm OS caches. Requests: built React-minimal home, 20 warmups/100 consumed HTML responses, local dispatch (not a network benchmark).",
    templates: {},
    imports: {},
};
for (const name of Object.keys(baseline.templates)) {
    const base = path.join(root, "templates", name);
    const assets = [];
    for (const file of (await files(base + "/dist/client")).filter((p) => p.endsWith(".js"))) {
        const data = await fs.readFile(file);
        assets.push({
            path: path.relative(base, file),
            bytes: data.length,
            gzipBytes: gzipSync(data).length,
        });
    }
    const entries = [];
    for (const file of (await files(base + "/src")).filter((p) =>
        /\.(ts|tsx|vue|svelte)$/.test(p),
    )) {
        const data = await fs.readFile(file, "utf8");
        entries.push({
            path: path.relative(base, file),
            lines: data.trimEnd().split("\n").length,
            sha256: createHash("sha256").update(data).digest("hex"),
        });
    }
    result.templates[name] = {
        baselineJs: baseline.templates[name].totalJsBytes,
        baselineGzip: baseline.templates[name].totalGzipBytes,
        js: assets.reduce((n, a) => n + a.bytes, 0),
        gzip: assets.reduce((n, a) => n + a.gzipBytes, 0),
        assets,
        initialStaticGraph: await initialClientGraph(base),
        sourceBefore: totals(inventory.templates[name].entries),
        sourceAfter: totals(entries),
        entries,
    };
}
for (const [label, entries] of Object.entries({
    portableRoot: ["index"],
    browser: ["browser"],
    completeServer: ["index", "web", "ssr", "node"],
})) {
    const samples = [];
    for (let i = 0; i < 5; i++) {
        const urls = entries.map(
            (entry) => pathToFileURL(root + "packages/front/dist/" + entry + ".mjs").href,
        );
        const source = `const t=performance.now();for(const url of ${JSON.stringify(urls)})await import(url);console.log(performance.now()-t)`;
        samples.push(
            Number(
                execFileSync(process.execPath, ["--input-type=module", "-e", source], {
                    encoding: "utf8",
                }),
            ),
        );
    }
    result.imports[label] = {
        entries,
        samplesMs: samples,
        medianMs: [...samples].sort((a, b) => a - b)[2],
    };
}
const { createSSRHandler } = await import(pathToFileURL(root + "packages/front/dist/ssr.mjs"));
const module = await import(pathToFileURL(root + "templates/react-minimal/dist/server/ssr.js"));
const host = createSSRHandler({
    ownRenderers: true,
    ...module,
    template: await fs.readFile(root + "templates/react-minimal/dist/client/index.html", "utf8"),
});
const samples = [];
try {
    for (let i = 0; i < 120; i++) {
        const t = performance.now();
        const response = await host.fetch(new Request("http://baseline.local/"));
        const html = await response.text();
        if (response.status !== 200 || !html.includes("Feed"))
            throw Error("Request measurement contract failed");
        if (i >= 20) samples.push(performance.now() - t);
    }
} finally {
    await host.dispose();
}
const sorted = [...samples].sort((a, b) => a - b);
result.request = {
    baselineMedianMs: baseline.ssrRequest.medianMs,
    baselineP95Ms: baseline.ssrRequest.p95Ms,
    medianMs: sorted[50],
    p95Ms: sorted[94],
    samplesMs: samples,
    note: "Baseline Hono createSSRApp dispatch versus new standard createSSRHandler. Same home, consumed HTML, warmup and samples; response adapter changed.",
};
await fs.writeFile(output + "/result.json", JSON.stringify(result, null, 2));
console.log(
    JSON.stringify(
        {
            templates: Object.fromEntries(
                Object.entries(result.templates).map(([n, t]) => [
                    n,
                    { js: t.js, gzip: t.gzip, before: t.sourceBefore, after: t.sourceAfter },
                ]),
            ),
            imports: result.imports,
            request: { medianMs: result.request.medianMs, p95Ms: result.request.p95Ms },
        },
        null,
        2,
    ),
);
