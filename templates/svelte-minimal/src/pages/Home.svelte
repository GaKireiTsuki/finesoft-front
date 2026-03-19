<script lang="ts">
	import type { BasePage } from "@finesoft/front";
	import { getFramework } from "../lib/framework-svelte";

	let { page }: { page: BasePage } = $props();

	const framework = getFramework();
	const locale = framework?.getLocale()?.lang ?? "unknown";
	const translator = framework?.getTranslator();
	const localeLabel = translator?.t("home.localeLabel") ?? "Current locale";
	const runtimeBadge =
		translator?.t("home.runtimeBadge") ??
		"Hydration kept the translator alive on the client.";
	const switchHint =
		translator?.t("home.switchHint") ??
		'Change frameworkConfig.locale in src/bootstrap.ts to load another JSON file.';
</script>

<div>
	<h1>{page.title}</h1>
	<p>{page.description}</p>
	<p><strong>{localeLabel}:</strong> {locale}</p>
	<p>{runtimeBadge}</p>
	<p>{switchHint}</p>
</div>
