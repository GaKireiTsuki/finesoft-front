<script setup lang="ts">
import type { Action, BasePage } from "@finesoft/front";
import { computed } from "vue";
import Home from "./pages/Home.vue";

const { state, page: ssrPage } = defineProps<{
    state?: { page: BasePage | null; loading: boolean };
    page?: BasePage;
    onAction?: (action: Action) => void;
}>();

const currentPage = computed(() => state?.page ?? ssrPage ?? null);
const loading = computed(() => state?.loading ?? false);
</script>

<template>
    <main style="padding: 1rem">
        <p v-if="loading" style="text-align: center; color: #999">Loading…</p>
        <Home v-else-if="currentPage" :page="currentPage" />
    </main>
</template>
