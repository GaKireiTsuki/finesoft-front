import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const changesetDir = resolve(process.cwd(), ".changeset");
const frontPackagePath = resolve(process.cwd(), "packages/front/package.json");
const runId =
	process.env.GITHUB_RUN_ID ??
	process.env.GITHUB_SHA?.slice(0, 7) ??
	Date.now().toString();
const shortSha = process.env.GITHUB_SHA?.slice(0, 7);
const filePath = resolve(changesetDir, `ci-auto-${runId}.md`);
const frontPackage = JSON.parse(await readFile(frontPackagePath, "utf8"));
const packageName = frontPackage.name;

const content = `---
'${packageName}': patch
---

Auto-generated patch release from CI${shortSha ? ` (${shortSha})` : ""}.
`;

await mkdir(changesetDir, { recursive: true });
await writeFile(filePath, content, "utf8");

console.log(`Created changeset: ${filePath}`);
