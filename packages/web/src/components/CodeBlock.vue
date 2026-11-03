<script setup lang="ts">
import { ref, watch } from 'vue';
import { highlighter } from '../lib/highlighter';
const props = defineProps<{ code: string; language: string; preview?: boolean }>();
const rendered = ref('');
let sequence = 0;
watch(
  () => [props.code, props.language, props.preview],
  async () => {
    const current = ++sequence;
    const h = await highlighter;
    const lang =
      (
        {
          shellscript: 'bash',
          typescriptreact: 'typescript',
          javascriptreact: 'javascript',
        } as Record<string, string>
      )[props.language] ?? props.language;
    const code = props.preview ? props.code.split('\n').slice(0, 8).join('\n') : props.code;
    const result = h.codeToHtml(code, {
      lang: h.getLoadedLanguages().includes(lang) ? lang : 'text',
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    });
    if (current === sequence) rendered.value = result;
  },
  { immediate: true },
);
</script>
<template>
  <div v-if="rendered" class="code-block" :class="{ 'code-preview': preview }" v-html="rendered" />
  <pre v-else class="code-block">{{ code }}</pre>
</template>
