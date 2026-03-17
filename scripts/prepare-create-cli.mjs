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
}

console.log(`✓ ${templates.length} templates copied to packages/create-app/templates/`);
