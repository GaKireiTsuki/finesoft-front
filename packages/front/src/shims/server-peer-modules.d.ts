declare module "hono" {
    export class Hono {
        constructor(...args: any[]);
        get(path: string, handler: (c: any) => any): this;
        use(...args: any[]): this;
        route(...args: any[]): this;
        fetch: any;
    }
}

declare module "vite" {
    export interface ViteDevServer {
        transformIndexHtml(url: string, html: string): string | Promise<string>;
        ssrLoadModule(path: string): Promise<unknown>;
        ssrFixStacktrace(error: Error): void;
        middlewares(req: any, res: any, next: () => void): void;
    }

    export function createServer(options?: any): Promise<ViteDevServer>;
}

declare module "dotenv" {
    export interface DotenvConfigOptions {
        path?: string;
        [key: string]: unknown;
    }

    export interface DotenvConfigOutput {
        parsed?: Record<string, string>;
        error?: Error;
    }

    export function config(options?: DotenvConfigOptions): DotenvConfigOutput;
}

declare module "@hono/node-server" {
    export function getRequestListener(fetchHandler: any): (req: any, res: any) => any;

    export function serve(options: { fetch: any; port?: number }, onListen?: () => void): unknown;
}

declare module "@hono/node-server/serve-static" {
    export function serveStatic(options?: any): any;
}
