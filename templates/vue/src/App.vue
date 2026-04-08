<script setup lang="ts">
import type { Action } from "@finesoft/front";
import type { KeepAliveViewEntry } from "@finesoft/front/vue";
import { computed } from "vue";
import Layout from "./components/Layout.vue";
import Loading from "./components/Loading.vue";
import PageRenderer from "./components/PageRenderer.vue";
import type { AppPage } from "./lib/models/product";

const {
    state,
    pages = [],
    page = null,
    loading = false,
    currentPath = "/",
    onAction,
    onCacheable,
} = defineProps<{
    state?: {
        pages: KeepAliveViewEntry<AppPage>[];
        loading: boolean;
        currentPath: string;
    };
    pages?: KeepAliveViewEntry<AppPage>[];
    page?: AppPage | null;
    loading?: boolean;
    currentPath?: string;
    onAction?: (action: Action) => void;
    onCacheable?: (cacheKey: string, page: AppPage) => void;
}>();

const resolvedPages = computed(() =>
    (state?.pages?.length ?? 0) > 0
        ? (state?.pages ?? [])
        : pages.length > 0
          ? pages
          : page
            ? [
                  {
                      key: page.url ?? page.id,
                      page,
                      active: true,
                      cacheable: false,
                  },
              ]
            : [],
);
const resolvedLoading = computed(() => state?.loading ?? loading);
const resolvedPath = computed(() => state?.currentPath ?? currentPath);
</script>

<template>
    <Layout :current-path="resolvedPages[0]?.page.url ?? resolvedPath" :on-action="onAction">
        <Loading v-if="resolvedLoading" />
        <PageRenderer :pages="resolvedPages" :on-action="onAction" :on-cacheable="onCacheable" />
    </Layout>
</template>
