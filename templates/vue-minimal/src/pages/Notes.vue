<script setup lang="ts">
import type { NotesPage } from "../lib/models/page";
defineOptions({ inheritAttrs: false });
const { page } = defineProps<{ page: NotesPage }>();
</script>

<template>
    <section class="page">
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>
        <!-- The entry owns this draft; data-restore-root also restores it after reload. -->
        <div class="draft" data-restore-root>
            <label
                >Notes draft<textarea
                    name="notes"
                    rows="6"
                    placeholder="Write a note; switch tabs or reload to restore it"
                ></textarea>
            </label>
        </div>
    </section>
</template>
