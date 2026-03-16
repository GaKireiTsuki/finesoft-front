<script lang="ts">
	import type { Framework } from "@finesoft/front";
	import type { ErrorPage, Page } from "./lib/models/page";

	export let page: Promise<Page> | Page = new Promise(() => {});
	export let isFirstPage = true;
	export let locale = "en";
	export let framework: Framework | undefined = undefined;

	$: safePage = normalizePage(page);

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
	<title>Finesoft Front — Svelte 4</title>
	<meta name="description" content="Svelte 4 template for @finesoft/front" />
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
