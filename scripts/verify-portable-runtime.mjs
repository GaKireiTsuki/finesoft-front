import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createFixture, inspect } from "../adversarial/runtime-app/dist/node/business.mjs";
import { startFixture } from "../adversarial/runtime-app/dist/node/node.mjs";
import { fixtureConfig } from "../adversarial/runtime-app/config.ts";

const headers = { "x-fixture-authorized": "yes" };
async function contract(fetcher, tenant) {
    const data = await fetcher("/data", {
        method: "POST",
        headers,
        body: JSON.stringify({ n: 3 }),
    });
    assert.equal(data.status, 201);
    assert.deepEqual(data.headers.getSetCookie(), ["first=1", "second=2"]);
    assert.deepEqual(await data.json(), { value: 6, tenant });
    const denied = await fetcher("/data", { method: "POST", body: '{"n":3}' });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: { code: "denied", message: "Access denied" } });
    const invalid = await fetcher("/data", { method: "POST", body: '{"n":"invalid"}' });
    assert.equal(invalid.status, 400);
    await invalid.text();
    const method = await fetcher("/data");
    assert.equal(method.status, 405);
    await method.text();
    const missing = await fetcher("/fixture.protected");
    assert.equal(missing.status, 404);
    await missing.text();
    const redirect = await fetcher("/redirect", { headers, redirect: "manual" });
    assert.equal(redirect.status, 307);
    assert.equal(redirect.headers.get("location"), "/data");
    const fault = await fetcher("/failure");
    assert.equal(fault.status, 500);
    assert.deepEqual(await fault.json(), {
        error: { code: "failure", message: "Execution failed" },
    });
    const stream = await fetcher("/stream");
    assert.deepEqual(stream.headers.getSetCookie(), ["first=1", "second=2"]);
    assert.equal(await stream.text(), `${tenant}:live`);
}
const { runtime } = createFixture();
try {
    assert.deepEqual(
        await runtime.execute(inspect, 3, {
            identity: "fixture-authorized",
            bindings: fixtureConfig.bindings,
        }),
        { value: 6, tenant: fixtureConfig.bindings.TENANT, internal: "internal-secret" },
    );
    await assert.rejects(runtime.execute(inspect, 3, { bindings: fixtureConfig.bindings }), {
        code: "denied",
    });
} finally {
    await runtime.dispose();
}
console.log("direct: shared operation, scoped binding and protected nested call passed");
const node = await startFixture();
try {
    const address = node.server.address();
    assert.ok(address && typeof address === "object");
    await contract(
        (path, init) => fetch(`http://127.0.0.1:${address.port}${path}`, init),
        fixtureConfig.bindings.TENANT,
    );
} finally {
    await node.dispose();
}
console.log(
    "Node HTTP: projection/status/cookies/denial/validation/redirect/fault/stream passed; listener/runtime disposed",
);
const worker = new Miniflare(
    convertV4MiniflareOptions({
        modules: true,
        scriptPath: fileURLToPath(
            new URL("../adversarial/runtime-app/dist/worker/worker.mjs", import.meta.url),
        ),
        compatibilityDate: fixtureConfig.compatibilityDate,
        cf: false,
        bindings: fixtureConfig.bindings,
    }),
);
try {
    await contract(
        (path, init) => worker.dispatchFetch(`https://fixture.test${path}`, init),
        fixtureConfig.bindings.TENANT,
    );
    await worker.setOptions(
        convertV4MiniflareOptions({
            modules: true,
            scriptPath: fileURLToPath(
                new URL("../adversarial/runtime-app/dist/worker/worker.mjs", import.meta.url),
            ),
            compatibilityDate: fixtureConfig.compatibilityDate,
            cf: false,
            bindings: { ...fixtureConfig.bindings, TENANT: "tenant-b" },
        }),
    );
    await contract(
        (path, init) => worker.dispatchFetch(`https://fixture.test${path}`, init),
        "tenant-b",
    );
} finally {
    await worker.dispose();
}
console.log(
    "workerd HTTP (no nodejs_compat): same built business fixture and response contract passed with two binding values; disposed",
);

const visited = new Set();
function checkGraph(file) {
    if (visited.has(file.href)) return;
    visited.add(file.href);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
        /^(?:import|export)\s+(?:[^'";]*\s+from\s+)?["']([^"']+)["']/gm,
    )) {
        const specifier = match[1];
        assert.ok(
            specifier.startsWith("."),
            `portable entry imports external module: ${specifier}`,
        );
        checkGraph(new URL(specifier, file));
    }
    assert.ok(
        !source.includes("../web/src/") && !source.includes("../browser/src/"),
        `Web runtime in ${file.pathname}`,
    );
    assert.doesNotMatch(
        source,
        /\b(?:window|document|HTMLElement|History)\b/,
        `UI global in ${file.pathname}`,
    );
}
for (const entry of ["index", "http", "worker"])
    checkGraph(new URL(`../packages/front/dist/${entry}.mjs`, import.meta.url));
const workerSource = readFileSync(
    new URL("../adversarial/runtime-app/dist/worker/worker.mjs", import.meta.url),
    "utf8",
);
assert.doesNotMatch(workerSource, /(?:from|import)\s*["'](?:node:|hono|vite|react|vue|svelte)/);
console.log(
    `portable built entry graph: ${visited.size} modules, no external Node/Hono/Vite/UI imports or UI globals`,
);
