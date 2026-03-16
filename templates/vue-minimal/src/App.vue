<script setup lang="ts">
import type { BasePage } from "@finesoft/front";
import { shallowRef } from "vue";
import Home from "./pages/Home.vue";

const page = shallowRef<BasePage>();

defineExpose({
    update(newPage: BasePage) {
        page.value = newPage;
    },
});
</script>

<template>
    <main>
        <Home v-if="page" :page="page" />
    </main>
</template>
