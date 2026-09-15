<script lang="ts">
    import type { BrowserAppHandle } from "@finesoft/front/browser";
    import type { Framework } from "@finesoft/front/web";
    import type { HomePage } from "../lib/models/page";
    import { getHomeLocale } from "../lib/locale";

    let { page, controller, framework }: { page: HomePage; controller?: BrowserAppHandle; framework?: Framework } = $props();
    const locale = $derived(getHomeLocale(framework));
</script>

<section class="page">
    <h1>{page.title}</h1>
    <p>{page.description}</p>
    <ul class="feed">
        {#each page.items as item (item.id)}<li><button onclick={() => void controller?.navigation?.push("detail", { id: item.id })}>{item.title}</button></li>{/each}
    </ul>
    <section class="locale-info" aria-label="Locale">
        <p><strong>{locale.label}:</strong> {locale.lang}</p>
        <p>{locale.badge}</p>
        <p>{locale.hint}</p>
    </section>
</section>
