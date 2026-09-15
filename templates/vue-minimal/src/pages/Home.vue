<script setup lang="ts">
import type { BrowserAppHandle } from "@finesoft/front/browser";
import type { Framework } from "@finesoft/front/web";
import { computed } from "vue";
import type { HomePage } from "../lib/models/page";
import { getHomeLocale } from "../lib/locale";

defineOptions({ inheritAttrs: false });
const { page, controller, framework } = defineProps<{
    page: HomePage;
    controller?: BrowserAppHandle;
    framework?: Framework;
}>();
const locale = computed(() => getHomeLocale(framework));
</script>

<template>
    <section class="page">
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>
        <ul class="feed">
            <li v-for="item in page.items" :key="item.id">
                <button @click="controller?.navigation?.push('detail', { id: item.id })">
                    {{ item.title }}
                </button>
            </li>
        </ul>
        <section class="locale-info" aria-label="Locale">
            <p>
                <strong>{{ locale.label }}:</strong> {{ locale.lang }}
            </p>
            <p>{{ locale.badge }}</p>
            <p>{{ locale.hint }}</p>
        </section>
    </section>
</template>
