<script setup lang="ts">
import type { Action } from "@finesoft/front/web";
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
</script>

<template>
    <Home v-if="page.pageType === 'home'" :page="page" :on-action="onAction" />
    <ProductDetail v-else-if="page.pageType === 'product'" :page="page" :on-action="onAction" />
    <Search v-else-if="page.pageType === 'search'" :page="page" :on-action="onAction" />
    <About v-else-if="page.pageType === 'about'" :page="page" :on-action="onAction" />
    <NotFound v-else :page="page" :on-action="onAction" />
</template>
