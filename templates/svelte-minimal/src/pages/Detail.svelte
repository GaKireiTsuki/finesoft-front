<script lang="ts">
    import type { DetailPage } from "../lib/models/page";
    let { page }: { page: DetailPage } = $props();
</script>

<section class="page">
    <h1>{page.title}</h1>
    <p>{page.description}</p>
    <!-- The entry owns this draft; data-restore-root also restores it after reload. -->
    <div class="draft" data-restore-root><label>Detail note<input name="note" placeholder="Kept while this screen is alive; lost when popped" /></label></div>
</section>
