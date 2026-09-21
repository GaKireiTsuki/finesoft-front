import { createRequire } from "node:module";
import path from "node:path";
import MagicString from "magic-string";
import type ts from "typescript";

const PREFIX = "virtual:finesoft-front/native/";
const renderers = new Set(["react", "vue", "svelte"]);
const selectors = new Set(["Outlet", "useSnapshot"]);

interface ScriptBlock {
    start: number;
    end: number;
    tsx?: boolean;
}
function scriptBlocks(code: string, id: string, require: NodeJS.Require): ScriptBlock[] {
    const file = id.split("?")[0]!;
    if (file.endsWith(".vue") && code.includes("<script")) {
        interface VueScript {
            lang?: string;
            loc: { start: { offset: number }; end: { offset: number } };
        }
        const parsed = require("vue/compiler-sfc").parse(code, { filename: id }) as {
            descriptor: { script?: VueScript; scriptSetup?: VueScript };
            errors: unknown[];
        };
        if (parsed.errors.length) throw parsed.errors[0];
        return [parsed.descriptor.script, parsed.descriptor.scriptSetup]
            .filter((block): block is VueScript => !!block)
            .map((block) => ({
                start: block.loc.start.offset,
                end: block.loc.end.offset,
                tsx: block.lang === "tsx",
            }));
    }
    if (file.endsWith(".svelte") && code.includes("<script")) {
        const parsed = require("svelte/compiler").parse(code, { filename: id, modern: true }) as {
            instance?: { content: ScriptBlock };
            module?: { content: ScriptBlock };
        };
        return [parsed.module?.content, parsed.instance?.content].filter(
            (block): block is ScriptBlock => !!block,
        );
    }
    return [{ start: 0, end: code.length, tsx: /\.[jt]sx(?:\?|$)/.test(id) }];
}

