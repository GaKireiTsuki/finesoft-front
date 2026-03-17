/**
 * Copies template directories from `templates/` into
 * `packages/create-app/templates/` before publish.
 *
 * Skips `node_modules` and `dist` directories.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "templates");
const destDir = path.join(root, "packages", "create-app", "templates");

const SKIP = new Set(["node_modules", "dist", ".turbo"]);

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });

    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;

        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// ── Resolve monorepo-only references ──

/** Read @finesoft/front version for workspace:* replacement */
const frontPkgPath = path.join(root, "packages", "front", "package.json");
const frontVersion = JSON.parse(fs.readFileSync(frontPkgPath, "utf-8")).version;

/** Read pnpm catalog for catalog: replacement */
function readCatalog() {
    const wsPath = path.join(root, "pnpm-workspace.yaml");
    const raw = fs.readFileSync(wsPath, "utf-8");
    const entries = {};
    let inCatalog = false;
    for (const line of raw.split("\n")) {
        if (line.startsWith("catalog:")) {
            inCatalog = true;
            continue;
        }
        if (inCatalog && /^\s{4}\S/.test(line)) {
            const m = line.match(/^\s{4}(.+?):\s*(.+)$/);
            if (m) entries[m[1].trim().replace(/"/g, "")] = m[2].trim().replace(/"/g, "");
        } else if (inCatalog && /^\S/.test(line)) {
            inCatalog = false;
        }
    }
    return entries;
}

const catalog = readCatalog();

/**
 * Rewrite a template package.json:
 * - "workspace:*" → "^<front-version>"
 * - "catalog:"    → resolved value from pnpm catalog
 */
function rewriteTemplatePkg(pkgJsonPath) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    for (const section of ["dependencies", "devDependencies"]) {
        if (!pkg[section]) continue;
        for (const [name, value] of Object.entries(pkg[section])) {
            if (typeof value === "string" && value.startsWith("workspace:")) {
                pkg[section][name] = `^${frontVersion}`;
            } else if (value === "catalog:") {
                pkg[section][name] = catalog[name] ?? "latest";
            }
        }
    }
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 4) + "\n");
}

// ── Copy templates ──

// Clean previous templates
if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
}

if (!fs.existsSync(srcDir)) {
    console.error("templates/ directory not found at", srcDir);
    process.exit(1);
}

const templates = fs.readdirSync(srcDir, { withFileTypes: true }).filter((d) => d.isDirectory());

for (const tpl of templates) {
    const from = path.join(srcDir, tpl.name);
    const to = path.join(destDir, tpl.name);
    console.log(`  Copying ${tpl.name}...`);
    copyDir(from, to);

    // Rewrite monorepo-only references in the copied template
    const pkgJson = path.join(to, "package.json");
    if (fs.existsSync(pkgJson)) {
        rewriteTemplatePkg(pkgJson);
    }
}

console.log(
    `✓ ${templates.length} templates copied (workspace:* → ^${frontVersion}, catalog: resolved)`,
);
