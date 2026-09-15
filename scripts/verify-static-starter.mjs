/** Build the exported static adapter with an unchanged current starter, then hydrate its HTML. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createServer as httpServer } from "node:http";
import { build } from "vite-plus";
import { chromium } from "playwright";
import { finesoftFrontViteConfig, staticAdapter } from "../packages/front/dist/vite.mjs";
const root = new URL("../", import.meta.url).pathname;
const artifact = root + "reports/template-unification/static-starter";
await fs.mkdir(artifact, { recursive: true });
await fs.cp(root + "templates/react-minimal/src", artifact + "/src", { recursive: true });
await fs.copyFile(root + "templates/react-minimal/index.html", artifact + "/index.html");
// SSR sub-builds read the application's Vite config, including its locale loader plugin.
await fs.copyFile(root + "templates/react-minimal/vite.config.ts", artifact + "/vite.config.ts");
await fs.writeFile(artifact + "/package.json", '{"type":"module","private":true}\n');
try {
    await fs.symlink(
        root + "templates/react-minimal/node_modules",
        artifact + "/node_modules",
        "dir",
    );
} catch (error) {
    if (error.code !== "EEXIST") throw error;
}
const require = createRequire(root + "templates/react-minimal/package.json");
const react = (await import(pathToFileURL(require.resolve("@vitejs/plugin-react")))).default;
await build({
    root: artifact,
    configFile: false,
    plugins: [
        react(),
        finesoftFrontViteConfig({
            adapter: staticAdapter({ dynamicRoutes: ["/item/2"] }),
            ssr: { entry: "src/ssr.ts" },
            i18n: { messagesDir: "src/locales" },
        }),
    ],
});
const html = await fs.readFile(artifact + "/dist/static/item/2/index.html", "utf8");
assert.ok(html.includes("data-fs-server-data"));
assert.ok(html.includes("Item 2"));
const server = httpServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    try {
        const file = path.resolve(
            artifact + "/dist/static",
            "." + pathname,
            path.extname(pathname) ? "" : "index.html",
        );
        const data = await fs.readFile(file);
        response.setHeader(
            "content-type",
            file.endsWith(".js")
                ? "text/javascript"
                : file.endsWith(".css")
                  ? "text/css"
                  : "text/html",
        );
        response.end(data);
    } catch {
        response.statusCode = 404;
        response.end();
    }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
    const page = await browser.newPage(),
        errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("404"))
            errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/item/2`);
    await page.locator('input[name="note"]').fill("static hydrated draft");
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("button", { name: "Feed", exact: true }).click();
    assert.equal(await page.locator('input[name="note"]').inputValue(), "static hydrated draft");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: artifact + "/hydrated.png", fullPage: true });
    await fs.writeFile(
        artifact + "/result.json",
        JSON.stringify(
            {
                artifact:
                    "React-minimal copied unchanged; actual exported staticAdapter; /, /notes, /item/2",
                browser: browser.version(),
                dataMarker: true,
                hydrate: "passed",
                retainedDraftAfterTabSwitch: true,
                errors,
            },
            null,
            2,
        ),
    );
    console.log(
        "static starter: built route metadata, shared target-local wire HTML, browser hydration and retained draft passed",
    );
} finally {
    await browser.close();
    await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
    );
}
