#!/usr/bin/env node
import { createServer } from "node:http";

const PORT = Number(process.env.ADMIN_WELCOME_PORT ?? 5174);
const HOST = process.env.ADMIN_WELCOME_HOST ?? "127.0.0.1";

const FLAG = "FLAG{redir-1f8e2a4b}";

const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");

    if (url.pathname === "/admin/welcome-flag") {
        res.statusCode = 200;
        res.end(`Welcome, internal caller!\n\nToken: ${FLAG}\n`);
        return;
    }

    if (url.pathname === "/health") {
        res.statusCode = 200;
        res.end("ok");
        return;
    }

    res.statusCode = 404;
    res.end("not found");
});

server.listen(PORT, HOST, () => {
    console.log(`[admin-welcome] listening on http://${HOST}:${PORT}`);
});
