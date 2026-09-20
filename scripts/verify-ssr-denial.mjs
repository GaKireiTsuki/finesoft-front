/** Built-public native SSR regression: denied candidates never enter presentation. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineWebApp, leaf, split, stack } from "../packages/front/dist/web.mjs";
import { createSSRRender } from "../packages/front/dist/ssr.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const report = {
    source: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    diffSha256: createHash("sha256").update(git("diff", "HEAD")).digest("hex"),
    timestamp: new Date().toISOString(),
    node: process.version,
    artifacts: Object.fromEntries(
        ["web.mjs", "ssr.mjs"].map((entry) => [
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
            pages: [
                {
                    id: "secret",
                    routes: [{ path: "/" }],
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
            getErrorPage: (status, message) => ({
                id: String(status),
                pageType: "error",
                title: message,
            }),
            [phase]: [() => ({ kind: "deny", status: 403, message: "DENIED_ERROR_PAGE" })],
        });
        const render = createSSRRender({
            definition: app,
            render: (view) => {
                const snapshot = view.getSnapshot();
                contexts.push(snapshot);
                return `<strong>${snapshot.entries.at(-1)?.page.title ?? ""}</strong>`;
            },
        });
        try {
            const result = await render("/");
            assert.equal(result.status, 403);
            assert.deepEqual(result.serverData.pages, []);
            assert.equal(result.serverData.tree, undefined);
            assert.equal(result.cache, undefined);
            assert.match(result.html, /<strong>DENIED_ERROR_PAGE<\/strong>/);
            assert.doesNotMatch(JSON.stringify(result), /REJECTED_PRIVATE|"secret"/);
            assert.equal(contexts.length, 1);
            const snapshot = contexts[0];
            assert.equal(snapshot.destinations.length, 1);
            assert.equal(snapshot.destinations[0].page.pageType, "error");
            assert.deepEqual(snapshot.destinations[0].params, {});
            assert.equal(snapshot.destinations[0].cache, undefined);
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
                snapshot,
            });
        } finally {
            await render.dispose();
        }
    }
}
console.log(JSON.stringify(report, null, 2));
