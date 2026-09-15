<script setup lang="ts">
import type { BrowserAppHandle } from "@finesoft/front/browser";
import { createNavigation } from "../app-definition";
import type { ErrorPage } from "../lib/models/page";
defineOptions({ inheritAttrs: false });
const { page, controller } = defineProps<{ page: ErrorPage; controller?: BrowserAppHandle }>();
function goHome(event: MouseEvent) {
    if (
        !controller?.navigation ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    )
        return;
    event.preventDefault();
    void controller.navigation.hydrate(createNavigation("/")!);
}
</script>

<template>
    <section class="page">
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>
        <a href="/" @click="goHome">← Go Home</a>
    </section>
</template>
