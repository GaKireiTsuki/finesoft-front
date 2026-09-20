import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const shared = {
    full: [
        "app-definition.ts",
        "lib/controllers",
        "lib/data",
        "lib/guards",
        "lib/mappers",
        "lib/models",
        "lib/services",
        "styles.css",
    ],
    minimal: [
        "app-definition.ts",
        "lib/controllers",
        "lib/models",
        "lib/navigation.ts",
        "lib/locale.ts",
        "locales",
        "styles.css",
        "vite-env.d.ts",
    ],
};
export const generatedTemplates = ["vue", "svelte", "vue-minimal", "svelte-minimal"];
const digest = (value) => createHash("sha256").update(value).digest("hex");

function files(directory, relative) {
    const file = path.join(directory, relative);
    if (!fs.existsSync(file)) return [];
    return fs.statSync(file).isDirectory()
        ? fs.readdirSync(file).flatMap((name) => files(directory, `${relative}/${name}`))
        : [relative];
}

/** Materialize portable sources; native views and entry points remain independently owned. */
export function syncTemplateSources(workspace = root, names = generatedTemplates) {
    for (const name of names) {
        if (!generatedTemplates.includes(name))
            throw new Error(`Unknown generated template: ${name}`);
        const minimal = name.endsWith("-minimal");
        const inputs = shared[minimal ? "minimal" : "full"];
        const source = path.join(
            workspace,
            "templates",
            minimal ? "react-minimal" : "react",
            "src",
        );
        if (!fs.statSync(source).isDirectory())
            throw new Error(`Missing template source: ${source}`);
        const target = path.join(workspace, "templates", name, "src");
        const manifest = path.join(workspace, ".template-cache", `${name}.json`);
        const previous = fs.existsSync(manifest)
            ? JSON.parse(fs.readFileSync(manifest, "utf8"))
            : {};
        const current = Object.fromEntries(
            inputs
                .flatMap((entry) => files(source, entry))
                .map((file) => [file, fs.readFileSync(path.join(source, file))]),
        );
        const changes = [];
        for (const file of new Set([...Object.keys(previous), ...Object.keys(current)])) {
            if (
                file.includes("\\") ||
                file.split("/").includes("..") ||
                !inputs.some((input) => file === input || file.startsWith(`${input}/`))
            )
                throw new Error(`Invalid generated template path: ${file}`);
            const output = path.join(target, file);
            if (fs.existsSync(output)) {
                const existing = fs.readFileSync(output);
                if (current[file]?.equals(existing)) continue;
                if (digest(existing) !== previous[file])
                    throw new Error(
                        `Local changes in ${output}; move them to ${path.join(source, file)} before synchronizing.`,
                    );
            }
            changes.push([output, current[file]]);
        }
        // Preflight the entire template before writing or deleting any of its files.
        for (const [output, value] of changes) {
            if (value === undefined) fs.rmSync(output, { force: true });
            else {
                fs.mkdirSync(path.dirname(output), { recursive: true });
                fs.writeFileSync(output, value);
            }
        }
        fs.mkdirSync(path.dirname(manifest), { recursive: true });
        const pending = `${manifest}.${process.pid}.tmp`;
        fs.writeFileSync(
            pending,
            JSON.stringify(
                Object.fromEntries(
                    Object.entries(current).map(([file, value]) => [file, digest(value)]),
                ),
            ),
        );
        fs.renameSync(pending, manifest);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const names = process.argv.slice(2).filter((arg) => arg !== "--watch");
    const sync = () => syncTemplateSources(root, names.length ? names : generatedTemplates);
    sync();
    if (process.argv.includes("--watch")) {
        let timer;
        for (const name of ["react", "react-minimal"])
            fs.watch(path.join(root, "templates", name, "src"), { recursive: true }, () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    try {
                        sync();
                    } catch (error) {
                        console.error(error.message);
                    }
                }, 50);
            });
        console.log("Watching portable template sources in react and react-minimal.");
    }
}
