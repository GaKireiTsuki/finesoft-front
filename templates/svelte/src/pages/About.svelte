<script lang="ts">
	import type { Action } from "@finesoft/front/web";
	import type { AboutPage } from "../lib/models/product";

	let { page }: { page: AboutPage; onAction?: (action: Action) => void } = $props();
</script>

<section class="page page-about">
	<h1>{page.title}</h1>
	<p>{page.content}</p>
</section>
