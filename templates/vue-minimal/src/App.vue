<script setup lang="ts">
import type { BasePage } from "@finesoft/front";
import { shallowRef } from "vue";
import Home from "./pages/Home.vue";

const props = defineProps<{ page?: BasePage }>();
const currentPage = shallowRef<BasePage | undefined>(props.page);

defineExpose({
    update(newPage: BasePage) {
        currentPage.value = newPage;
    },
});
</script>

<template>
    <main>
        <Home v-if="currentPage" :page="currentPage" />
    </main>
</template>
