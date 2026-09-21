export function loadImplementation(name: string): never {
    throw Error(
        `[finesoft] ${name} requires its platform host. Use the finesoft Vite plugin for native UI bindings.`,
    );
}
