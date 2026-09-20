/** Local production browser timings; DOM commit is measured without Playwright polling latency. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite-plus";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline =
    process.env.FINESOFT_NATIVE_BASELINE_ROOT ??
    path.resolve(root, "../native-composition-baseline");
const output =
    process.env.FINESOFT_NATIVE_BROWSER_OUTPUT ??
    path.join(root, "reports/native-composition-implementation/browser-measurements.json");
const runs = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
function summary(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return {
        samples: sorted.length,
        medianMs: sorted[Math.ceil(sorted.length * 0.5) - 1],
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        minMs: sorted[0],
        maxMs: sorted.at(-1),
    };
}
try {
    for (const name of ["react-minimal", "vue-minimal", "svelte-minimal"]) {
        const servers = [];
        try {
            for (const version of ["baseline", "current"]) {
                servers.push(
                    await preview({
                        root: path.join(
                            version === "baseline" ? baseline : root,
                            "templates",
                            name,
                        ),
                        preview: {
                            port: version === "baseline" ? 5271 : 5272,
                            strictPort: true,
                            host: "127.0.0.1",
                        },
                    }),
                );
            }
            for (let round = 0; round < 3; round++) {
                const order = round % 2 ? ["current", "baseline"] : ["baseline", "current"];
                for (const version of order) {
                    for (let sample = 0; sample < 5; sample++) {
                        const context = await browser.newContext();
                        const page = await context.newPage();
                        const errors = [];
                        page.on("pageerror", (error) => errors.push(String(error)));
                        await page.addInitScript(() => {
                            window.__firstInteraction = new Promise((resolve, reject) => {
                                const deadline = performance.now() + 10000;
                                function attempt() {
                                    const note = document.querySelector('textarea[name="notes"]');
                                    if (note?.getClientRects().length) {
                                        resolve(performance.now());
                                        return;
                                    }
                                    if (performance.now() > deadline) {
                                        reject(new Error("First native interaction timed out"));
                                        return;
                                    }
                                    [...document.querySelectorAll("button")]
                                        .find((button) => button.textContent.trim() === "Notes")
                                        ?.click();
                                    requestAnimationFrame(attempt);
                                }
                                requestAnimationFrame(attempt);
                            });
                        });
                        try {
                            await page.goto(
                                `http://127.0.0.1:${version === "baseline" ? 5271 : 5272}/`,
                                { waitUntil: "load" },
                            );
                            const firstInteractionMs = await page.evaluate(
                                () => window.__firstInteraction,
                            );
                            const navigationMs = await page.evaluate(async () => {
                                const values = [];
                                for (let index = 0; index < 10; index++) {
                                    const label = index % 2 ? "Notes" : "Feed";
                                    const selector =
                                        index % 2 ? 'textarea[name="notes"]' : ".page h1";
                                    const elapsed = await new Promise((resolve, reject) => {
                                        const started = performance.now();
                                        const timeout = setTimeout(() => {
                                            observer.disconnect();
                                            reject(new Error(`Navigation to ${label} timed out`));
                                        }, 5000);
                                        const observer = new MutationObserver(() => {
                                            const matched = [
                                                ...document.querySelectorAll(selector),
                                            ].some(
                                                (element) =>
                                                    element.getClientRects().length &&
                                                    (label === "Notes" ||
                                                        element.textContent.trim() === "Feed"),
                                            );
                                            if (!matched) return;
                                            clearTimeout(timeout);
                                            observer.disconnect();
                                            resolve(performance.now() - started);
                                        });
                                        observer.observe(document.getElementById("app"), {
                                            subtree: true,
                                            childList: true,
                                            attributes: true,
                                            characterData: true,
                                        });
                                        [...document.querySelectorAll("button")]
                                            .find((button) => button.textContent.trim() === label)
                                            .click();
                                    });
                                    values.push(elapsed);
                                    await new Promise(requestAnimationFrame);
                                }
                                return values;
                            });
                            const resources = await page.evaluate(() =>
                                performance
                                    .getEntriesByType("resource")
                                    .filter((entry) =>
                                        ["script", "link"].includes(entry.initiatorType),
                                    )
                                    .map((entry) => ({
                                        name: new URL(entry.name).pathname,
                                        bytes: entry.encodedBodySize,
                                    })),
                            );
                            assert.deepEqual(errors, []);
                            runs.push({
                                name,
                                version,
                                round: round + 1,
                                sample: sample + 1,
                                firstInteractionMs,
                                navigationMs,
                                resources,
                            });
                        } finally {
                            await context.close();
                        }
                    }
                }
            }
        } finally {
            for (const server of servers) {
                await new Promise((resolve, reject) =>
                    server.httpServer.close((error) => (error ? reject(error) : resolve())),
                );
            }
        }
    }
} finally {
    await browser.close();
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(
        output,
        JSON.stringify(
            {
                node: process.version,
                browser: browser.version(),
                production: process.env.NODE_ENV,
                baseline,
                current: root,
                method: "Three alternating baseline/current rounds per minimal UI template, five fresh browser contexts per round. Initial interaction is navigationStart to a Notes button click producing a visible Notes page (retried once per animation frame until hydration). Navigation is click to observed visible destination DOM, measured inside the page using MutationObserver, ten alternating tab switches per sample.",
                limitations: [
                    "Local production preview, deterministic template data, no network throttling; timings do not predict a customer connection or device.",
                    "Initial interaction has one-animation-frame resolution and includes the deliberate tab switch; it is a functional readiness proxy, not a standardized TTI metric.",
                    "Navigation records DOM commit rather than paint or the internal app.commit callback; repeated switches exercise retained pages.",
                    "Resources are browser encoded-body observations, usually uncompressed on local preview; gzip artifact comparisons are reported separately.",
                ],
                summary: ["react-minimal", "vue-minimal", "svelte-minimal"].flatMap((name) =>
                    ["baseline", "current"].map((version) => {
                        const selected = runs.filter(
                            (run) => run.name === name && run.version === version,
                        );
                        return {
                            name,
                            version,
                            firstInteraction: summary(
                                selected.map((run) => run.firstInteractionMs),
                            ),
                            navigation: summary(selected.flatMap((run) => run.navigationMs)),
                        };
                    }),
                ),
                runs,
            },
            null,
            2,
        ),
    );
}
console.log(`Production browser measurements saved to ${output}`);
