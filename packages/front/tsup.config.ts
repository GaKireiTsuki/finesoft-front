import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/browser.ts"],
	format: ["esm", "cjs"],
	dts: {
		resolve: [
			"@finesoft/core",
			"@finesoft/browser",
			"@finesoft/ssr",
			"@finesoft/server",
		],
		compilerOptions: {
			paths: {
				"@finesoft/core": ["../core/src/index.ts"],
				"@finesoft/browser": ["../browser/src/index.ts"],
				"@finesoft/ssr": ["../ssr/src/index.ts"],
				"@finesoft/server": ["../server/src/index.ts"],
			},
		},
	},
	sourcemap: true,
	clean: true,
	external: [
		"hono",
		"@hono/node-server",
		"vite",
		"dotenv",
		"node:fs",
		"node:path",
		"node:url",
		"node:http",
	],
	noExternal: [
		"@finesoft/core",
		"@finesoft/browser",
		"@finesoft/ssr",
		"@finesoft/server",
	],
});
