import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const defaultRoot = resolve(import.meta.dirname, "../../src");
const platformGlobals = new Set([
    "window",
    "document",
    "navigator",
    "localStorage",
    "IntersectionObserver",
    "Element",
    "BasePage",
]);

/** Scan imports and reexports, including constant/variable dynamic import specifiers. */
export function findForbiddenCoreDependencies(root = defaultRoot): string[] {
    const failures = new Set<string>();
    function visitDirectory(dir: string): void {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const file = resolve(dir, entry.name);
            if (entry.isDirectory()) {
                visitDirectory(file);
                continue;
            }
            if (!file.endsWith(".ts")) continue;
            const source = ts.createSourceFile(
                file,
                readFileSync(file, "utf8"),
                ts.ScriptTarget.Latest,
                true,
            );
            const constants = new Map<string, string>();
            const name = relative(root, file);
            function collect(node: ts.Node): void {
                if (
                    ts.isVariableDeclaration(node) &&
                    ts.isIdentifier(node.name) &&
                    node.initializer &&
                    ts.isStringLiteralLike(node.initializer)
                )
                    constants.set(node.name.text, node.initializer.text);
                ts.forEachChild(node, collect);
            }
            collect(source);
            function check(specifier: string): void {
                if (
                    specifier.startsWith("node:") ||
                    builtinModules.includes(specifier) ||
                    /^@finesoft\/(front|web|browser|ssr|server)(\/|$)/.test(specifier) ||
                    /^(hono|vite|vite-plus|react|vue|svelte)(\/|$)/.test(specifier)
                )
                    failures.add(`${name}: ${specifier}`);
                if (
                    specifier.startsWith(".") &&
                    !resolve(dirname(file), specifier).startsWith(root + "/")
                )
                    failures.add(`${name}: ${specifier}`);
            }
            function visit(node: ts.Node): void {
                if (
                    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
                    node.moduleSpecifier &&
                    ts.isStringLiteralLike(node.moduleSpecifier)
                )
                    check(node.moduleSpecifier.text);
                if (
                    ts.isCallExpression(node) &&
                    node.expression.kind === ts.SyntaxKind.ImportKeyword
                ) {
                    const argument = node.arguments[0];
                    const specifier =
                        argument &&
                        (ts.isStringLiteralLike(argument)
                            ? argument.text
                            : ts.isIdentifier(argument)
                              ? constants.get(argument.text)
                              : undefined);
                    if (specifier) check(specifier);
                    else failures.add(`${name}: unresolved dynamic import`);
                }
                if (ts.isIdentifier(node) && platformGlobals.has(node.text))
                    failures.add(`${name}: ${node.text}`);
                ts.forEachChild(node, visit);
            }
            visit(source);
        }
    }
    visitDirectory(root);
    return [...failures].sort();
}
