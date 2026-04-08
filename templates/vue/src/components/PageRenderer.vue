<script setup lang="ts">
import type { Action } from "@finesoft/front";
import { KeepAlivePageView, type KeepAliveViewEntry } from "@finesoft/front/vue";
import type { AppPage } from "../lib/models/product";
import About from "../pages/About.vue";
import Home from "../pages/Home.vue";
import NotFound from "../pages/NotFound.vue";
import ProductDetail from "../pages/ProductDetail.vue";
import Search from "../pages/Search.vue";

const { pages, onAction, onCacheable } = defineProps<{
    pages: KeepAliveViewEntry<AppPage>[];
    onAction?: (action: Action) => void;
    onCacheable?: (cacheKey: string, page: AppPage) => void;
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
    <KeepAlivePageView
        v-for="entry in pages"
        :key="entry.key"
        :cache-key="entry.key"
        :page="entry.page"
        :active="entry.active"
        :on-cacheable="onCacheable"
    >
        <component
            :is="pageComponents[entry.page.pageType] ?? NotFound"
            :page="entry.page"
            :on-action="onAction"
        />
    </KeepAlivePageView>
</template>
