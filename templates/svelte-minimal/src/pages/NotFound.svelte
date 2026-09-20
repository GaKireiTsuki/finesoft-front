<script lang="ts">
    import type { ErrorPage } from "../lib/models/page";
    let { page }: { page: ErrorPage } = $props();
</script>

<section class="page">
    <h1>{page.title}</h1>
    <p>{page.description}</p>
    <a href="/">← Go Home</a>
</section>