/** Compile literal renderer selections to native imports, without a runtime registry. */
export function nativeBindings(getRoot: () => string) {
    let compiler: typeof ts | undefined;
    return {
        resolve(id: string, importer?: string) {
            if (!id.startsWith(PREFIX)) return null;
            const renderer = id.slice(PREFIX.length);
            if (!renderers.has(renderer)) throw Error(`Unknown native renderer: ${renderer}`);
            // Resolve the installed package, not Vite's optimized root facade in .vite/deps.
            const from =
                importer && path.isAbsolute(importer)
                    ? importer.split("?")[0]!
                    : path.join(getRoot(), "package.json");
            const front = createRequire(from).resolve("@finesoft/front");
            return path.join(path.dirname(front), `${renderer}.mjs`);
        },
        transform(code: string, id: string) {
            if (!code.includes("@finesoft/front") || !/Outlet|useSnapshot/.test(code)) return null;
            const require = createRequire(path.join(getRoot(), "package.json"));
            const c: typeof ts = (compiler ??= require("typescript"));
            const output = new MagicString(code);
            let changed = false;
            const compile = (code: string, offset: number, tsx?: boolean) => {
                const fileName = `${id}.${offset}.${tsx ? "tsx" : "ts"}`;
                const source = c.createSourceFile(
                    fileName,
                    code,
                    c.ScriptTarget.Latest,
                    true,
                    tsx ? c.ScriptKind.TSX : c.ScriptKind.TS,
                );
                // Bind only this script to distinguish imported selectors from local shadows.
                // No dependency resolution or type checking runs on this hot path.
                const program = c.createProgram(
                    [fileName],
                    { noResolve: true, noLib: true, allowJs: true },
                    {
                        getSourceFile: (name) => (name === fileName ? source : undefined),
                        getDefaultLibFileName: () => "",
                        writeFile() {},
                        getCurrentDirectory: getRoot,
                        getDirectories: () => [],
                        fileExists: (name) => name === fileName,
                        readFile: (name) => (name === fileName ? code : undefined),
                        getCanonicalFileName: (name) => name,
                        useCaseSensitiveFileNames: () => true,
                        getNewLine: () => "\n",
                    },
                );
                const checker = program.getTypeChecker();
                const named = new Map<ts.Symbol, string>();
                const namespaces = new Set<ts.Symbol>();
                const imports: ts.ImportDeclaration[] = [];
                for (const statement of source.statements) {
                    if (
                        !c.isImportDeclaration(statement) ||
                        statement.importClause?.isTypeOnly ||
                        !c.isStringLiteral(statement.moduleSpecifier) ||
                        statement.moduleSpecifier.text !== "@finesoft/front"
                    )
                        continue;
                    const bindings = statement.importClause?.namedBindings;
                    if (!bindings) continue;
                    if (c.isNamespaceImport(bindings)) {
                        const symbol = checker.getSymbolAtLocation(bindings.name);
                        if (symbol) namespaces.add(symbol);
                    } else {
                        for (const item of bindings.elements) {
                            if (item.isTypeOnly) continue;
                            const name = (item.propertyName ?? item.name).text;
                            const symbol = checker.getSymbolAtLocation(item.name);
                            if (selectors.has(name) && symbol) named.set(symbol, name);
                        }
                        imports.push(statement);
                    }
                }
                if (!named.size && !namespaces.size) return null;
                const nativeImports = new Map<string, string>();
                const bindingFor = (node: ts.Node): string | undefined => {
                    if (c.isIdentifier(node)) {
                        const symbol = checker.getSymbolAtLocation(node);
                        if (symbol) return named.get(symbol);
                    }
                    if (c.isPropertyAccessExpression(node) && c.isIdentifier(node.expression)) {
                        const symbol = checker.getSymbolAtLocation(node.expression);
                        if (symbol && namespaces.has(symbol) && selectors.has(node.name.text))
                            return node.name.text;
                    }
                };
                const visit = (node: ts.Node) => {
                    if (c.isImportDeclaration(node) || c.isTypeNode(node)) return;
                    const binding = bindingFor(node);
                    if (binding) {
                        const call = node.parent;
                        if (!c.isCallExpression(call) || call.expression !== node)
                            throw Error(
                                `[finesoft] Call ${binding} directly with a literal renderer name (${id}).`,
                            );
                        const renderer = call.arguments[0];
                        if (
                            !renderer ||
                            !c.isStringLiteral(renderer) ||
                            !renderers.has(renderer.text) ||
                            call.arguments.length !== (binding === "Outlet" ? 1 : 2)
                        )
                            throw Error(
                                `[finesoft] Use ${binding}("react" | "vue" | "svelte"${binding === "useSnapshot" ? ", app" : ""}) (${id}).`,
                            );
                        const key = `${renderer.text}/${binding}`;
                        let local = nativeImports.get(key);
                        if (!local) {
                            local =
                                binding === "useSnapshot"
                                    ? `useFinesoftSnapshot${offset}_${nativeImports.size}`
                                    : `__finesoft_native_${offset}_${nativeImports.size}`;
                            while (code.includes(local)) local += "_";
                            nativeImports.set(key, local);
                        }
                        if (binding === "Outlet")
                            output.overwrite(
                                offset + call.getStart(source),
                                offset + call.end,
                                local,
                            );
                        else {
                            output.overwrite(
                                offset + node.getStart(source),
                                offset + node.end,
                                local,
                            );
                            output.remove(
                                offset + renderer.getStart(source),
                                offset + call.arguments[1]!.getStart(source),
                            );
                        }
                        return;
                    }
                    c.forEachChild(node, visit);
                };
                visit(source);
                if (!nativeImports.size) return null;
                for (const declaration of imports) {
                    const clause = declaration.importClause!;
                    const bindings = clause.namedBindings as ts.NamedImports;
                    const retained = bindings.elements.filter(
                        (item) =>
                            item.isTypeOnly ||
                            !selectors.has((item.propertyName ?? item.name).text),
                    );
                    const names = retained.map((item) => item.getText(source)).join(", ");
                    const parts = [clause.name?.text, names && `{ ${names} }`].filter(Boolean);
                    output.overwrite(
                        offset + declaration.getStart(source),
                        offset + declaration.end,
                        parts.length ? `import ${parts.join(", ")} from "@finesoft/front";` : "",
                    );
                }
                output.appendLeft(
                    offset,
                    [...nativeImports]
                        .map(([key, local]) => {
                            const [renderer, binding] = key.split("/");
                            return `import { ${binding} as ${local} } from "${PREFIX}${renderer}";\n`;
                        })
                        .join(""),
                );
                changed = true;
            };
            for (const block of scriptBlocks(code, id, require))
                compile(code.slice(block.start, block.end), block.start, block.tsx);
            return changed
                ? {
                      code: output.toString(),
                      map: output.generateMap({ hires: true, source: id, includeContent: true }),
                  }
                : null;
        },
    };
}
