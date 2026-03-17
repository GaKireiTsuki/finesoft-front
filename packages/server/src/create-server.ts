/**
 * createServer — 一站式服务器工厂
 *
 * 封装 env 加载、运行时检测、Vite 创建、Hono app、SSR、启动。
 * 保留 setup() 钩子用于注册业务路由。
 */

import { Hono } from "hono";
import type { ViteDevServer } from "vite";
import { createSSRApp, type SSRAppOptions } from "./app";
import { dynamicImport } from "./dynamic-import";
import { registerProxyRoutes, type ProxyRouteConfig } from "./proxy";
import { detectRuntime, type RuntimeInfo } from "./runtime";
import { startServer } from "./start";

export interface ServerConfig {
    /** 项目根路径（默认 process.cwd()） */
    root?: string;
    /** 端口号（默认 3000） */
    port?: number;
    /** 注册自定义路由（在 SSR catch-all 之前调用，但在声明式代理之后） */
    setup?: (app: Hono) => void | Promise<void>;
    /** 声明式代理路由配置 */
    proxies?: ProxyRouteConfig[];
    /** SSR 相关选项（透传给 createSSRApp） */
    ssr?: Pick<SSRAppOptions, "ssrEntryPath" | "ssrProductionModule">;
}

export interface ServerInstance {
    app: Hono;
    vite?: ViteDevServer;
    runtime: RuntimeInfo;
}

/**
 * 创建并启动 SSR 服务器
 *
 * @example
 * ```ts
 * const { app } = await createServer({
 *   setup: (app) => registerProxies(app),
 * });
 * export { app };
 * ```
 */
export async function createServer(config: ServerConfig = {}): Promise<ServerInstance> {
    const {
        root: rootOverride,
        port = Number(process.env.PORT) || 3000,
        setup,
        proxies,
        ssr,
    } = config;

    // 1. 路径 + .env
    const root = rootOverride ?? process.cwd();
    const { existsSync } = await dynamicImport("node:fs");
    const path = await dynamicImport("node:path");
    const envPath = path.resolve(root, ".env");
    if (existsSync(envPath)) {
        try {
            const { config: dotenvConfig } = await dynamicImport("dotenv");
            dotenvConfig({ path: envPath });
        } catch (e) {
            console.warn(`[Server] Failed to load .env: ${(e as Error).message}`);
        }
    }

    // 2. 运行时检测
    const runtime = detectRuntime();

    // 3. Vite（仅开发模式）
    let vite: ViteDevServer | undefined;
    if (!runtime.isProduction && !runtime.isVercel) {
        const { createServer: createViteServer } = await dynamicImport("vite");
        vite = await createViteServer({
            root,
            server: { middlewareMode: true },
            appType: "custom",
        });
    }

    // 4. Hono app + 声明式代理 + 自定义路由
    const app = new Hono();
    if (proxies?.length) {
        registerProxyRoutes(app, proxies);
    }
    if (setup) {
        await setup(app);
    }

    // 5. SSR catch-all
    const ssrApp = createSSRApp({
        root,
        vite,
        isProduction: runtime.isProduction,
        parentFetch: app.fetch.bind(app),
        ...ssr,
    });
    app.route("/", ssrApp);

    // 6. 启动
    await startServer({
        app,
        root,
        port,
        isProduction: runtime.isProduction,
        vite,
        runtime,
        ssrEntryPath: ssr?.ssrEntryPath,
    });

    return { app, vite, runtime };
}
