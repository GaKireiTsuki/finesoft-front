<script lang="ts">
	import type { Framework } from "@finesoft/front";
	import type { ErrorPage, Page } from "./lib/models/page";

	let {
		page = new Promise(() => {}) as Promise<Page> | Page,
		isFirstPage = true,
		locale = "en",
		framework = undefined as Framework | undefined,
	} = $props();

	let safePage = $derived(normalizePage(page));

	function normalizePage(value: Promise<Page> | Page): Promise<Page> | Page {
		if (!(value instanceof Promise)) return value;

		return value.catch(
			(err): ErrorPage => ({
				id: "page-error-runtime",
				pageType: "error",
				title: "Error",
				errorMessage:
					err instanceof Error ? err.message : "Failed to load page",
				statusCode: 500,
			}),
		);
	}

	function getMessage(resolved: Page): string {
		return resolved.pageType === "home"
			? resolved.body
			: resolved.errorMessage;
	}
</script>

<svelte:head>
	<title>Finesoft Front — Svelte 5</title>
	<meta name="description" content="Svelte 5 template for @finesoft/front" />
</svelte:head>

{#await safePage}
	<main>
		<h1>Loading...</h1>
		<p>{isFirstPage ? "Preparing first page" : "Navigating"}</p>
	</main>
{:then resolved}
	<main>
		<p>locale: {locale}</p>
		<h1>{resolved.title}</h1>
		<p>{getMessage(resolved)}</p>

		<nav>
			<a href="/">Home</a>
		</nav>

		{#if framework}
			<p>Framework is available on the client.</p>
		{/if}
	</main>
{/await}
