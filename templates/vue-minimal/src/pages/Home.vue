<script setup lang="ts">
import type { ViewProps } from "@finesoft/front";
import { computed } from "vue";
import type { HomePage } from "../lib/models/page";
import { getHomeLocale } from "../lib/locale";

defineOptions({ inheritAttrs: false });
const { page, app } = defineProps<{
    page: HomePage;
    app: ViewProps["app"];
}>();
const locale = computed(() => getHomeLocale(app));
</script>

<template>
    <section class="page">
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>
        <ul class="feed">
            <li v-for="item in page.items" :key="item.id">
                <button @click="app.perform({ kind: 'flow', url: `/item/${item.id}` })">
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
