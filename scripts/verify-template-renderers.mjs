import assert from "node:assert/strict";
import { preview, createServer } from "vite-plus";
import { chromium } from "playwright";
import fs from "node:fs/promises";
const root = new URL("../", import.meta.url).pathname;
const evidence = root + "reports/template-unification/browser";
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const parity = new Map();

function checkParity(tier, contents) {
    if (parity.has(tier)) assert.deepEqual(contents, parity.get(tier), tier + " view parity");
    else parity.set(tier, contents);
}

async function captureView(locator) {
    return {
        text: await locator.innerText(),
        structure: await locator.evaluate((element) => {
            const visit = (node) => ({
                tag: node.tagName.toLowerCase(),
                classes: [...node.classList].sort((a, b) => a.localeCompare(b)),
                attributes: Object.fromEntries(
                    [
                        "name",
                        "type",
                        "role",
                        "href",
                        "aria-label",
                        "aria-current",
                        "placeholder",
                        "rows",
                        "data-restore-root",
                    ]
                        .filter((name) => node.hasAttribute(name))
                        // This opt-in flag is presence-based; native HTML serializers use "" or "true".
                        .map((name) => [
                            name,
                            name === "data-restore-root" ? true : node.getAttribute(name),
                        ]),
                ),
                children: [...node.children].map(visit),
            });
            return visit(element);
        }),
    };
}

async function waitValue(page, selector, value) {
    await page.waitForFunction(
        ({ selector, value }) => document.querySelector(selector)?.value === value,
        { selector, value },
    );
}

function captureErrors(page) {
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("404 (Not Found)"))
            errors.push(message.text());
        if (message.type() === "warning" && /hydration|mismatch/i.test(message.text()))
            errors.push(message.text());
    });
    return errors;
}

async function open(page, url) {
    const response = await page.goto(url);
    await page.waitForLoadState("networkidle");
    return response;
}

