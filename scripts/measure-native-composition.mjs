/**
 * Production native-composition measurements.
 *
 * The report deliberately keeps source-size, client-graph, import and SSR
 * measurements separate. A smaller source inventory does not establish a
 * faster runtime, a smaller transfer, or lower memory use.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { gzipSync } from "node:zlib";

const scriptPath = fileURLToPath(import.meta.url);
const repository = path.resolve(path.dirname(scriptPath), "..");
const baselineRoot =
    process.env.FINESOFT_NATIVE_BASELINE_ROOT ??
    path.resolve(repository, "..", "native-composition-baseline");
const currentRoot = process.env.FINESOFT_NATIVE_CURRENT_ROOT ?? repository;
const outputPath =
    process.env.FINESOFT_NATIVE_OUTPUT ??
    path.join(repository, "reports/native-composition-implementation/measurements.json");
const templateNames = ["react", "react-minimal", "vue", "vue-minimal", "svelte", "svelte-minimal"];
const runtimePackages = ["core", "web", "browser", "ssr", "server", "front"];
const sourceExtensions = /\.(?:ts|tsx|js|jsx|mjs|cjs|vue|svelte|css)$/;
const expectedBaselineCommit =
    process.env.FINESOFT_NATIVE_BASELINE_COMMIT ?? "10fde72e70e8e932a2ae8c191828aea4c60e2632";
const baselineWorkingTree = process.env.FINESOFT_NATIVE_BASELINE_WORKTREE === "1";
let originalSource;
process.env.NODE_ENV = "production";

const limitations = [
    "Source lines, files, and lexical-token counts describe implementation size; they do not prove speed, transfer, or memory improvement.",
    "Client JavaScript totals include every built client .js asset; the initial static graph follows only statically imported relative modules from the HTML module entry. Dynamic chunks are recorded in total assets but excluded from the initial graph.",
    "Gzip totals compress each file independently and add the results; they are comparable artifact-size indicators, not a network transfer simulation with shared dictionaries or server headers.",
    "SSR timings are local Request to Response.text measurements through createSSRHost in fresh child processes. They exclude network, TLS, reverse-proxy, filesystem, and real production host latency.",
    "The three alternating before/after rounds use fresh Node processes, but operating-system file caches, scheduler noise, and garbage collection can still vary.",
    "Heap and RSS values are process-level samples, not allocation profiles or leak proofs; sampled values must be interpreted with the request timings and run metadata.",
    `The e22de64 comparison is source-only. Runtime and artifact comparisons use the selected baseline checkout at ${expectedBaselineCommit}${baselineWorkingTree ? " plus its snapshotted working-tree changes" : ""} and the current checkout.`,
];

function git(root, ...args) {
    return execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        maxBuffer: 100 * 1024 * 1024,
    }).trim();
}

function baselineHead() {
    const head = git(baselineRoot, "rev-parse", "HEAD");
    if (head !== expectedBaselineCommit)
        throw new Error(`Expected baseline ${expectedBaselineCommit}, found ${head}`);
    return head;
}

function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}

async function exists(file) {
    try {
        await fs.access(file);
        return true;
    } catch {
        return false;
    }
}

async function walk(dir) {
    if (!(await exists(dir))) return [];
    const result = [];
    for (const item of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
    )) {
        const file = path.join(dir, item.name);
        if (item.isDirectory()) result.push(...(await walk(file)));
        else result.push(file);
    }
    return result;
}

function isSourcePath(file) {
    const normalized = file.replaceAll(path.sep, "/");
    if (!sourceExtensions.test(normalized) || normalized.endsWith(".d.ts")) return false;
    return !/(?:^|\/)(?:test|tests|__tests__|dist|build|coverage|node_modules|reports)(?:\/|$)/.test(
        normalized,
    );
}

/** Count non-comment lexical units for TS/JS/CSS and native component source. */
function lexicalTokenCount(source) {
    let count = 0;
    let index = 0;
    const length = source.length;
    const isIdentifierStart = (char) => /[A-Za-z_$]/.test(char);
    const isIdentifierPart = (char) => /[A-Za-z0-9_$-]/.test(char);
    while (index < length) {
        const char = source[index];
        const next = source[index + 1];
        if (/\s/.test(char)) {
            index++;
            continue;
        }
        if (char === "/" && next === "/") {
            index += 2;
            while (index < length && source[index] !== "\n") index++;
            continue;
        }
        if (char === "/" && next === "*") {
            index += 2;
            while (index + 1 < length && !(source[index] === "*" && source[index + 1] === "/"))
                index++;
            index += 2;
            continue;
        }
        if (char === "<" && source.slice(index, index + 4) === "<!--") {
            const end = source.indexOf("-->", index + 4);
            index = end < 0 ? length : end + 3;
            continue;
        }
        if (char === "'" || char === '"' || char === "`") {
            const quote = char;
            count++;
            index++;
            while (index < length) {
                if (source[index] === "\\") index += 2;
                else if (source[index] === quote) {
                    index++;
                    break;
                } else index++;
            }
            continue;
        }
        if (isIdentifierStart(char)) {
            count++;
            index++;
            while (index < length && isIdentifierPart(source[index])) index++;
            continue;
        }
        if (/[0-9]/.test(char)) {
            count++;
            index++;
            while (index < length && /[A-Za-z0-9_.]/.test(source[index])) index++;
            continue;
        }
        count++;
        index++;
    }
    return count;
}

