#!/usr/bin/env node
import { createServer } from "node:http";

const PORT = Number(process.env.METADATA_PORT ?? 9999);
const HOST = process.env.METADATA_HOST ?? "127.0.0.1";

const FLAG = "FLAG{ssrf-9f3a1c2d}";

const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 200;
    res.end(
        JSON.stringify({
            service: "internal-metadata",
            note: "Simulates a cloud provider instance-metadata endpoint.",
            credentials: {
                accessKeyId: "AKIA-FAKE-EXAMPLE",
                secretAccessKey: FLAG,
            },
            path: req.url,
        }),
    );
});

server.listen(PORT, HOST, () => {
    console.log(`[metadata-server] listening on http://${HOST}:${PORT}`);
});
