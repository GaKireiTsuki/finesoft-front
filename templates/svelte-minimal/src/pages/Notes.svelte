<script lang="ts">
    import type { NotesPage } from "../lib/models/page";
    let { page }: { page: NotesPage } = $props();
</script>

<section class="page">
    <h1>{page.title}</h1>
    <p>{page.description}</p>
    <!-- The entry owns this draft; data-restore-root also restores it after reload. -->
    <div class="draft" data-restore-root><label>Notes draft<textarea name="notes" rows={6} placeholder="Write a note; switch tabs or reload to restore it"></textarea></label></div>
</section>
