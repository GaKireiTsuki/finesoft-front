<script setup lang="ts">
import type { BasePage } from "@finesoft/front";

defineProps<{ page: BasePage }>();
</script>

<template>
    <section>
        <h1 style="margin: 0 0 0.25rem">{{ page.title }}</h1>
        <p style="color: #666; margin: 0 0 1rem">{{ page.description }}</p>

        <!--
          零样板保活：标一个 data-restore-root，里面的裸 <input> 即自动：
          - in-session：push 走、pop 回来值还在（islands 保活，实例没销毁）
          - 重载：sessionStorage 回填（domRestore），合成事件驱动可能的受控绑定
          对比重构前：需手写 entryKey + watch + getScoped/setScoped —— 现在一行不写。
        -->
        <div data-restore-root>
            <label style="display: block; margin-top: 1rem">
                Draft note for this screen:
                <input
                    name="note"
                    placeholder="kept while alive; restored on reload"
                    style="width: 100%"
                />
            </label>
        </div>
    </section>
</template>
