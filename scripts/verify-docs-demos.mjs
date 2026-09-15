/** Exercise the built bilingual live examples; fenced snippets remain inert Markdown. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url).pathname;
const evidence = root + "reports/application-boundaries/docs-demos";
await fs.mkdir(evidence, { recursive: true });
const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    try {
        const file = path.resolve(
            root + "packages/site/dist",
            "." +
                (pathname === "/"
                    ? "/index.html"
                    : path.extname(pathname)
                      ? pathname
                      : pathname + ".html"),
        );
        response.setHeader(
            "content-type",
            file.endsWith(".js")
                ? "text/javascript"
                : file.endsWith(".css")
                  ? "text/css"
                  : "text/html",
        );
        response.end(await fs.readFile(file));
    } catch {
        response.statusCode = 404;
        response.end();
    }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const result = [],
    errors = [];
try {
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);
    page.on("pageerror", (error) => errors.push(String(error)));
    for (const locale of ["", "zh/"]) {
        const base = `http://127.0.0.1:${server.address().port}/` + locale;
        await page.goto(base + "02-routing-and-controllers");
        await page.getByPlaceholder("/products/42").fill("/products/77");
        await page.waitForFunction(() =>
            document.querySelector(".fs-demo")?.textContent?.includes('"77"'),
        );
        await page.screenshot({
            path: evidence + "/" + (locale ? "zh" : "en") + "-routes.png",
            fullPage: true,
        });
        await page.getByPlaceholder("/products/42").fill("/missing-route");
        await page.getByText("No route matched", { exact: false }).waitFor();
        await page.goto(base + "03-middleware");
        await page.locator(".fs-demo select").first().selectOption("deny");
        await page.getByRole("button", { name: "▶ Run chain" }).click();
        await page.locator(".result.r-deny").waitFor();
        assert.match(await page.locator(".result.r-deny").innerText(), /403 Forbidden/);
        assert.equal(await page.locator(".trace li").count(), 1);
        await page.screenshot({
            path: evidence + "/" + (locale ? "zh" : "en") + "-guards.png",
            fullPage: true,
        });
        result.push({
            locale: locale || "en",
            asyncRouteMatch: "77",
            notFound: true,
            guardShortCircuit: "403 after first guard",
        });
    }
    assert.deepEqual(errors, []);
    console.log("EN/ZH live Router and middleware demos passed against built site.");
} finally {
    await fs.writeFile(
        evidence + "/result.json",
        JSON.stringify({ browser: browser.version(), result, errors }, null, 2),
    );
    await browser.close();
    await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
    );
}
