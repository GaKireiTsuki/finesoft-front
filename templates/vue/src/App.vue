<script setup lang="ts">
import type { Action } from "@finesoft/front/web";
import Layout from "./components/Layout.vue";
import Loading from "./components/Loading.vue";
import PageRenderer from "./components/PageRenderer.vue";
import type { AppPage } from "./lib/models/product";

const {
    page,
    loading = false,
    onAction,
} = defineProps<{
    page?: AppPage | null;
    loading?: boolean;
    onAction?: (action: Action) => void;
}>();
</script>

<template>
    <Layout :current-path="page?.url ?? '/'" :on-action="onAction">
        <Loading v-if="loading" />
        <PageRenderer v-if="page" :page="page" :on-action="onAction" />
    </Layout>
</template>
