<script setup lang="ts">
import type { Action } from "@finesoft/front/web";
import ProductCard from "../components/ProductCard.vue";
import type { HomePage } from "../lib/models/product";

const { page, onAction } = defineProps<{ page: HomePage; onAction?: (action: Action) => void }>();
</script>

<template>
    <section class="page page-home">
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>

        <section v-for="shelf in page.shelves" :key="shelf.id" class="shelf-section">
            <h2>{{ shelf.title }}</h2>
            <div class="shelf" :class="{ horizontal: shelf.isHorizontal }">
                <ProductCard
                    v-for="item in shelf.items"
                    :key="item.id"
                    :item="item"
                    :on-action="onAction"
                />
            </div>
        </section>
    </section>
</template>
