<script lang="ts">
    import type { ViewProps } from "@finesoft/front/svelte";
    import type { HomePage } from "../lib/models/page";
    import { getHomeLocale } from "../lib/locale";

    let { page, app }: { page: HomePage; app: ViewProps["app"] } = $props();
    const locale = $derived(getHomeLocale(app));
</script>

<section class="page">
    <h1>{page.title}</h1>
    <p>{page.description}</p>
    <ul class="feed">
        {#each page.items as item (item.id)}<li><button onclick={() => void app.navigation.navigate(`/item/${item.id}`)}>{item.title}</button></li>{/each}
    </ul>
    <section class="locale-info" aria-label="Locale">
        <p><strong>{locale.label}:</strong> {locale.lang}</p>
        <p>{locale.badge}</p>
        <p>{locale.hint}</p>
    </section>
</section>
