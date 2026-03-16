<script setup lang="ts">
import ProductCard from "../components/ProductCard.vue";
import type { HomePage } from "../lib/models/product";

const { page } = defineProps<{ page: HomePage }>();
</script>

<template>
    <div>
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>

        <section v-for="shelf in page.shelves" :key="shelf.id">
            <h2>{{ shelf.title }}</h2>
            <div class="shelf" :class="{ horizontal: shelf.isHorizontal }">
                <ProductCard v-for="item in shelf.items" :key="item.id" :item="item" />
            </div>
        </section>
    </div>
</template>

<style scoped>
.shelf {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
}
.shelf.horizontal {
    flex-wrap: nowrap;
    overflow-x: auto;
}
</style>
