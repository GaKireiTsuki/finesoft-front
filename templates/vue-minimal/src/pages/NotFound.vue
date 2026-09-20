<script setup lang="ts">
import type { ViewProps } from "@finesoft/front/vue";
import type { ErrorPage } from "../lib/models/page";
defineOptions({ inheritAttrs: false });
const { page, app } = defineProps<{ page: ErrorPage; app: ViewProps["app"] }>();
function goHome(event: MouseEvent) {
    event.preventDefault();
    void app.navigation.navigate("/");
}
</script>

<template>
    <section class="page">
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>
        <a href="/" @click="goHome">← Go Home</a>
    </section>
</template>
