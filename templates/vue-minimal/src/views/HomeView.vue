<script setup lang="ts">
import { computed } from "vue";
import type { BasePage } from "@finesoft/front";
import type { FeedPage } from "../lib/controllers/home";
import type { AppController } from "../main";

const { page, controller } = defineProps<{ page: BasePage; controller?: AppController }>();
const feed = computed(() => (page.pageType === "home" ? (page as FeedPage) : null));
</script>

<template>
    <section>
        <h1 style="margin: 0 0 0.25rem">{{ page.title }}</h1>
        <p style="color: #666; margin: 0 0 1rem">{{ page.description }}</p>
        <ul v-if="feed" style="list-style: none; padding: 0; display: grid; gap: 0.5rem">
            <li v-for="item in feed.items" :key="item.id">
                <button
                    style="width: 100%; text-align: left"
                    @click="controller?.push('detail', { id: item.id })"
                >
                    {{ item.title }} →
                </button>
            </li>
        </ul>
    </section>
</template>
