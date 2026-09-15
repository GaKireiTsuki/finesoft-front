<script setup lang="ts">
import { ref, onUnmounted } from "vue";
defineProps<{ page: { title: string } }>();
const draft = ref("");
onUnmounted(() => {
    (globalThis as any).cleanups = ((globalThis as any).cleanups ?? 0) + 1;
});
</script>
<template>
    <section data-restore-root>
        <h1>{{ page.title }}</h1>
        <input name="draft" v-model="draft" /><span>{{ draft }}</span>
    </section>
</template>
