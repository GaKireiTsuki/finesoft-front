<script setup lang="ts">
import type { BasePage } from "@finesoft/front";
import { shallowRef } from "vue";
import Navigation from "./components/Navigation.vue";
import About from "./pages/About.vue";
import Home from "./pages/Home.vue";
import NotFound from "./pages/NotFound.vue";
import ProductDetail from "./pages/ProductDetail.vue";
import Search from "./pages/Search.vue";

const page = shallowRef<BasePage>();

const pageComponents: Record<string, unknown> = {
    home: Home,
    product: ProductDetail,
    search: Search,
    about: About,
};

defineExpose({
    update(newPage: BasePage) {
        page.value = newPage;
    },
});
</script>

<template>
    <Navigation />
    <main>
        <component v-if="page" :is="pageComponents[page.pageType] ?? NotFound" :page="page" />
    </main>
</template>
