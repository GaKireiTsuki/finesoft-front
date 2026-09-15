import assert from "node:assert/strict";
import { preview, createServer } from "vite-plus";
import { chromium } from "playwright";
import fs from "node:fs/promises";
const root = new URL("../", import.meta.url).pathname;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
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
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        page.on("console", (message) => {
            if (message.type() === "error" && !message.text().includes("404 (Not Found)"))
                errors.push(message.text());
        });
        try {
            const base = "http://127.0.0.1:5198";
            if (name === "react-minimal" || name === "vue-minimal") {
                await page.goto(base + "/item/2");
                await page.locator('input[name="note"]').fill("retained detail");
                await page.locator('input[placeholder="anon"]').fill("Alice");
                await page.locator('input[placeholder="anon"]').blur();
                await page.getByRole("button", { name: "Notes", exact: true }).click();
                await page.getByRole("button", { name: "Feed", exact: true }).click();
                assert.equal(
                    await page.locator('input[name="note"]').inputValue(),
                    "retained detail",
                );
                await page.reload();
                await page.waitForFunction(
                    () => document.querySelector('input[name="note"]')?.value === "retained detail",
                );
                assert.equal(await page.locator('input[placeholder="anon"]').inputValue(), "Alice");
                await page.getByRole("button", { name: "← Back", exact: true }).click();
                await page.locator("li button").nth(1).click();
                assert.equal(await page.locator('input[name="note"]').inputValue(), "");
            } else if (name === "svelte-minimal") {
                const response = await page.goto(base + "/");
                const html = await response.text();
                assert.ok(html.includes("当前语言"));
                await page.getByText("浏览器接管后，翻译器仍然可用。").waitFor();
                assert.equal(await page.locator("#app").getAttribute("lang"), "zh-Hans");
            } else {
                const response = await page.goto(base + "/products/2");
                assert.ok((await response.text()).includes("Product 2"));
                await page.getByRole("heading", { name: "Product 2", exact: true }).waitFor();
                await page.getByRole("link", { name: "About", exact: true }).click();
                await page.getByRole("heading", { name: /About/ }).waitFor();
                await page.goBack();
                await page.getByRole("heading", { name: "Product 2", exact: true }).waitFor();
                const csr = await page.goto(base + "/about");
                assert.equal((await csr.text()).includes("data-fs-server-data"), false);
                await page.getByRole("heading", { name: /About/ }).waitFor();
            }
            await fs.mkdir(root + "reports/template-renderers", { recursive: true });
            await page.screenshot({
                path: root + "reports/template-renderers/" + name + ".png",
                fullPage: true,
            });
            assert.deepEqual(errors, []);
            results.push({ name, artifact: "production preview", status: "passed" });
            console.log(name, "preview passed");
        } finally {
            await page.close();
            await new Promise((resolve, reject) =>
                server.httpServer.close((error) => (error ? reject(error) : resolve())),
            );
        }
    }
    // The old Svelte failure happened in development, so exercise the actual generated virtual module in dev too.
    const dev = await createServer({
        root: root + "templates/svelte-minimal",
        server: { port: 5199, strictPort: true, host: "127.0.0.1" },
    });
    await dev.listen();
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    try {
        await page.goto("http://127.0.0.1:5199/");
        await page.getByText("浏览器接管后，翻译器仍然可用。").waitFor();
        assert.equal(await page.locator("#app").getAttribute("lang"), "zh-Hans");
        assert.deepEqual(errors, []);
        results.push({
            name: "svelte-minimal",
            artifact: "development generated loader",
            status: "passed",
        });
        console.log("svelte-minimal generated-loader dev passed");
    } finally {
        await page.close();
        await dev.close();
    }
} finally {
    await browser.close();
    await fs.mkdir(root + "reports/template-renderers", { recursive: true });
    await fs.writeFile(
        root + "reports/template-renderers/results.json",
        JSON.stringify(results, null, 2),
    );
}
