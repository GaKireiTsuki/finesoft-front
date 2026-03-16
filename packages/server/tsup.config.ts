import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: false,
	sourcemap: true,
	clean: true,
	external: [
		"@finesoft/ssr",
		"hono",
		"@hono/node-server",
		"vite",
		"dotenv",
		"../dist/server/ssr.js",
	],
});