function lineCount(source) {
    return source.length === 0 ? 0 : source.trimEnd().split(/\r?\n/).length;
}

function aggregate(entries) {
    return {
        files: entries.length,
        bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
        lines: entries.reduce((sum, entry) => sum + entry.lines, 0),
        nonCommentTokens: entries.reduce((sum, entry) => sum + entry.nonCommentTokens, 0),
    };
}

async function filesystemSourceInventory(root) {
    const entries = [];
    const add = async (area, fileRoot) => {
        for (const file of (await walk(fileRoot)).filter(isSourcePath)) {
            const source = await fs.readFile(file, "utf8");
            entries.push({
                area,
                path: path.relative(root, file),
                bytes: Buffer.byteLength(source),
                lines: lineCount(source),
                nonCommentTokens: lexicalTokenCount(source),
                sha256: sha256(source),
            });
        }
    };
    for (const name of runtimePackages)
        await add("runtime", path.join(root, "packages", name, "src"));
    for (const name of templateNames)
        await add(`template:${name}`, path.join(root, "templates", name, "src"));
    return makeSourceInventory(entries);
}

function gitSourcePaths(root, revision) {
    const prefixes = [
        ...runtimePackages.map((name) => `packages/${name}/src`),
        ...templateNames.map((name) => `templates/${name}/src`),
    ];
    const output = execFileSync(
        "git",
        ["-C", root, "ls-tree", "-r", "-z", "--name-only", revision, "--", ...prefixes],
        { encoding: "utf8" },
    );
    return output.split("\0").filter(isSourcePath);
}

async function gitSourceInventory(root, revision) {
    const entries = [];
    for (const file of gitSourcePaths(root, revision)) {
        const source = execFileSync("git", ["-C", root, "show", `${revision}:${file}`], {
            encoding: "utf8",
        });
        entries.push({
            area: file.startsWith("packages/") ? "runtime" : `template:${file.split("/")[1]}`,
            path: file,
            bytes: Buffer.byteLength(source),
            lines: lineCount(source),
            nonCommentTokens: lexicalTokenCount(source),
            sha256: sha256(source),
        });
    }
    return makeSourceInventory(entries);
}

function makeSourceInventory(entries) {
    const byArea = {};
    for (const entry of entries) (byArea[entry.area] ??= []).push(entry);
    const areas = Object.fromEntries(
        Object.entries(byArea).map(([area, values]) => [area, aggregate(values)]),
    );
    const runtimeEntries = entries.filter((entry) => entry.area === "runtime");
    const templateEntries = entries.filter((entry) => entry.area.startsWith("template:"));
    return {
        totals: {
            runtime: aggregate(runtimeEntries),
            templates: aggregate(templateEntries),
            all: aggregate(entries),
        },
        areas,
        entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
    };
}

function delta(after = {}, before = {}) {
    return Object.fromEntries(
        ["files", "bytes", "lines", "nonCommentTokens"].map((key) => [
            key,
            (after[key] ?? 0) - (before[key] ?? 0),
        ]),
    );
}

