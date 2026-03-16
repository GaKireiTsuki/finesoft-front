<script setup lang="ts">
import type { Framework } from "@finesoft/front";
import { ref, watch } from "vue";
import type { ErrorPage, Page } from "./lib/models/page";

const props = defineProps<{
    page: Promise<Page> | Page;
    isFirstPage?: boolean;
    locale?: string;
    framework?: Framework;
}>();

const resolved = ref<Page | null>(null);
const loading = ref(true);

function resolvePageValue(value: Promise<Page> | Page) {
    if (value instanceof Promise) {
        loading.value = true;
        resolved.value = null;
        value
            .then((p) => {
                resolved.value = p;
                loading.value = false;
            })
            .catch((err) => {
                const errorPage: ErrorPage = {
                    id: "page-error-runtime",
                    pageType: "error",
                    title: "Error",
                    errorMessage: err instanceof Error ? err.message : "Failed to load page",
                    statusCode: 500,
                };
                resolved.value = errorPage;
                loading.value = false;
            });
    } else {
        resolved.value = value;
        loading.value = false;
    }
}

watch(() => props.page, resolvePageValue, { immediate: true });

function getMessage(page: Page): string {
    return page.pageType === "home" ? page.body : page.errorMessage;
}
</script>

<template>
    <Teleport to="head">
        <title>Finesoft Front — Vue</title>
        <meta name="description" content="Vue template for @finesoft/front" />
    </Teleport>

    <main v-if="loading">
        <h1>Loading...</h1>
        <p>{{ props.isFirstPage ? "Preparing first page" : "Navigating" }}</p>
    </main>

    <main v-else-if="resolved">
        <p>locale: {{ props.locale }}</p>
        <h1>{{ resolved.title }}</h1>
        <p>{{ getMessage(resolved) }}</p>

        <nav>
            <a href="/">Home</a>
        </nav>

        <p v-if="props.framework">Framework is available on the client.</p>
    </main>
</template>