try {
    for (const name of [
        "react",
        "react-minimal",
        "vue",
        "vue-minimal",
        "svelte",
        "svelte-minimal",
    ]) {
        const server = await preview({
            root: root + "templates/" + name,
            preview: { port: 5198, strictPort: true, host: "127.0.0.1" },
        });
        const page = await browser.newPage();
        const errors = captureErrors(page);
        try {
            const base = "http://127.0.0.1:5198";
            const contents = {};
            if (name.endsWith("-minimal")) {
                const response = await open(page, base + "/item/2");
                assert.ok((await response.text()).includes("Item 2"));
                await page.locator('input[name="note"]').fill("retained detail");
                await page.locator('input[placeholder="anon"]').fill("Alice");
                await page.locator('input[placeholder="anon"]').blur();
                await page.getByRole("button", { name: "Notes", exact: true }).click();
                await page.locator('textarea[name="notes"]').fill("retained notes");
                contents.notes = await captureView(page.locator(".page:visible"));
                await page.screenshot({
                    path: evidence + "/" + name + "-notes.png",
                    fullPage: true,
                });
                await page.getByRole("button", { name: "Feed", exact: true }).click();
                await page.getByRole("heading", { name: "Item 2", exact: true }).waitFor();
                assert.equal(
                    await page.locator('input[name="note"]').inputValue(),
                    "retained detail",
                );
                await page.reload();
                await page.waitForFunction(
                    () => document.querySelector('input[name="note"]')?.value === "retained detail",
                );
                assert.equal(await page.locator('input[placeholder="anon"]').inputValue(), "Alice");
                await page.getByRole("button", { name: "Notes", exact: true }).click();
                await waitValue(page, 'textarea[name="notes"]', "retained notes");
                await page.reload();
                await waitValue(page, 'textarea[name="notes"]', "retained notes");
                await waitValue(page, 'input[placeholder="anon"]', "Alice");
                await page.getByRole("button", { name: "Feed", exact: true }).click();
                await waitValue(page, 'input[name="note"]', "retained detail");
                await page.getByRole("button", { name: "← Back", exact: true }).click();
                await page.getByRole("heading", { name: "Feed", exact: true }).waitFor();
                assert.equal(await page.locator("#app").getAttribute("lang"), "zh-Hans");
                await page.getByText("浏览器接管后，翻译器仍然可用。").waitFor();
                contents.home = await captureView(page.locator(".page:visible"));
                await page.screenshot({
                    path: evidence + "/" + name + "-home.png",
                    fullPage: true,
                });
                await page
                    .getByRole("button", { name: "Session restoration", exact: true })
                    .click();
                await page.getByRole("heading", { name: "Item 2", exact: true }).waitFor();
                assert.equal(await page.locator('input[name="note"]').inputValue(), "");
                contents.detail = await captureView(page.locator(".page:visible"));
                await page.screenshot({
                    path: evidence + "/" + name + "-detail.png",
                    fullPage: true,
                });
                await page.goBack();
                await page.getByRole("heading", { name: "Feed", exact: true }).waitFor();
                await page.goForward();
                await page.getByRole("heading", { name: "Item 2", exact: true }).waitFor();
                await page.evaluate(() => sessionStorage.clear());
                const home = await open(page, base + "/");
                assert.ok((await home.text()).includes("当前语言"));
            } else {
                const response = await open(page, base + "/products/2");
                assert.ok((await response.text()).includes("Product 2"));
                await page.getByRole("heading", { name: "Product 2", exact: true }).waitFor();
                contents.detail = await captureView(page.locator(".page:visible"));
                await page.evaluate(() => {
                    window.__templateDocument = "retained";
                });
                await page.getByRole("link", { name: "About", exact: true }).click();
                await page.getByRole("heading", { name: /About/ }).waitFor();
                assert.equal(await page.evaluate(() => window.__templateDocument), "retained");
                contents.about = await captureView(page.locator(".page:visible"));
                await page.goBack();
                await page.getByRole("heading", { name: "Product 2", exact: true }).waitFor();
                const csr = await open(page, base + "/about");
                assert.equal((await csr.text()).includes("data-fs-server-data"), false);
                await page.getByRole("heading", { name: /About/ }).waitFor();
                await open(page, base + "/search?q=Vite");
                assert.equal(await page.locator(".product-card").count(), 1);
                contents.search = await captureView(page.locator(".page:visible"));
                assert.ok(contents.search.text.includes("Vite Starter Kit"));
                await open(page, base + "/search?q=missing");
                await page.getByText("No products found.").waitFor();
                await open(page, base + "/");
                assert.equal(await page.locator(".product-card").count(), 3);
                contents.home = await captureView(page.locator(".page:visible"));
                await page.screenshot({
                    path: evidence + "/" + name + "-home.png",
                    fullPage: true,
                });
                await page.locator(".product-card").nth(1).getByRole("link").click();
                await page.getByRole("heading", { name: "Product 2", exact: true }).waitFor();
                // A real modified click opens a separate page and preserves this application's route.
                const popupPromise = page.context().waitForEvent("page");
                await page
                    .getByRole("link", { name: "Home", exact: true })
                    .click({ modifiers: ["ControlOrMeta"] });
                const popup = await popupPromise;
                await popup.waitForLoadState("domcontentloaded");
                assert.equal(new URL(popup.url()).pathname, "/");
                assert.equal(new URL(page.url()).pathname, "/products/2");
                await popup.close();
                await open(page, base + "/admin");
                assert.equal(new URL(page.url()).pathname, "/login");
                assert.equal(new URL(page.url()).searchParams.get("from"), "/admin");
                await page.context().addCookies([{ name: "auth_token", value: "demo", url: base }]);
                await open(page, base + "/admin");
                await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
            }
            const missing = await open(page, base + "/does-not-exist");
            assert.equal(missing.status(), 404);
            await page.getByRole("heading", { name: "Error 404", exact: true }).waitFor();
            contents.error = await captureView(page.locator(".page:visible"));
            await page.getByRole("link", { name: "← Go Home", exact: true }).click();
            await page
                .getByRole("heading", {
                    name: name.endsWith("-minimal") ? "Feed" : "Home",
                    exact: true,
                })
                .waitFor();
            if (name.endsWith("-minimal")) {
                await page.getByRole("button", { name: "Notes", exact: true }).click();
                await page.getByRole("heading", { name: "Notes", exact: true }).waitFor();
                await page.getByRole("button", { name: "Feed", exact: true }).click();
                await page.getByRole("heading", { name: "Feed", exact: true }).waitFor();
            }
            contents.chrome = await captureView(
                page.locator(name.endsWith("-minimal") ? ".app-chrome" : ".navigation"),
            );
            checkParity(name.endsWith("-minimal") ? "minimal" : "full", contents);
            assert.deepEqual(errors, []);
            results.push({
                name,
                artifact: "production preview",
                status: "passed",
                contents,
                errors,
            });
            console.log(name, "preview passed");
        } finally {
            await page.close();
            await new Promise((resolve, reject) =>
                server.httpServer.close((error) => (error ? reject(error) : resolve())),
            );
        }
    }
    // Exercise the generated locale loader and multiple independently mounted applications in every native UI.
    for (const name of ["react-minimal", "vue-minimal", "svelte-minimal"]) {
        const dev = await createServer({
            root: root + "templates/" + name,
            server: { port: 5199, strictPort: true, host: "127.0.0.1" },
        });
        await dev.listen();
        const page = await browser.newPage();
        const errors = captureErrors(page);
        try {
            const response = await open(page, "http://127.0.0.1:5199/");
            assert.ok((await response.text()).includes("当前语言"));
            await page.getByText("浏览器接管后，翻译器仍然可用。").waitFor();
            assert.equal(await page.locator("#app").getAttribute("lang"), "zh-Hans");
            await page.evaluate(async () => {
                const { started, mountApplication } = await import("/src/main.ts");
                const firstHandle = await started;
                await firstHandle.ready;
                const { app } = await import("/src/app-definition.ts");
                const english = await app.loadMessages("en-US");
                if (english["home.localeLabel"] !== "Current locale")
                    throw Error("English loader mismatch");
                const second = document.createElement("div");
                second.id = "second-app";
                document.body.append(second);
                window.__secondApp = await mountApplication(
                    second,
                    "isolated-second-app",
                    "memory",
                );
                await window.__secondApp.ready;
            });
            const first = page.locator("#app"),
                second = page.locator("#second-app");
            await first.getByPlaceholder("anon").fill("Alice");
            await second.getByPlaceholder("anon").fill("Bob");
            assert.equal(await first.getByPlaceholder("anon").inputValue(), "Alice");
            assert.equal(await second.getByPlaceholder("anon").inputValue(), "Bob");
            await second
                .getByRole("button", { name: "Structured navigation", exact: true })
                .click();
            await second.getByRole("heading", { name: "Item 1", exact: true }).waitFor();
            assert.equal(new URL(page.url()).pathname, "/");
            assert.equal(
                await first.getByRole("heading", { name: "Feed", exact: true }).count(),
                1,
            );
            // Invalid navigation preserves a healthy entry; start an independent error root instead.
            await page.evaluate(async () => {
                await window.__secondApp.dispose();
                const target = document.getElementById("second-app");
                target.replaceChildren();
                const { mountApplication } = await import("/src/main.ts");
                window.__secondApp = await mountApplication(
                    target,
                    "isolated-error-app",
                    "memory",
                    "/does-not-exist",
                );
                await window.__secondApp.ready;
            });
            await second.getByRole("heading", { name: "Error 404", exact: true }).waitFor();
            await second.getByRole("link", { name: "← Go Home", exact: true }).click();
            await second.getByRole("heading", { name: "Feed", exact: true }).waitFor();
            await second.getByRole("button", { name: "Notes", exact: true }).click();
            await second.getByRole("heading", { name: "Notes", exact: true }).waitFor();
            assert.equal(new URL(page.url()).pathname, "/");
            assert.equal(await first.getByPlaceholder("anon").inputValue(), "Alice");
            await page.evaluate(async () => {
                await window.__secondApp.dispose();
                document.getElementById("second-app").remove();
            });
            await first.getByRole("button", { name: "Notes", exact: true }).click();
            await first.getByRole("heading", { name: "Notes", exact: true }).waitFor();
            assert.deepEqual(errors, []);
            results.push({
                name,
                artifact: "development generated loader and independent mounts",
                status: "passed",
            });
            console.log(name, "generated-loader and independent mounts passed");
        } finally {
            await page.close();
            await dev.close();
        }
    }
} finally {
    await browser.close();
    await fs.writeFile(evidence + "/results.json", JSON.stringify(results, null, 2));
}
