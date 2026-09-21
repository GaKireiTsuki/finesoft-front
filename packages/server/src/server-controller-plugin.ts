import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type ts from "typescript";

interface BuildContext {
    environment?: { config?: { consumer?: string } };
    resolve(
        id: string,
        importer: string,
        options: { skipSelf: boolean },
    ): Promise<{ id: string } | null>;
    addWatchFile(id: string): void;
}
const serverEntries = new Set(["@finesoft/ssr"]);
/** Class inheritance is the boundary. No directory names or application module execution are involved. */
export function serverControllerModules(getRoot: () => string) {
    let compiler: typeof ts | undefined;
    const sources = new Map<string, { stamp: string; source: ts.SourceFile }>();
    const privateFiles = new Set<string>();
    const pending = new Set<string>();
    let initialized = false;
    let indexing: Promise<void> | undefined;
    const getCompiler = (): typeof ts =>
        (compiler ??= createRequire(path.join(getRoot(), "package.json"))("typescript"));
    const read = (file: string): ts.SourceFile | undefined => {
        if (
            !path.isAbsolute(file) ||
            file.includes("\0") ||
            !/\.[cm]?[jt]sx?$/.test(file) ||
            file.includes("/node_modules/")
        )
            return;
        const stat = fs.statSync(file, { throwIfNoEntry: false });
        if (!stat?.isFile()) return;
        const stamp = `${stat.mtimeMs}:${stat.size}`;
        const old = sources.get(file);
        if (old?.stamp === stamp) return old.source;
        const source = getCompiler().createSourceFile(
            file,
            fs.readFileSync(file, "utf8"),
            getCompiler().ScriptTarget.Latest,
            true,
        );
        sources.set(file, { stamp, source });
        return source;
    };
    const has = (node: ts.Node, kind: ts.SyntaxKind) =>
        getCompiler().canHaveModifiers(node) &&
        getCompiler()
            .getModifiers(node)
            ?.some((m) => m.kind === kind);

    async function exported(
        context: BuildContext,
        specifier: string,
        importer: string,
        name: string,
        seen: Set<string>,
    ): Promise<boolean> {
        if (specifier === "@finesoft/front" || serverEntries.has(specifier))
            return name === "BaseServerController";
        if (specifier.startsWith("@finesoft/")) return false;
        const resolved = await context.resolve(specifier, importer, { skipSelf: true });
        if (!resolved) return false;
        const file = resolved.id.split("?")[0]!;
        const key = `${file}#${name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        const source = read(file);
        if (!source) return false;
        context.addWatchFile(file);
        const c = getCompiler();
        for (const statement of source.statements) {
            if (c.isClassDeclaration(statement) && has(statement, c.SyntaxKind.ExportKeyword)) {
                const target = has(statement, c.SyntaxKind.DefaultKeyword)
                    ? "default"
                    : statement.name?.text;
                if (target === name) return serverClass(context, source, statement, seen);
            }
            if (c.isExportDeclaration(statement) && !statement.isTypeOnly) {
                const module =
                    statement.moduleSpecifier && c.isStringLiteral(statement.moduleSpecifier)
                        ? statement.moduleSpecifier.text
                        : undefined;
                if (
                    !statement.exportClause &&
                    module &&
                    (await exported(context, module, file, name, new Set(seen)))
                )
                    return true;
                if (statement.exportClause && c.isNamedExports(statement.exportClause)) {
                    for (const item of statement.exportClause.elements) {
                        if (item.isTypeOnly || item.name.text !== name) continue;
                        const local = (item.propertyName ?? item.name).text;
                        return module
                            ? exported(context, module, file, local, seen)
                            : identifier(context, source, local, seen);
                    }
                }
            }
            if (name === "default" && c.isExportAssignment(statement))
                return expression(context, source, statement.expression, seen);
        }
        return false;
    }
    async function identifier(
        context: BuildContext,
        source: ts.SourceFile,
        name: string,
        seen: Set<string>,
    ): Promise<boolean> {
        const key = `${source.fileName}:local:${name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        const c = getCompiler();
        for (const statement of source.statements) {
            if (c.isClassDeclaration(statement) && statement.name?.text === name)
                return serverClass(context, source, statement, seen);
            if (c.isVariableStatement(statement))
                for (const item of statement.declarationList.declarations)
                    if (c.isIdentifier(item.name) && item.name.text === name && item.initializer)
                        return expression(context, source, item.initializer, seen);
            if (
                !c.isImportDeclaration(statement) ||
                !c.isStringLiteral(statement.moduleSpecifier) ||
                statement.importClause?.isTypeOnly
            )
                continue;
            const clause = statement.importClause;
            if (clause?.name?.text === name)
                return exported(
                    context,
                    statement.moduleSpecifier.text,
                    source.fileName,
                    "default",
                    seen,
                );
            if (clause?.namedBindings && c.isNamedImports(clause.namedBindings))
                for (const item of clause.namedBindings.elements)
                    if (!item.isTypeOnly && item.name.text === name)
                        return exported(
                            context,
                            statement.moduleSpecifier.text,
                            source.fileName,
                            (item.propertyName ?? item.name).text,
                            seen,
                        );
        }
        return false;
    }
    async function expression(
        context: BuildContext,
        source: ts.SourceFile,
        node: ts.Expression,
        seen: Set<string>,
    ): Promise<boolean> {
        const c = getCompiler();
        if (c.isIdentifier(node)) return identifier(context, source, node.text, seen);
        if (c.isPropertyAccessExpression(node) && c.isIdentifier(node.expression)) {
            for (const statement of source.statements) {
                if (
                    !c.isImportDeclaration(statement) ||
                    !c.isStringLiteral(statement.moduleSpecifier)
                )
                    continue;
                const binding = statement.importClause?.namedBindings;
                if (
                    binding &&
                    c.isNamespaceImport(binding) &&
                    binding.name.text === node.expression.text
                )
                    return exported(
                        context,
                        statement.moduleSpecifier.text,
                        source.fileName,
                        node.name.text,
                        seen,
                    );
            }
        }
        if (c.isClassExpression(node)) return serverClass(context, source, node, seen);
        if (c.isCallExpression(node)) {
            if (await expression(context, source, node.expression, new Set(seen))) return true;
            for (const argument of node.arguments)
                if (await expression(context, source, argument, new Set(seen))) return true;
        }
        return false;
    }
    async function serverClass(
        context: BuildContext,
        source: ts.SourceFile,
        node: ts.ClassLikeDeclaration,
        seen: Set<string>,
    ): Promise<boolean> {
        const base = node.heritageClauses?.find(
            (clause) => clause.token === getCompiler().SyntaxKind.ExtendsKeyword,
        )?.types[0];
        return !!base && expression(context, source, base.expression, seen);
    }

    async function protectDependencies(
        context: BuildContext,
        file: string,
        seen = new Set<string>(),
    ) {
        if (seen.has(file)) return;
        seen.add(file);
        const source = read(file);
        if (!source) return;
        const c = getCompiler();
        const specifiers = new Set<string>();
        const visit = (node: ts.Node) => {
            if (
                c.isImportDeclaration(node) &&
                !node.importClause?.isTypeOnly &&
                c.isStringLiteral(node.moduleSpecifier)
            ) {
                const bindings = node.importClause?.namedBindings;
                if (
                    !(
                        bindings &&
                        c.isNamedImports(bindings) &&
                        !node.importClause?.name &&
                        bindings.elements.every((item) => item.isTypeOnly)
                    )
                )
                    specifiers.add(node.moduleSpecifier.text);
            } else if (
                c.isExportDeclaration(node) &&
                !node.isTypeOnly &&
                node.moduleSpecifier &&
                c.isStringLiteral(node.moduleSpecifier)
            ) {
                specifiers.add(node.moduleSpecifier.text);
            } else if (
                c.isCallExpression(node) &&
                (node.expression.kind === c.SyntaxKind.ImportKeyword ||
                    (c.isIdentifier(node.expression) && node.expression.text === "require"))
            ) {
                if (node.arguments[0] && c.isStringLiteral(node.arguments[0]))
                    specifiers.add(node.arguments[0].text);
            }
            c.forEachChild(node, visit);
        };
        visit(source);
        for (const specifier of specifiers) {
            if (specifier.startsWith("@finesoft/") || specifier.startsWith("node:")) continue;
            const resolved = await context.resolve(specifier, file, { skipSelf: true });
            const dependency = resolved?.id.split("?")[0];
            if (
                !dependency ||
                !path.isAbsolute(dependency) ||
                dependency.includes("/node_modules/")
            )
                continue;
            privateFiles.add(dependency);
            context.addWatchFile(dependency);
            await protectDependencies(context, dependency, seen);
        }
    }
    async function index(context: BuildContext) {
        if (indexing) await indexing;
        if (!initialized) {
            initialized = true;
            const walk = (directory: string) => {
                for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                    if (
                        entry.name.startsWith(".") ||
                        ["node_modules", "dist", "reports"].includes(entry.name)
                    )
                        continue;
                    const file = path.join(directory, entry.name);
                    if (entry.isDirectory()) walk(file);
                    else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(file)) pending.add(file);
                }
            };
            walk(getRoot());
        }
        if (!pending.size) return;
        indexing = (async () => {
            const c = getCompiler();
            for (const file of pending) {
                pending.delete(file);
                const source = read(file);
                if (!source) continue;
                if (
                    privateFiles.has(file) ||
                    (
                        await Promise.all(
                            source.statements
                                .filter(c.isClassDeclaration)
                                .map((node) => serverClass(context, source, node, new Set())),
                        )
                    ).some(Boolean)
                )
                    await protectDependencies(context, file);
            }
        })();
        try {
            await indexing;
        } finally {
            indexing = undefined;
        }
    }
    return {
        async start(context: BuildContext) {
            if (context.environment?.config?.consumer !== "server") await index(context);
        },
        async load(context: BuildContext, id: string, ssr?: boolean) {
            if (ssr || context.environment?.config?.consumer === "server") return null;
            const file = id.split("?")[0]!;
            if (!path.isAbsolute(file) || file.includes("\0")) return null;
            await index(context);
            const source = read(file);
            if (!source) {
                if (privateFiles.has(file))
                    throw Error(
                        `Server controller dependency cannot be loaded by the browser: ${file}`,
                    );
                return null;
            }
            const c = getCompiler();
            const names = new Map<string, string>();
            for (const statement of source.statements) {
                if (
                    c.isClassDeclaration(statement) &&
                    (await serverClass(context, source, statement, new Set()))
                ) {
                    const name = statement.name?.text ?? "__ServerController";
                    names.set(name, name);
                }
            }
            if (!names.size) {
                if (privateFiles.has(file))
                    throw Error(
                        `Server controller dependency cannot be loaded by the browser: ${file}`,
                    );
                return null;
            }
            await protectDependencies(context, file);
            if (
                [...new URLSearchParams(id.split("?")[1]).keys()].some(
                    (key) => !["t", "v", "import"].includes(key),
                )
            )
                throw Error(`Server controller source cannot be loaded as an asset: ${file}`);
            const exports: string[] = [];
            for (const statement of source.statements) {
                if (c.isInterfaceDeclaration(statement) || c.isTypeAliasDeclaration(statement))
                    continue;
                if (c.isClassDeclaration(statement) && has(statement, c.SyntaxKind.ExportKeyword)) {
                    const name = statement.name?.text ?? "__ServerController";
                    if (!names.has(name))
                        throw Error(
                            `Server controller modules cannot export shared implementations: ${file}`,
                        );
                    exports.push(
                        has(statement, c.SyntaxKind.DefaultKeyword)
                            ? `export default ${name};`
                            : `export { ${name} };`,
                    );
                } else if (c.isExportDeclaration(statement) && !statement.isTypeOnly) {
                    if (
                        statement.moduleSpecifier ||
                        !statement.exportClause ||
                        !c.isNamedExports(statement.exportClause)
                    )
                        throw Error(
                            `Move re-exports out of the server controller implementation module: ${file}`,
                        );
                    for (const item of statement.exportClause.elements) {
                        if (item.isTypeOnly) continue;
                        const name = (item.propertyName ?? item.name).text;
                        if (!names.has(name))
                            throw Error(
                                `Server controller modules can only export controllers and types: ${file}`,
                            );
                        exports.push(`export { ${name} as ${item.name.text} };`);
                    }
                } else if (c.isExportAssignment(statement)) {
                    if (
                        !c.isIdentifier(statement.expression) ||
                        !names.has(statement.expression.text)
                    )
                        throw Error(`Invalid server controller default export: ${file}`);
                    exports.push(`export default ${statement.expression.text};`);
                } else if (has(statement, c.SyntaxKind.ExportKeyword))
                    throw Error(
                        `Server controller modules can only export controllers and types: ${file}`,
                    );
            }
            return {
                code: `import { ServerControllerProxy as __Proxy } from "@finesoft/front";\n${[...names].map(([name]) => `class ${name} extends __Proxy {}`).join("\n")}\n${exports.join("\n")}`,
                map: { version: 3, sources: [], names: [], mappings: "", sourcesContent: [] },
            };
        },
        guard(id: string, ssr?: boolean, context?: BuildContext) {
            if (
                !ssr &&
                context?.environment?.config?.consumer !== "server" &&
                serverEntries.has(id)
            )
                throw Error(
                    "The SSR entry is server-only. Import BaseServerController only in a controller implementation module; the Vite plugin generates its browser reference.",
                );
        },
        invalidate(file: string) {
            sources.delete(file);
            pending.add(file);
        },
    };
}
