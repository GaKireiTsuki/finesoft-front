import * as prompts from "@clack/prompts";
import { bold, cyan, green, red } from "kolorist";
import * as fs from "node:fs";
import * as path from "node:path";

interface FrameworkOption {
    name: string;
    display: string;
    color: (str: string) => string;
    variants: { name: string; display: string }[];
}

const FRAMEWORKS: FrameworkOption[] = [
    {
        name: "vue",
        display: "Vue",
        color: green,
        variants: [
            { name: "vue", display: "Full (SSR + routing + DI + guards)" },
            { name: "vue-minimal", display: "Minimal" },
        ],
    },
    {
        name: "react",
        display: "React",
        color: cyan,
        variants: [
            { name: "react", display: "Full (SSR + routing + DI + guards)" },
            { name: "react-minimal", display: "Minimal" },
        ],
    },
    {
        name: "svelte",
        display: "Svelte",
        color: red,
        variants: [
            { name: "svelte", display: "Full (SSR + routing + DI + guards)" },
            { name: "svelte-minimal", display: "Minimal" },
        ],
    },
];

async function main() {
    prompts.intro(bold("Create Finesoft App"));

    const project = await prompts.group(
        {
            name: () =>
                prompts.text({
                    message: "Project name",
                    placeholder: "my-finesoft-app",
                    defaultValue: "my-finesoft-app",
                    validate: (value) => {
                        if (!value) return "Project name is required";
                        if (/[^\w\-.]/.test(value)) return "Invalid project name";
                    },
                }),
            framework: () =>
                prompts.select({
                    message: "Framework",
                    options: FRAMEWORKS.map((f) => ({
                        value: f.name,
                        label: f.color(f.display),
                    })),
                }),
            variant: ({ results }) => {
                const fw = FRAMEWORKS.find((f) => f.name === results.framework)!;
                return prompts.select({
                    message: "Template",
                    options: fw.variants.map((v) => ({
                        value: v.name,
                        label: v.display,
                    })),
                });
            },
        },
        {
            onCancel: () => {
                prompts.cancel("Operation cancelled.");
                process.exit(0);
            },
        },
    );

    const targetDir = path.resolve(process.cwd(), project.name);
    const templateName = project.variant as string;

    // Resolve template directory — check relative to this script (npm package)
    const templateDir = path.resolve(
        new URL(".", import.meta.url).pathname,
        "..",
        "templates",
        templateName,
    );

    if (!fs.existsSync(templateDir)) {
        prompts.log.error(`Template "${templateName}" not found at ${templateDir}`);
        process.exit(1);
    }

    if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
        const overwrite = await prompts.confirm({
            message: `Directory "${project.name}" is not empty. Overwrite?`,
        });
        if (!overwrite || prompts.isCancel(overwrite)) {
            prompts.cancel("Operation cancelled.");
            process.exit(0);
        }
        fs.rmSync(targetDir, { recursive: true, force: true });
    }

    // Copy template
    copyDir(templateDir, targetDir);

    // Update package.json name
    const pkgPath = path.join(targetDir, "package.json");
    if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        pkg.name = project.name;
        // Remove monorepo-only references — they only work inside the workspace
        for (const section of ["dependencies", "devDependencies"] as const) {
            if (!pkg[section]) continue;
            for (const [key, value] of Object.entries(pkg[section])) {
                if (typeof value === "string" && value.startsWith("workspace:")) {
                    pkg[section][key] = "latest";
                } else if (value === "catalog:") {
                    pkg[section][key] = "latest";
                }
            }
        }
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + "\n");
    }

    const fw = FRAMEWORKS.find((f) => f.name === project.framework)!;
    prompts.log.success(green(`Created ${bold(project.name)} with ${fw.color(fw.display)}`));

    prompts.note([`cd ${project.name}`, "vp install", "vp dev"].join("\n"), "Next steps");

    prompts.outro("Happy coding!");
}

function copyDir(src: string, dest: string) {
    fs.mkdirSync(dest, { recursive: true });

    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.name === "node_modules" || entry.name === "dist") continue;

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
