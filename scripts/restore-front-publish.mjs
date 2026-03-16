import { access, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const packageJsonPath = resolve(process.cwd(), "package.json");
const backupPath = resolve(process.cwd(), "package.json.publish-backup");

try {
    await access(backupPath, constants.F_OK);
} catch {
    console.log("No publish backup found for packages/front/package.json.");
    process.exit(0);
}

await writeFile(packageJsonPath, await readFile(backupPath));
await rm(backupPath, { force: true });

console.log("Restored package.json after publish.");
