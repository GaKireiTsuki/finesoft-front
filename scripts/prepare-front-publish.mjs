import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageJsonPath = resolve(process.cwd(), "package.json");
const backupPath = resolve(process.cwd(), "package.json.publish-backup");

const INTERNAL_PACKAGES = [
	"@finesoft/core",
	"@finesoft/browser",
	"@finesoft/ssr",
	"@finesoft/server",
];

await copyFile(packageJsonPath, backupPath);

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

if (packageJson.devDependencies) {
	for (const packageName of INTERNAL_PACKAGES) {
		delete packageJson.devDependencies[packageName];
	}
}

await writeFile(
	packageJsonPath,
	`${JSON.stringify(packageJson, null, "\t")}\n`,
	"utf8",
);

console.log("Prepared packages/front/package.json for publish.");
