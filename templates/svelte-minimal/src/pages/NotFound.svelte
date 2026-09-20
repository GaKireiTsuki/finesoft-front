<script lang="ts">
    import type { ViewProps } from "@finesoft/front/svelte";
    import type { ErrorPage } from "../lib/models/page";
    let { page, app }: { page: ErrorPage; app: ViewProps["app"] } = $props();
    function goHome(event: MouseEvent) {
        if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        ) return;
        event.preventDefault();
        void app.navigation.navigate("/");
    }
</script>

<section class="page">
    <h1>{page.title}</h1>
    <p>{page.description}</p>
    <a href="/" onclick={goHome}>← Go Home</a>
</section>