function compareSource(before, after) {
    const comparison = {
        runtime: {
            baselineToCurrent: delta(after.totals.runtime, before.totals.runtime),
            originalToCurrent: delta(after.totals.runtime, originalSource.totals.runtime),
        },
        templates: {
            baselineToCurrent: delta(after.totals.templates, before.totals.templates),
            originalToCurrent: delta(after.totals.templates, originalSource.totals.templates),
        },
        all: {
            baselineToCurrent: delta(after.totals.all, before.totals.all),
            originalToCurrent: delta(after.totals.all, originalSource.totals.all),
        },
        templatesByName: Object.fromEntries(
            templateNames.map((name) => {
                const area = `template:${name}`;
                return [
                    name,
                    {
                        baselineToCurrent: delta(after.areas[area], before.areas[area]),
                        originalToCurrent: delta(after.areas[area], originalSource.areas[area]),
                    },
                ];
            }),
        ),
    };
    return comparison;
}

async function clientAssets(root, template) {
    const base = path.join(root, "templates", template);
    const client = path.join(base, "dist/client");
    const files = (await walk(client)).filter((file) => file.endsWith(".js"));
    const assets = [];
    for (const file of files) {
        const data = await fs.readFile(file);
        assets.push({
            path: path.relative(base, file),
            bytes: data.length,
            gzipBytes: gzipSync(data).length,
        });
    }
    assets.sort((a, b) => a.path.localeCompare(b.path));
    const indexHtmlPath = path.join(client, "index.html");
    if (!(await exists(indexHtmlPath))) throw new Error(`Missing client build: ${indexHtmlPath}`);
    const html = await fs.readFile(indexHtmlPath, "utf8");
    const match =
        html.match(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/i) ??
        html.match(/<script\b[^>]*src=["']([^"']+)["'][^>]*type=["']module["']/i);
    if (!match) throw new Error(`Missing module script in ${indexHtmlPath}`);
    const entry = resolveClientImport(client, indexHtmlPath, match[1]);
    const visited = new Set();
    const missing = [];
    async function visit(file) {
        if (visited.has(file)) return;
        visited.add(file);
        if (!(await exists(file))) {
            missing.push(path.relative(base, file));
            return;
        }
        const source = await fs.readFile(file, "utf8");
        if (!/\.(?:js|mjs|css)$/.test(file)) return;
        const imports = [];
        const pattern = /\b(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?(["'])(\.{1,2}\/[^"']+)\1/g;
        for (const item of source.matchAll(pattern)) imports.push(item[2]);
        for (const specifier of imports) await visit(resolveClientImport(client, file, specifier));
    }
    await visit(entry);
    const graphFiles = [];
    for (const file of visited) {
        if (!(await exists(file))) continue;
        const data = await fs.readFile(file);
        graphFiles.push({
            path: path.relative(base, file),
            bytes: data.length,
            gzipBytes: gzipSync(data).length,
        });
    }
    graphFiles.sort((a, b) => a.path.localeCompare(b.path));
    return {
        clientJs: {
            files: assets,
            count: assets.length,
            bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
            gzipBytes: assets.reduce((sum, asset) => sum + asset.gzipBytes, 0),
        },
        initialStaticGraph: {
            entry: path.relative(base, entry),
            files: graphFiles,
            count: graphFiles.length,
            bytes: graphFiles.reduce((sum, file) => sum + file.bytes, 0),
            gzipBytes: graphFiles.reduce((sum, file) => sum + file.gzipBytes, 0),
            jsCount: graphFiles.filter(
                (file) => file.path.endsWith(".js") || file.path.endsWith(".mjs"),
            ).length,
            cssCount: graphFiles.filter((file) => file.path.endsWith(".css")).length,
            missing,
        },
        indexHtml: { bytes: Buffer.byteLength(html), path: path.relative(base, indexHtmlPath) },
    };
}

function resolveClientImport(clientRoot, importer, specifier) {
    const withoutQuery = specifier.split(/[?#]/, 1)[0];
    const candidate = withoutQuery.startsWith("/")
        ? path.join(clientRoot, withoutQuery.slice(1))
        : path.resolve(path.dirname(importer), withoutQuery);
    const candidates = [
        candidate,
        `${candidate}.js`,
        `${candidate}.mjs`,
        `${candidate}.css`,
        path.join(candidate, "index.js"),
    ];
    return (
        candidates.find((file) => {
            try {
                return existsSync(file);
            } catch {
                return false;
            }
        }) ?? candidate
    );
}

async function artifactHashes(root, template) {
    const files = [
        path.join(root, "packages/front/dist/ssr.mjs"),
        path.join(root, "packages/front/dist/web.mjs"),
        path.join(root, "templates", template, "dist/server/ssr.js"),
    ];
    const result = {};
    for (const file of files) {
        if (await exists(file)) result[path.relative(root, file)] = sha256(await fs.readFile(file));
    }
    return result;
}

function parseChildOutput(output) {
    const lines = output.trim().split(/\r?\n/).filter(Boolean);
    return JSON.parse(lines.at(-1));
}

function runChild(args, cwd) {
    const output = execFileSync(process.execPath, [scriptPath, ...args], {
        cwd,
        env: { ...process.env, NODE_ENV: "production" },
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
    });
    return parseChildOutput(output);
}

function percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
    return sorted[index];
}

function summarize(values) {
    return {
        count: values.length,
        minMs: values.length ? Math.min(...values) : null,
        medianMs: percentile(values, 0.5),
        p95Ms: percentile(values, 0.95),
        maxMs: values.length ? Math.max(...values) : null,
    };
}

function importTimings(root) {
    const groups = {
        portableRoot: ["packages/front/dist/index.mjs"],
        browser: ["packages/front/dist/browser.mjs"],
        completeServer: [
            "packages/front/dist/index.mjs",
            "packages/front/dist/web.mjs",
            "packages/front/dist/ssr.mjs",
            "packages/front/dist/node.mjs",
        ],
    };
    return Object.fromEntries(
        Object.entries(groups).map(([label, entries]) => {
            const samplesMs = [];
            for (let sample = 0; sample < 5; sample++) {
                const result = runChild(
                    [
                        "--import-child",
                        JSON.stringify(entries.map((entry) => path.join(root, entry))),
                    ],
                    root,
                );
                samplesMs.push(result.elapsedMs);
            }
            return [label, { entries, samplesMs, summary: summarize(samplesMs) }];
        }),
    );
}

function ssrRun(root) {
    return runChild(["--ssr-child", root], root);
}

async function measureSsrAlternating() {
    const runs = [];
    for (let round = 0; round < 3; round++) {
        const order = round % 2 === 0 ? ["baseline", "current"] : ["current", "baseline"];
        for (const version of order) {
            const root = version === "baseline" ? baselineRoot : currentRoot;
            runs.push({ round: round + 1, order: order.join(">"), version, ...ssrRun(root) });
        }
    }
    const byVersion = {};
    for (const version of ["baseline", "current"]) {
        const selected = runs.filter((run) => run.version === version);
        const requestTimes = selected.flatMap((run) => run.samplesMs);
        const heap = selected.flatMap((run) => run.memorySamples.map((sample) => sample.heapUsed));
        const rss = selected.flatMap((run) => run.memorySamples.map((sample) => sample.rss));
        const serializationTimes = selected.flatMap((run) => run.serialization.samplesMs);
        const serializationBytes = selected.flatMap((run) => run.serialization.payloadBytes);
        byVersion[version] = {
            runs: selected.map((run) => ({
                round: run.round,
                order: run.order,
                importMs: run.importMs,
                request: run.request,
                serialization: run.serialization,
                memoryBefore: run.memoryBefore,
                memoryAfter: run.memoryAfter,
            })),
            request: summarize(requestTimes),
            serialization: {
                time: summarize(serializationTimes),
                bytes: {
                    count: serializationBytes.length,
                    total: serializationBytes.reduce((sum, value) => sum + value, 0),
                    min: serializationBytes.length ? Math.min(...serializationBytes) : null,
                    median: percentile(serializationBytes, 0.5),
                    p95: percentile(serializationBytes, 0.95),
                    max: serializationBytes.length ? Math.max(...serializationBytes) : null,
                },
            },
            sampledHeapUsedBytes: {
                count: heap.length,
                median: percentile(heap, 0.5),
                p95: percentile(heap, 0.95),
                max: heap.length ? Math.max(...heap) : null,
            },
            sampledRssBytes: {
                count: rss.length,
                median: percentile(rss, 0.5),
                p95: percentile(rss, 0.95),
                max: rss.length ? Math.max(...rss) : null,
            },
        };
    }
    return { warmup: 20, samplesPerRun: 100, alternatingRuns: runs, byVersion };
}

async function runSsrChild(root) {
    const importStarted = performance.now();
    const [{ createSSRHost }, module] = await Promise.all([
        import(pathToFileURL(path.join(root, "packages/front/dist/ssr.mjs")).href),
        import(pathToFileURL(path.join(root, "templates/react-minimal/dist/server/ssr.js")).href),
    ]);
    const importMs = performance.now() - importStarted;
    const template = await fs.readFile(
        path.join(root, "templates/react-minimal/dist/client/index.html"),
        "utf8",
    );
    if (typeof module.serializeServerData !== "function")
        throw new Error("SSR module does not export serializeServerData");
    let activeRequest = -1;
    const serializationSamples = [];
    const host = createSSRHost({
        ...module,
        template,
        serializeServerData(data) {
            const started = performance.now();
            const serialized = module.serializeServerData(data);
            serializationSamples.push({
                request: activeRequest,
                elapsedMs: performance.now() - started,
                bytes: Buffer.byteLength(serialized),
            });
            return serialized;
        },
    });
    const warmup = 20;
    const sampleCount = 100;
    const samplesMs = [];
    const memorySamples = [];
    const memoryBefore = process.memoryUsage();
    let responseBytes = 0;
    try {
        for (let index = 0; index < warmup + sampleCount; index++) {
            activeRequest = index;
            const started = performance.now();
            const response = await host.handle(new Request("http://native-composition.measure/"));
            const html = await response.text();
            const elapsedMs = performance.now() - started;
            if (response.status !== 200 || !html)
                throw new Error(`SSR request contract failed: ${response.status}`);
            responseBytes += Buffer.byteLength(html);
            if (index >= warmup) {
                samplesMs.push(elapsedMs);
                if ((index - warmup) % 10 === 0) {
                    const memory = process.memoryUsage();
                    memorySamples.push({
                        index: index - warmup + 1,
                        heapUsed: memory.heapUsed,
                        rss: memory.rss,
                    });
                }
            }
        }
    } finally {
        await host.dispose();
    }
    const memoryAfter = process.memoryUsage();
    const measuredSerialization = serializationSamples.filter((sample) => sample.request >= warmup);
    const serializationTimes = measuredSerialization.map((sample) => sample.elapsedMs);
    const serializationBytes = measuredSerialization.map((sample) => sample.bytes);
    return {
        importMs,
        samplesMs,
        request: {
            ...summarize(samplesMs),
            responseBytesTotal: responseBytes,
            responseBytesPerRequest: responseBytes / (warmup + sampleCount),
        },
        serialization: {
            samplesMs: serializationTimes,
            payloadBytes: serializationBytes,
            time: summarize(serializationTimes),
            bytes: {
                count: serializationBytes.length,
                total: serializationBytes.reduce((sum, value) => sum + value, 0),
                min: serializationBytes.length ? Math.min(...serializationBytes) : null,
                median: percentile(serializationBytes, 0.5),
                p95: percentile(serializationBytes, 0.95),
                max: serializationBytes.length ? Math.max(...serializationBytes) : null,
            },
        },
        memoryBefore: { heapUsed: memoryBefore.heapUsed, rss: memoryBefore.rss },
        memoryAfter: { heapUsed: memoryAfter.heapUsed, rss: memoryAfter.rss },
        memorySamples,
    };
}

async function runImportChild(entries) {
    const started = performance.now();
    for (const file of entries) await import(pathToFileURL(file).href);
    console.log(JSON.stringify({ elapsedMs: performance.now() - started }));
}

async function ensureBuildInputs(root, template) {
    const required = [
        path.join(root, "packages/front/dist/ssr.mjs"),
        path.join(root, "packages/front/dist/web.mjs"),
        path.join(root, "templates", template, "dist/client/index.html"),
        path.join(root, "templates", template, "dist/server/ssr.js"),
    ];
    const missing = [];
    for (const file of required) if (!(await exists(file))) missing.push(path.relative(root, file));
    if (missing.length)
        throw new Error(`Missing production build inputs in ${root}: ${missing.join(", ")}`);
}

const childMode = process.argv[2];
if (childMode === "--ssr-child") {
    console.log(JSON.stringify(await runSsrChild(process.argv[3])));
} else if (childMode === "--import-child") {
    await runImportChild(JSON.parse(process.argv[3]));
} else {
    await ensureBuildInputs(baselineRoot, "react-minimal");
    const baselineCommit = baselineHead();
    if (process.argv.includes("--source-only")) {
        const baseline = baselineWorkingTree
            ? await filesystemSourceInventory(baselineRoot)
            : await gitSourceInventory(baselineRoot, baselineCommit);
        const current = await filesystemSourceInventory(currentRoot);
        originalSource = await gitSourceInventory(currentRoot, "e22de64");
        const partial = {
            mode: "source-only",
            timestamp: new Date().toISOString(),
            node: process.version,
            source: {
                baseline,
                current,
                original: originalSource,
                comparison: compareSource(baseline, current),
            },
            limitations,
        };
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify(partial, null, 2) + "\n");
        console.log(
            JSON.stringify(
                { mode: partial.mode, output: outputPath, source: partial.source.comparison },
                null,
                2,
            ),
        );
    } else {
        for (const root of [baselineRoot, currentRoot])
            await ensureBuildInputs(root, "react-minimal");
        const baselineSource = baselineWorkingTree
            ? await filesystemSourceInventory(baselineRoot)
            : await gitSourceInventory(baselineRoot, baselineCommit);
        const currentSource = await filesystemSourceInventory(currentRoot);
        originalSource = await gitSourceInventory(currentRoot, "e22de64");
        const templates = {};
        for (const name of templateNames) {
            await ensureBuildInputs(baselineRoot, name);
            await ensureBuildInputs(currentRoot, name);
            templates[name] = {
                baseline: await clientAssets(baselineRoot, name),
                current: await clientAssets(currentRoot, name),
                artifacts: {
                    baseline: await artifactHashes(baselineRoot, name),
                    current: await artifactHashes(currentRoot, name),
                },
            };
        }
        const report = {
            schema: "native-composition-measurements/v1",
            timestamp: new Date().toISOString(),
            environment: {
                node: process.version,
                execPath: process.execPath,
                NODE_ENV: "production",
                baselineRoot,
                currentRoot,
                baselineCommit,
                baselineWorkingTree,
                currentCommit: git(currentRoot, "rev-parse", "HEAD"),
                baselineLockSha256: (await exists(path.join(baselineRoot, "pnpm-lock.yaml")))
                    ? sha256(await fs.readFile(path.join(baselineRoot, "pnpm-lock.yaml")))
                    : null,
                currentLockSha256: (await exists(path.join(currentRoot, "pnpm-lock.yaml")))
                    ? sha256(await fs.readFile(path.join(currentRoot, "pnpm-lock.yaml")))
                    : null,
                baselineDiffSha256: sha256(git(baselineRoot, "diff", "HEAD")),
                currentDiffSha256: sha256(git(currentRoot, "diff", "HEAD")),
            },
            method: "Same six template paths, fixed Node/dependency roots, NODE_ENV=production. Client JS sums every .js asset and gzips each independently; initial graph follows static relative imports from the built module entry. Source inventories count physical lines/files and generic non-comment lexical units across runtime src and template src, including CSS/Svelte/Vue and current newly added source files, excluding .d.ts/tests/output.",
            source: {
                baseline: baselineSource,
                current: currentSource,
                original: originalSource,
                comparison: compareSource(baselineSource, currentSource),
            },
            templates,
            imports: { baseline: importTimings(baselineRoot), current: importTimings(currentRoot) },
            ssr: await measureSsrAlternating(),
            limitations,
            interpretation:
                "Do not claim runtime speed, package-size, or memory improvement from source-code reduction alone. Use the artifact, request, and memory measurements with their stated limitations.",
        };
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
        console.log(
            JSON.stringify(
                {
                    output: outputPath,
                    source: report.source.comparison,
                    ssr: report.ssr.byVersion,
                    templates: Object.fromEntries(
                        Object.entries(templates).map(([name, value]) => [
                            name,
                            {
                                baselineGzip: value.baseline.clientJs.gzipBytes,
                                currentGzip: value.current.clientJs.gzipBytes,
                                baselineInitial: value.baseline.initialStaticGraph,
                                currentInitial: value.current.initialStaticGraph,
                            },
                        ]),
                    ),
                },
                null,
                2,
            ),
        );
    }
}
