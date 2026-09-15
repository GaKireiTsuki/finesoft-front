import { copyFile, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { relative, resolve } from "node:path";

const packageJsonPath = resolve(process.cwd(), "package.json");
const backupPath = resolve(process.cwd(), "package.json.publish-backup");

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

// Refuse a second prepare rather than overwriting the only restoration copy.
await copyFile(packageJsonPath, backupPath, constants.COPYFILE_EXCL);
try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

    // Consumer manifests contain only runtime contracts, never workspace/tooling dependencies.
    delete packageJson.devDependencies;

    const publishableDistFiles = await collectPublishableDistFiles(resolve(process.cwd(), "dist"));
    const extraFiles = Array.isArray(packageJson.files)
        ? packageJson.files.filter((file) => !String(file).startsWith("dist"))
        : [];

    packageJson.files = [...publishableDistFiles, ...extraFiles];

    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, "\t")}\n`, "utf8");

    console.log("Prepared packages/front/package.json for publish.");
} catch (error) {
    await writeFile(packageJsonPath, await readFile(backupPath));
    await rm(backupPath);
    throw error;
}
