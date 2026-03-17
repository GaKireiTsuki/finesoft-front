<script setup lang="ts">
import type { Action } from "@finesoft/front";
import { computed } from "vue";
import Layout from "./components/Layout.vue";
import Loading from "./components/Loading.vue";
import PageRenderer from "./components/PageRenderer.vue";
import type { AppPage } from "./lib/models/product";

// state: reactive object for CSR; page: initial prop for SSR
const {
    state,
    page: ssrPage,
    onAction,
} = defineProps<{
    state?: { page: AppPage | null; loading: boolean };
    page?: AppPage;
    onAction?: (action: Action) => void;
}>();

const currentPage = computed(() => state?.page ?? ssrPage ?? null);
const loading = computed(() => state?.loading ?? false);
</script>

<template>
    <Layout :current-path="currentPage?.url ?? '/'" :on-action="onAction">
        <Loading v-if="loading" />
        <PageRenderer v-else-if="currentPage" :page="currentPage" :on-action="onAction" />
    </Layout>
</template>
