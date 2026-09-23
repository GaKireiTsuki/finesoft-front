/**
 * Copies template directories from `templates/` into
 * `packages/create-app/templates/` before publish.
 *
 * Skips `node_modules` and `dist` directories.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { syncTemplateSources } from "./sync-template-sources.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "templates");
const destDir = path.join(root, "packages", "create-app", "templates");

const SKIP = new Set(["node_modules", "dist", ".turbo", ".finesoft"]);

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
const packageManager = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf-8"),
).packageManager;

/** Read scalar package-version mappings from the workspace configuration. */
function readWorkspaceVersions(section) {
    const wsPath = path.join(root, "pnpm-workspace.yaml");
    const raw = fs.readFileSync(wsPath, "utf-8");
    const entries = {};
    let inSection = false;
    for (const line of raw.split("\n")) {
        if (line === `${section}:`) {
            inSection = true;
            continue;
        }
        if (inSection && /^\s{4}\S/.test(line)) {
            const m = line.match(/^\s{4}(.+?):\s*(.+)$/);
            if (m) entries[m[1].trim().replace(/"/g, "")] = m[2].trim().replace(/"/g, "");
        } else if (inSection && /^\S/.test(line)) {
            inSection = false;
        }
    }
    return entries;
}

const catalog = readWorkspaceVersions("catalog");
const overrides = Object.fromEntries(
    Object.entries(readWorkspaceVersions("overrides")).map(([name, value]) => [
        name,
        value === "catalog:" ? catalog[name] : value,
    ]),
);
for (const [name, version] of Object.entries(overrides)) {
    if (!version) throw new Error(`Unresolved template override: ${name}`);
}
const patches = readWorkspaceVersions("patchedDependencies");

/** pnpm 11 reads overrides from workspace YAML, including standalone applications. */
function writeTemplateWorkspace(directory) {
    for (const file of Object.values(patches)) {
        const target = path.join(directory, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(root, file), target);
    }
    const mappings = Object.entries({ overrides, patchedDependencies: patches })
        .map(
            ([section, entries]) =>
                `${section}:\n${Object.entries(entries)
                    .map(([name, value]) => `    ${JSON.stringify(name)}: ${JSON.stringify(value)}`)
                    .join("\n")}`,
        )
        .join("\n\n");
    fs.writeFileSync(
        path.join(directory, "pnpm-workspace.yaml"),
        `packages:\n    - "."\n\n# Keep the patched toolchain and dependency versions used by the framework.\n${mappings}\n`,
    );
}

/**
 * Rewrite a template package.json:
 * - "workspace:*" → "^<front-version>"
 * - "catalog:"    → resolved value from pnpm catalog
 */
function rewriteTemplatePkg(pkgJsonPath) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    pkg.packageManager = packageManager;
    for (const hook of ["predev", "prebuild"]) {
        if (pkg.scripts?.[hook]?.startsWith("node ../../scripts/sync-template-sources.mjs "))
            delete pkg.scripts[hook];
    }
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

/** Turn the workspace tsconfig into an independent consumer config. */
function rewriteTemplateTsconfig(file) {
    const base = JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8"));
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    delete config.extends;
    config.compilerOptions = { ...base.compilerOptions, ...config.compilerOptions };
    // Drop workspace aliases, retaining only the project-generated public type facade.
    config.compilerOptions.paths = { "@finesoft/front": ["./.finesoft/front.d.ts"] };
    fs.writeFileSync(file, JSON.stringify(config, null, 4) + "\n");
}

// ── Copy templates ──

syncTemplateSources();

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
    writeTemplateWorkspace(to);

    rewriteTemplateTsconfig(path.join(to, "tsconfig.json"));

    // Rewrite monorepo-only references in the copied template
    const pkgJson = path.join(to, "package.json");
    if (fs.existsSync(pkgJson)) {
        rewriteTemplatePkg(pkgJson);
    }
}

console.log(
    `✓ ${templates.length} templates copied (workspace:* → ^${frontVersion}, catalog: resolved)`,
);
