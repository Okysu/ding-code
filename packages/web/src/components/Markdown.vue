<script setup lang="ts">
import { computed } from 'vue';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
const props = defineProps<{ text: string; outline?: boolean }>();
const md = new MarkdownIt({ html: false, linkify: false, typographer: true });
const rendered = computed(() => {
  const tokens = md.parse(props.text, {});
  const headings: { id: string; text: string }[] = [];
  tokens.forEach((token, index) => {
    if (token.type === 'heading_open') {
      const id = `section-${index}`;
      token.attrSet('id', id);
      if (['h1', 'h2', 'h3'].includes(token.tag))
        headings.push({ id, text: tokens[index + 1].content });
    }
  });
  const html = DOMPurify.sanitize(md.renderer.render(tokens, md.options, {}), {
    FORBID_TAGS: ['img'],
    FORBID_ATTR: ['style'],
    ADD_ATTR: ['id'],
  });
  return { html, headings };
});
function scroll(id: string, event: Event) {
  const root = (event.target as HTMLElement).closest('.markdown-wrap');
  root?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>
<template>
  <div class="markdown-wrap">
    <nav v-if="outline && rendered.headings.length" class="toc">
      <a
        v-for="h in rendered.headings"
        :key="h.id"
        :href="`#${h.id}`"
        @click.prevent="scroll(h.id, $event)"
      >
        {{ h.text }}
      </a>
    </nav>
    <div class="prose" v-html="rendered.html" />
  </div>
</template>
