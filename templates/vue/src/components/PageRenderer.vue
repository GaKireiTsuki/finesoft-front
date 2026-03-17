<script setup lang="ts">
import type { Action } from "@finesoft/front";
import type { AppPage } from "../lib/models/product";
import About from "../pages/About.vue";
import Home from "../pages/Home.vue";
import NotFound from "../pages/NotFound.vue";
import ProductDetail from "../pages/ProductDetail.vue";
import Search from "../pages/Search.vue";

const { page, onAction } = defineProps<{
    page: AppPage;
    onAction?: (action: Action) => void;
}>();

const pageComponents: Record<string, unknown> = {
    home: Home,
    product: ProductDetail,
    search: Search,
    about: About,
    error: NotFound,
};
</script>

<template>
    <component :is="pageComponents[page.pageType] ?? NotFound" :page="page" :on-action="onAction" />
</template>
