import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const packageJsonPath = resolve(process.cwd(), "package.json");
const backupPath = resolve(process.cwd(), "package.json.publish-backup");

const INTERNAL_PACKAGES = [
    "@finesoft/core",
    "@finesoft/browser",
    "@finesoft/ssr",
    "@finesoft/server",
];

async function collectPublishableDistFiles(dirPath) {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const entryPath = resolve(dirPath, entry.name);

        if (entry.isDirectory()) {
            files.push(...(await collectPublishableDistFiles(entryPath)));
            continue;
        }

        if (!entry.name.endsWith(".map")) {
            files.push(relative(process.cwd(), entryPath).replaceAll("\\", "/"));
        }
    }

    return files.sort((a, b) => a.localeCompare(b));
}

await copyFile(packageJsonPath, backupPath);

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

if (packageJson.devDependencies) {
    for (const packageName of INTERNAL_PACKAGES) {
        delete packageJson.devDependencies[packageName];
    }
}

const publishableDistFiles = await collectPublishableDistFiles(resolve(process.cwd(), "dist"));
const extraFiles = Array.isArray(packageJson.files)
    ? packageJson.files.filter((file) => !String(file).startsWith("dist"))
    : [];

packageJson.files = [...publishableDistFiles, ...extraFiles];

await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, "\t")}\n`, "utf8");

console.log("Prepared packages/front/package.json for publish.");
