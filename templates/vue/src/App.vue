<script setup lang="ts">
import { Outlet, useSnapshot, type WebAppView } from "@finesoft/front/vue";
import Layout from "./components/Layout.vue";
import { views } from "./views";
const { app } = defineProps<{ app: WebAppView }>();
const snapshot = useSnapshot(app);
</script>

<template>
    <Layout :current-path="snapshot.entries.find((entry) => entry.visible)?.page.url ?? '/'">
        <Outlet :app="app" :views="views" />
    </Layout>
</template>
