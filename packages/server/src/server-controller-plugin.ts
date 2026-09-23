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

    function unwrap(node: ts.Expression): ts.Expression {
        const c = getCompiler();
        while (
            c.isParenthesizedExpression(node) ||
            c.isAsExpression(node) ||
            c.isTypeAssertionExpression(node) ||
            c.isNonNullExpression(node) ||
            c.isSatisfiesExpression(node)
        )
            node = node.expression;
        return node;
    }

    function propertyName(node: ts.PropertyName): string | undefined {
        const c = getCompiler();
        if (c.isIdentifier(node) || c.isStringLiteralLike(node) || c.isNumericLiteral(node))
            return node.text;
        return c.isComputedPropertyName(node) && c.isStringLiteralLike(unwrap(node.expression))
            ? (unwrap(node.expression) as ts.StringLiteral).text
            : undefined;
    }

    function bindingPath(node: ts.BindingName, name: string): string[] | undefined {
        const c = getCompiler();
        if (c.isIdentifier(node)) return node.text === name ? [] : undefined;
        for (let index = 0; index < node.elements.length; index++) {
            const item = node.elements[index];
            if (!c.isBindingElement(item) || item.dotDotDotToken) continue;
            const nested = bindingPath(item.name, name);
            const member = c.isArrayBindingPattern(node)
                ? String(index)
                : item.propertyName
                  ? propertyName(item.propertyName)
                  : c.isIdentifier(item.name)
                    ? item.name.text
                    : undefined;
            if (nested && member !== undefined) return [member, ...nested];
        }
        return undefined;
    }

    async function exportedMember(
        context: BuildContext,
        specifier: string,
        importer: string,
        name: string,
        members: string[],
        seen: Set<string>,
        baseOnly: boolean,
    ): Promise<boolean> {
        if (!members.length) return exported(context, specifier, importer, name, seen, baseOnly);
        if (specifier.startsWith("@finesoft/")) return false;
        const resolved = await context.resolve(specifier, importer, { skipSelf: true });
        const file = resolved?.id.split("?")[0];
        if (!file) return false;
        const key = `${file}:export-member:${JSON.stringify([name, ...members])}`;
        if (seen.has(key)) return false;
        seen.add(key);
        const source = read(file);
        if (!source) return false;
        context.addWatchFile(file);
        const c = getCompiler();
        for (const statement of source.statements) {
            if (c.isExportDeclaration(statement) && !statement.isTypeOnly) {
                const module =
                    statement.moduleSpecifier && c.isStringLiteral(statement.moduleSpecifier)
                        ? statement.moduleSpecifier.text
                        : undefined;
                const clause = statement.exportClause;
                if (module && clause && c.isNamespaceExport(clause) && clause.name.text === name)
                    return exportedMember(
                        context,
                        module,
                        file,
                        members[0],
                        members.slice(1),
                        seen,
                        baseOnly,
                    );
                if (
                    module &&
                    !clause &&
                    (await exportedMember(
                        context,
                        module,
                        file,
                        name,
                        members,
                        new Set(seen),
                        baseOnly,
                    ))
                )
                    return true;
                if (clause && c.isNamedExports(clause))
                    for (const item of clause.elements) {
                        if (item.isTypeOnly || item.name.text !== name) continue;
                        const local = item.propertyName ?? item.name;
                        return module
                            ? exportedMember(
                                  context,
                                  module,
                                  file,
                                  local.text,
                                  members,
                                  seen,
                                  baseOnly,
                              )
                            : memberExpression(context, source, local, members, seen, baseOnly);
                    }
            }
            if (c.isVariableStatement(statement) && has(statement, c.SyntaxKind.ExportKeyword))
                for (const item of statement.declarationList.declarations)
                    if (c.isIdentifier(item.name) && item.name.text === name && item.initializer)
                        return memberExpression(
                            context,
                            source,
                            item.initializer,
                            members,
                            seen,
                            baseOnly,
                        );
            if (name === "default" && c.isExportAssignment(statement))
                return memberExpression(
                    context,
                    source,
                    statement.expression,
                    members,
                    seen,
                    baseOnly,
                );
        }
        return false;
    }

    async function memberExpression(
        context: BuildContext,
        source: ts.SourceFile,
        node: ts.Expression,
        members: string[],
        seen: Set<string>,
        baseOnly: boolean,
    ): Promise<boolean> {
        if (!members.length) return expression(context, source, node, seen, baseOnly);
        node = unwrap(node);
        const key = `${source.fileName}:member:${node.pos}:${node.end}:${JSON.stringify(members)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        const c = getCompiler();
        if (c.isPropertyAccessExpression(node))
            return memberExpression(
                context,
                source,
                node.expression,
                [node.name.text, ...members],
                seen,
                baseOnly,
            );
        if (c.isElementAccessExpression(node) && c.isStringLiteralLike(node.argumentExpression))
            return memberExpression(
                context,
                source,
                node.expression,
                [node.argumentExpression.text, ...members],
                seen,
                baseOnly,
            );
        if (c.isObjectLiteralExpression(node))
            for (const item of [...node.properties].reverse()) {
                if (c.isSpreadAssignment(item)) {
                    if (
                        await memberExpression(
                            context,
                            source,
                            item.expression,
                            members,
                            new Set(seen),
                            baseOnly,
                        )
                    )
                        return true;
                    continue;
                }
                if (propertyName(item.name) !== members[0]) continue;
                if (c.isPropertyAssignment(item))
                    return memberExpression(
                        context,
                        source,
                        item.initializer,
                        members.slice(1),
                        seen,
                        baseOnly,
                    );
                if (c.isShorthandPropertyAssignment(item))
                    return memberExpression(
                        context,
                        source,
                        item.name,
                        members.slice(1),
                        seen,
                        baseOnly,
                    );
            }
        if (c.isArrayLiteralExpression(node)) {
            const item = node.elements[Number(members[0])];
            return (
                !!item && memberExpression(context, source, item, members.slice(1), seen, baseOnly)
            );
        }
        if (!c.isIdentifier(node)) return false;
        for (const statement of source.statements) {
            if (c.isVariableStatement(statement))
                for (const item of statement.declarationList.declarations) {
                    const prefix = bindingPath(item.name, node.text);
                    if (prefix && item.initializer)
                        return memberExpression(
                            context,
                            source,
                            item.initializer,
                            [...prefix, ...members],
                            seen,
                            baseOnly,
                        );
                }
            if (
                !c.isImportDeclaration(statement) ||
                !c.isStringLiteral(statement.moduleSpecifier) ||
                statement.importClause?.isTypeOnly
            )
                continue;
            const clause = statement.importClause;
            const binding = clause?.namedBindings;
            const specifier = statement.moduleSpecifier.text;
            if (binding && c.isNamespaceImport(binding) && binding.name.text === node.text)
                return exportedMember(
                    context,
                    specifier,
                    source.fileName,
                    members[0],
                    members.slice(1),
                    seen,
                    baseOnly,
                );
            if (clause?.name?.text === node.text)
                return exportedMember(
                    context,
                    specifier,
                    source.fileName,
                    "default",
                    members,
                    seen,
                    baseOnly,
                );
            if (binding && c.isNamedImports(binding))
                for (const item of binding.elements)
                    if (!item.isTypeOnly && item.name.text === node.text)
                        return exportedMember(
                            context,
                            specifier,
                            source.fileName,
                            (item.propertyName ?? item.name).text,
                            members,
                            seen,
                            baseOnly,
                        );
        }
        return false;
    }

    async function exported(
        context: BuildContext,
        specifier: string,
        importer: string,
        name: string,
        seen: Set<string>,
        baseOnly = false,
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
                if (target === name)
                    return !baseOnly && serverClass(context, source, statement, seen);
            }
            if (c.isVariableStatement(statement) && has(statement, c.SyntaxKind.ExportKeyword)) {
                for (const item of statement.declarationList.declarations)
                    if (c.isIdentifier(item.name) && item.name.text === name && item.initializer)
                        return expression(context, source, item.initializer, seen, baseOnly);
            }
            if (c.isExportDeclaration(statement) && !statement.isTypeOnly) {
                const module =
                    statement.moduleSpecifier && c.isStringLiteral(statement.moduleSpecifier)
                        ? statement.moduleSpecifier.text
                        : undefined;
                if (
                    !statement.exportClause &&
                    module &&
                    (await exported(context, module, file, name, new Set(seen), baseOnly))
                )
                    return true;
                if (statement.exportClause && c.isNamedExports(statement.exportClause)) {
                    for (const item of statement.exportClause.elements) {
                        if (item.isTypeOnly || item.name.text !== name) continue;
                        const local = (item.propertyName ?? item.name).text;
                        return module
                            ? exported(context, module, file, local, seen, baseOnly)
                            : identifier(context, source, local, seen, baseOnly);
                    }
                }
            }
            if (name === "default" && c.isExportAssignment(statement))
                return expression(context, source, statement.expression, seen, baseOnly);
        }
        return false;
    }
    async function identifier(
        context: BuildContext,
        source: ts.SourceFile,
        name: string,
        seen: Set<string>,
        baseOnly = false,
    ): Promise<boolean> {
        const key = `${source.fileName}:local:${name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        const c = getCompiler();
        for (const statement of source.statements) {
            if (c.isClassDeclaration(statement) && statement.name?.text === name)
                return !baseOnly && serverClass(context, source, statement, seen);
            if (c.isVariableStatement(statement))
                for (const item of statement.declarationList.declarations) {
                    const members = bindingPath(item.name, name);
                    if (members && item.initializer)
                        return memberExpression(
                            context,
                            source,
                            item.initializer,
                            members,
                            seen,
                            baseOnly,
                        );
                }
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
                    baseOnly,
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
                            baseOnly,
                        );
        }
        return false;
    }
    async function expression(
        context: BuildContext,
        source: ts.SourceFile,
        node: ts.Expression,
        seen: Set<string>,
        baseOnly = false,
    ): Promise<boolean> {
        const c = getCompiler();
        node = unwrap(node);
        if (c.isIdentifier(node)) return identifier(context, source, node.text, seen, baseOnly);
        const member = c.isPropertyAccessExpression(node)
            ? node.name.text
            : c.isElementAccessExpression(node) && c.isStringLiteralLike(node.argumentExpression)
              ? node.argumentExpression.text
              : undefined;
        if (member && (c.isPropertyAccessExpression(node) || c.isElementAccessExpression(node))) {
            return memberExpression(context, source, node.expression, [member], seen, baseOnly);
        }
        // Unknown computed members of a namespace carrying the raw base must not
        // quietly return the original implementation to the browser.
        if (baseOnly && c.isElementAccessExpression(node) && !member)
            return memberExpression(
                context,
                source,
                node.expression,
                ["BaseServerController"],
                seen,
                true,
            );
        if (c.isClassExpression(node)) return !baseOnly && serverClass(context, source, node, seen);
        if (c.isCallExpression(node)) {
            if (!baseOnly && (await expression(context, source, node.expression, new Set(seen))))
                return true;
            for (const argument of node.arguments)
                if (
                    (await expression(context, source, argument, new Set(seen), baseOnly)) ||
                    (baseOnly &&
                        (await memberExpression(
                            context,
                            source,
                            argument,
                            ["BaseServerController"],
                            new Set(seen),
                            true,
                        )))
                )
                    return true;
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

    /** One classification drives cold dependency indexing and every browser load form. */
    async function classify(context: BuildContext, source: ts.SourceFile) {
        const c = getCompiler();
        const classes: ts.ClassLikeDeclaration[] = [];
        const uses: ts.Expression[] = [];
        const visit = (node: ts.Node) => {
            if (c.isImportDeclaration(node) || c.isExportDeclaration(node) || c.isTypeNode(node))
                return;
            if (c.isClassDeclaration(node) || c.isClassExpression(node)) classes.push(node);
            if (
                c.isIdentifier(node) ||
                c.isPropertyAccessExpression(node) ||
                c.isElementAccessExpression(node) ||
                c.isCallExpression(node)
            )
                uses.push(node);
            c.forEachChild(node, visit);
        };
        visit(source);
        const owned = new Set<ts.ClassLikeDeclaration>();
        for (const node of classes)
            if (await serverClass(context, source, node, new Set())) owned.add(node);
        const names = new Map<string, string>();
        const defaultNames = new Map<ts.ExportAssignment, string>();
        const reserved = new Set(uses.filter(c.isIdentifier).map((node) => node.text));
        const generatedName = (prefix: string) => {
            let name = prefix;
            while (reserved.has(name)) name += "_";
            reserved.add(name);
            return name;
        };
        for (const statement of source.statements) {
            if (c.isClassDeclaration(statement) && owned.has(statement)) {
                const name = statement.name?.text ?? "__ServerController";
                names.set(name, name);
            }
            if (c.isVariableStatement(statement))
                for (const item of statement.declarationList.declarations)
                    if (
                        c.isIdentifier(item.name) &&
                        item.initializer &&
                        owned.has(unwrap(item.initializer) as ts.ClassExpression)
                    )
                        names.set(item.name.text, item.name.text);
            if (
                c.isExportAssignment(statement) &&
                owned.has(unwrap(statement.expression) as ts.ClassExpression)
            ) {
                const name = generatedName("__ServerControllerDefault");
                defaultNames.set(statement, name);
                names.set(name, name);
            }
        }
        // Keep local aliases of a rewritten class identical to the original class reference.
        let changed = true;
        while (changed) {
            changed = false;
            for (const statement of source.statements) {
                if (!c.isVariableStatement(statement)) continue;
                for (const item of statement.declarationList.declarations) {
                    if (
                        !c.isIdentifier(item.name) ||
                        !item.initializer ||
                        names.has(item.name.text)
                    )
                        continue;
                    const value = unwrap(item.initializer);
                    if (c.isIdentifier(value) && names.has(value.text)) {
                        names.set(item.name.text, names.get(value.text)!);
                        changed = true;
                    }
                }
            }
        }
        // Raw framework-base use in an unsupported factory must fail closed. Pure
        // imports/re-export barrels and consumers of already classified controllers remain shared.
        let server = owned.size > 0;
        if (!server) {
            const checked = new Set<string>();
            for (const use of uses) {
                const key = use.getText(source);
                if (checked.has(key)) continue;
                checked.add(key);
                if (await expression(context, source, use, new Set(), true)) {
                    server = true;
                    break;
                }
            }
        }
        return { server, names, defaultNames };
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
            for (const file of pending) {
                pending.delete(file);
                const source = read(file);
                if (!source) continue;
                if (privateFiles.has(file) || (await classify(context, source)).server)
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
            const { server, names, defaultNames } = await classify(context, source);
            if (!server) {
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
            if (!names.size)
                throw Error(
                    `Unsupported server controller syntax; use a module-scope class: ${file}`,
                );
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
                } else if (
                    c.isVariableStatement(statement) &&
                    has(statement, c.SyntaxKind.ExportKeyword)
                ) {
                    for (const item of statement.declarationList.declarations) {
                        if (!c.isIdentifier(item.name) || !names.has(item.name.text))
                            throw Error(
                                `Server controller modules can only export controllers and types: ${file}`,
                            );
                        exports.push(`export { ${item.name.text} };`);
                    }
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
                    const value = unwrap(statement.expression);
                    const name =
                        defaultNames.get(statement) ??
                        (c.isIdentifier(value) ? value.text : undefined);
                    if (!name || !names.has(name))
                        throw Error(`Invalid server controller default export: ${file}`);
                    exports.push(`export default ${name};`);
                } else if (has(statement, c.SyntaxKind.ExportKeyword))
                    throw Error(
                        `Server controller modules can only export controllers and types: ${file}`,
                    );
            }
            return {
                code: `import { ServerControllerProxy as __Proxy } from "@finesoft/front";\n${[...names].map(([name, original]) => (name === original ? `class ${name} extends __Proxy {}` : `const ${name} = ${original};`)).join("\n")}\n${exports.join("\n")}`,
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
