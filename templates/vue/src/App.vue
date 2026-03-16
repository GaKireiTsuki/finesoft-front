<script setup lang="ts">
import type { BasePage } from "@finesoft/front";
import { shallowRef } from "vue";
import Navigation from "./components/Navigation.vue";
import About from "./pages/About.vue";
import Home from "./pages/Home.vue";
import NotFound from "./pages/NotFound.vue";
import ProductDetail from "./pages/ProductDetail.vue";
import Search from "./pages/Search.vue";

const props = defineProps<{ page?: BasePage }>();
const currentPage = shallowRef<BasePage | undefined>(props.page);

const pageComponents: Record<string, unknown> = {
    home: Home,
    product: ProductDetail,
    search: Search,
    about: About,
};

defineExpose({
    update(newPage: BasePage) {
        currentPage.value = newPage;
    },
});
</script>

<template>
    <Navigation />
    <main>
        <component
            v-if="currentPage"
            :is="pageComponents[currentPage.pageType] ?? NotFound"
            :page="currentPage"
        />
    </main>
</template>
