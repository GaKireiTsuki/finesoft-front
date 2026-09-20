<script setup lang="ts">
import { ref, inject, onUnmounted, type Ref } from "vue";
defineProps<{
    page: { title: string };
    app: { getSnapshot(): { entries: readonly { page: { title?: string } }[] } };
}>();
const draft = ref("");
const locale = inject<Ref<string>>("native-locale", ref("missing"));
onUnmounted(() => {
    (globalThis as any).cleanups = ((globalThis as any).cleanups ?? 0) + 1;
});
</script>
<template>
    <section
        data-restore-root
        :data-context-locale="locale"
        :data-snapshot-title="app.getSnapshot().entries.at(-1)?.page.title ?? 'empty'"
    >
        <h1>{{ page.title }}</h1>
        <input name="draft" v-model="draft" /><span>{{ draft }}</span>
    </section>
</template>
