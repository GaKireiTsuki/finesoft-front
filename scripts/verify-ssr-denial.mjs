/** Built-public native entries regression: denied candidates never enter presentation. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineWebApp, leaf, split, stack } from "../packages/front/dist/web.mjs";
import { createReactSSRRender } from "../packages/front/dist/renderers/react/server.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// Use the selected UI peer installed for the public renderer package.
const { createElement } = createRequire(new URL("../packages/front/package.json", import.meta.url))(
    "react",
);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const report = {
    source: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    diffSha256: createHash("sha256").update(git("diff", "HEAD")).digest("hex"),
    timestamp: new Date().toISOString(),
    node: process.version,
    artifacts: Object.fromEntries(
        ["web.mjs", "renderers/react/server.mjs"].map((entry) => [
            entry,
            createHash("sha256")
                .update(readFileSync(new URL(`../packages/front/dist/${entry}`, import.meta.url)))
                .digest("hex"),
        ]),
    ),
    cases: [],
};
for (const phase of ["beforeNavigate", "beforeCommit"]) {
    for (const shape of ["route", "split", "empty"]) {
        let loads = 0;
        const contexts = [];
        const app = defineWebApp({
            id: "denied-entries-probe",
            routes: [{ path: "/", intentId: "secret", cache: "public" }],
            navigation:
                shape === "empty"
                    ? stack([])
                    : shape === "split"
                      ? split([
                            {
                                id: "left",
                                content: leaf("secret", { token: "REJECTED_PRIVATE_LEFT" }),
                            },
                            {
                                id: "right",
                                content: leaf("secret", { token: "REJECTED_PRIVATE_RIGHT" }),
                            },
                        ])
                      : undefined,
            controllers: [
                {
                    id: "secret",
                    handler: () => {
                        loads++;
                        return {
                            id: "secret",
                            pageType: "secret",
                            title: "REJECTED_PRIVATE_VALUE",
                        };
                    },
                },
            ],
            getErrorPage: (status, message) => ({
                id: String(status),
                pageType: "error",
                title: message,
            }),
            [phase]: [() => ({ kind: "deny", status: 403, message: "DENIED_ERROR_PAGE" })],
        });
        const render = createReactSSRRender({
            app,
            renderer: {
                mode: "entries",
                chrome: ({ context }) =>
                    createElement("aside", null, JSON.stringify(context.snapshot)),
                props: ({ context, initialSnapshot }) => {
                    assert.equal(context.snapshot, initialSnapshot);
                    contexts.push(initialSnapshot);
                    return {};
                },
                views: {
                    secret: ({ page }) => createElement("p", null, page.title),
                    error: ({ page }) => createElement("strong", null, page.title),
                },
            },
        });
        try {
            const result = await render("/");
            assert.equal(result.status, 403);
            assert.deepEqual(result.serverData, []);
            assert.equal(result.cache, undefined);
            assert.match(result.html, /<strong>DENIED_ERROR_PAGE<\/strong>/);
            assert.doesNotMatch(JSON.stringify(result), /REJECTED_PRIVATE|"secret"/);
            assert.equal((result.html.match(/data-fs-entry /g) ?? []).length, 1);
            assert.equal(contexts.length, 2); // Chrome and the error entry see the same safe snapshot.
            for (const snapshot of contexts) {
                assert.equal(snapshot, result.snapshot);
                assert.equal(snapshot.destinations.length, 1);
                assert.equal(snapshot.destinations[0].page.pageType, "error");
                assert.deepEqual(snapshot.destinations[0].params, {});
                assert.equal(snapshot.destinations[0].cache, undefined);
            }
            assert.equal(
                loads,
                phase === "beforeNavigate" || shape === "empty" ? 0 : shape === "split" ? 2 : 1,
            );
            report.cases.push({
                phase,
                shape,
                loads,
                status: result.status,
                html: result.html,
                head: result.head,
                serverData: result.serverData,
                snapshot: result.snapshot,
            });
        } finally {
            await render.dispose();
        }
    }
}
console.log(JSON.stringify(report, null, 2));
