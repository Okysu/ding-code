<script setup lang="ts">
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ArrowLeft,
  ExternalLink,
  Save,
  Pencil,
  Download,
  BookOpen,
  MessageSquareCode,
  Send,
  Square,
  Copy,
  Check,
  FileCode,
  Trash2,
} from 'lucide-vue-next';
import type { Snippet, ChatMessage } from '../../../../shared/types';
import { Button } from './ui/button';
import Tabs from './ui/Tabs.vue';
import ResizablePanelGroup from './ui/ResizablePanelGroup.vue';
import ConfirmDialog from './ui/ConfirmDialog.vue';
import CodeBlock from './CodeBlock.vue';
import Markdown from './Markdown.vue';
import { api, saveBlob, streamAI } from '../lib/api';
const props = defineProps<{ snippet: Snippet; aiAvailable: boolean; compact: boolean }>();
const emit = defineEmits<{
  close: [];
  changed: [];
  error: [error: unknown];
  dirty: [value: boolean];
}>();
const { t, locale, tm } = useI18n();
const tab = ref('note'),
  note = ref(''),
  article = ref(''),
  tags = ref(''),
  version = ref('');
const editing = ref(false),
  notePreview = ref(false),
  saving = ref(false),
  saved = ref(false),
  running = ref(false),
  generated = ref(''),
  copied = ref(false);
const deleteDialog = ref(false),
  leaveDialog = ref(false),
  question = ref(''),
  messages = ref<ChatMessage[]>([]),
  answer = ref('');
let controller: AbortController | undefined;
const base = ref({ note: '', article: '', tags: '' });
const dirty = computed(
  () =>
    note.value !== base.value.note ||
    article.value !== base.value.article ||
    tags.value !== base.value.tags,
);
watch(dirty, (value) => emit('dirty', value));
function load() {
  note.value = props.snippet.user_note;
  article.value = props.snippet.ai_article ?? '';
  tags.value = props.snippet.tags.join(', ');
  version.value = props.snippet.updated_at;
  base.value = { note: note.value, article: article.value, tags: tags.value };
  saved.value = false;
}
watch(
  () => props.snippet,
  (next, previous) => {
    if (next.id !== previous?.id || !dirty.value) load();
  },
  { immediate: true },
);
watch(
  () => props.snippet.id,
  async (id) => {
    try {
      messages.value = await api<ChatMessage[]>(`chat?id=${id}`);
    } catch (error) {
      emit('error', error);
    }
  },
  { immediate: true },
);
async function save() {
  saving.value = true;
  try {
    const row = await api<Snippet>(`snippets/${props.snippet.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        user_note: note.value,
        ai_article: article.value || null,
        tags: [
          ...new Set(
            tags.value
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ],
        expectedUpdatedAt: version.value,
      }),
    });
    version.value = row.updated_at;
    base.value = { note: note.value, article: article.value, tags: tags.value };
    saved.value = true;
    emit('changed');
    return true;
  } catch (error) {
    emit('error', error);
    return false;
  } finally {
    saving.value = false;
  }
}
async function generate() {
  if (dirty.value && !(await save())) return;
  running.value = true;
  tab.value = 'article';
  generated.value = '';
  controller = new AbortController();
  try {
    await streamAI(
      { kind: 'article', ids: [props.snippet.id], locale: locale.value },
      (delta) => {
        generated.value += delta;
      },
      controller.signal,
    );
    article.value = generated.value;
    base.value.article = article.value;
    editing.value = false;
    emit('changed');
  } catch (error) {
    if (!controller.signal.aborted) emit('error', error);
  } finally {
    running.value = false;
    generated.value = '';
  }
}
async function send() {
  if (!question.value.trim()) return;
  if (dirty.value && !(await save())) return;
  running.value = true;
  answer.value = '';
  controller = new AbortController();
  const text = question.value;
  try {
    await streamAI(
      { kind: 'chat', ids: [props.snippet.id], question: text, locale: locale.value },
      (delta) => {
        answer.value += delta;
      },
      controller.signal,
    );
    messages.value = await api<ChatMessage[]>(`chat?id=${props.snippet.id}`);
    question.value = '';
    answer.value = '';
  } catch (error) {
    if (!controller.signal.aborted) emit('error', error);
  } finally {
    running.value = false;
  }
}
async function remove() {
  try {
    await api(`snippets/${props.snippet.id}`, { method: 'DELETE' });
    deleteDialog.value = false;
    emit('changed');
    emit('close');
  } catch (error) {
    emit('error', error);
  }
}
function close() {
  if (dirty.value) leaveDialog.value = true;
  else emit('close');
}
async function copy() {
  try {
    await navigator.clipboard.writeText(props.snippet.code_content);
    copied.value = true;
  } catch (error) {
    emit('error', error);
  }
}
function exportArticle() {
  saveBlob(
    new Blob([article.value], { type: 'text/markdown;charset=utf-8' }),
    `ding-code-${props.snippet.id.slice(0, 8)}.md`,
  );
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) event.preventDefault();
}
window.addEventListener('beforeunload', beforeUnload);
onBeforeUnmount(() => {
  controller?.abort();
  emit('dirty', false);
  window.removeEventListener('beforeunload', beforeUnload);
});
defineExpose({ dirty, save });
</script>
<template>
  <section class="studio" :class="{ 'studio-compact': compact }">
    <header class="studio-header">
      <Button variant="ghost" size="icon" :title="t('back')" :aria-label="t('back')" @click="close">
        <ArrowLeft />
      </Button>
      <div class="studio-heading">
        <strong>{{ snippet.user_note.split('\n')[0] || snippet.relative_path }}</strong>
        <span>
          {{ snippet.project_name || t('noProject') }}
          <span class="separator">/</span>
          {{ snippet.relative_path }}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        :title="t('delete')"
        :aria-label="t('delete')"
        :disabled="running"
        @click="deleteDialog = true"
      >
        <Trash2 />
      </Button>
    </header>
    <ResizablePanelGroup :compact="compact">
      <template #left>
        <div class="source-toolbar">
          <span class="eyebrow">
            <FileCode :size="14" />
            {{ t('context') }}
          </span>
          <span class="language-label">{{ snippet.language }}</span>
        </div>
        <div class="source-file">
          <span>{{ snippet.relative_path }}:{{ snippet.start_line }}–{{ snippet.end_line }}</span>
          <Button
            variant="ghost"
            size="icon"
            :title="t('copy')"
            :aria-label="t('copy')"
            @click="copy"
          >
            <Check v-if="copied" />
            <Copy v-else />
          </Button>
        </div>
        <div class="source-scroll">
          <pre v-if="snippet.context_before" class="surrounding-code">{{
            snippet.context_before
          }}</pre>
          <CodeBlock :code="snippet.code_content" :language="snippet.language" />
          <pre v-if="snippet.context_after" class="surrounding-code">{{
            snippet.context_after
          }}</pre>
        </div>
        <div class="source-footer">
          <Button
            variant="outline"
            @click="
              api('open', { method: 'POST', body: JSON.stringify({ id: snippet.id }) }).catch(
                (error) => emit('error', error),
              )
            "
          >
            <ExternalLink />
            {{ t('openCode') }}
          </Button>
        </div>
      </template>
      <template #right>
        <Tabs
          v-model="tab"
          :items="[
            { value: 'note', label: t('note') },
            { value: 'article', label: t('article') },
            { value: 'chat', label: t('chat') },
          ]"
        >
          <template #note>
            <div class="editor-toolbar">
              <span class="eyebrow">MARKDOWN</span>
              <Button variant="ghost" size="sm" @click="notePreview = !notePreview">
                {{ notePreview ? t('edit') : t('preview') }}
              </Button>
            </div>
            <div class="note-body">
              <Markdown v-if="notePreview" :text="note" />
              <Textarea
                v-else
                v-model="note"
                class="note-editor"
                :aria-label="t('note')"
                :placeholder="t('notePlaceholder')"
                :disabled="running"
              />
            </div>
            <div class="note-bottom">
              <Label for="snippet-tags">{{ t('tags') }}</Label>
              <Input
                id="snippet-tags"
                v-model="tags"
                :placeholder="t('tagPlaceholder')"
                :disabled="running"
              />
              <div class="save-row">
                <span class="save-status">
                  {{ saved && !dirty ? t('saved') : dirty ? '•' : '' }}
                </span>
                <Button :disabled="!dirty || saving || running" @click="save">
                  <Save />
                  {{ saving ? t('saving') : t('save') }}
                </Button>
              </div>
            </div>
          </template>
          <template #article>
            <div class="editor-toolbar">
              <Button
                variant="secondary"
                size="sm"
                :disabled="!aiAvailable || running"
                :title="!aiAvailable ? t('aiHint') : t('generate')"
                @click="generate"
              >
                <BookOpen />
                {{ t('generate') }}
              </Button>
              <div class="toolbar-actions">
                <Button
                  variant="ghost"
                  size="icon"
                  :title="editing ? t('preview') : t('edit')"
                  :aria-label="editing ? t('preview') : t('edit')"
                  :disabled="running"
                  @click="editing = !editing"
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  :title="t('exportMd')"
                  :aria-label="t('exportMd')"
                  :disabled="!article"
                  @click="exportArticle"
                >
                  <Download />
                </Button>
              </div>
            </div>
            <div v-if="running && tab === 'article'" class="generation-status">
              <span class="pulse" />
              {{ t('generating') }}
              <Button variant="ghost" size="sm" @click="controller?.abort()">
                <Square />
                {{ t('stop') }}
              </Button>
            </div>
            <div class="article-body">
              <Textarea
                v-if="editing"
                v-model="article"
                class="note-editor article-editor"
                :aria-label="t('article')"
                :placeholder="t('notePlaceholder')"
              />
              <Markdown v-else-if="article || generated" :text="generated || article" outline />
              <div v-else class="article-empty">
                <BookOpen :size="32" stroke-width="1.3" />
                <h2>{{ t('emptyArticle') }}</h2>
                <p>{{ t('emptyArticleBody') }}</p>
                <ol>
                  <li v-for="(step, index) in tm('steps') as string[]" :key="step">
                    <span>{{ String(index + 1).padStart(2, '0') }}</span>
                    {{ step }}
                  </li>
                </ol>
                <p v-if="!aiAvailable" class="ai-hint">{{ t('aiHint') }}</p>
              </div>
            </div>
            <div v-if="dirty" class="note-bottom">
              <div class="save-row">
                <span />
                <Button :disabled="saving || running" @click="save">
                  <Save />
                  {{ t('save') }}
                </Button>
              </div>
            </div>
          </template>
          <template #chat>
            <div class="chat-body">
              <div v-if="!messages.length && !answer" class="article-empty">
                <MessageSquareCode :size="32" stroke-width="1.3" />
                <h2>{{ t('chatEmpty') }}</h2>
                <p>{{ t('chatEmptyBody') }}</p>
                <p v-if="!aiAvailable" class="ai-hint">{{ t('aiHint') }}</p>
              </div>
              <div
                v-for="message in messages"
                :key="message.id"
                class="chat-message"
                :class="message.role"
              >
                <span class="eyebrow">{{ message.role === 'assistant' ? 'AI' : t('note') }}</span>
                <Markdown :text="message.content" />
              </div>
              <div v-if="answer" class="chat-message assistant">
                <span class="eyebrow">AI</span>
                <Markdown :text="answer" />
              </div>
            </div>
            <form class="chat-input" @submit.prevent="send">
              <Textarea
                v-model="question"
                :placeholder="t('question')"
                :aria-label="t('question')"
                :disabled="!aiAvailable || running"
              />
              <Button
                v-if="running"
                variant="secondary"
                :title="t('stop')"
                @click="controller?.abort()"
              >
                <Square />
                {{ t('stop') }}
              </Button>
              <Button v-else :disabled="!aiAvailable || !question.trim()" @click="send">
                <Send />
                {{ t('send') }}
              </Button>
            </form>
          </template>
        </Tabs>
      </template>
    </ResizablePanelGroup>
    <ConfirmDialog
      v-model:open="deleteDialog"
      :title="t('deleteTitle')"
      :description="t('deleteBody')"
      :confirm="t('confirmDelete')"
      @confirm="remove"
    />
    <ConfirmDialog
      v-model:open="leaveDialog"
      :title="t('unsavedTitle')"
      :description="t('unsavedBody')"
      :confirm="t('discard')"
      @confirm="emit('close')"
    />
  </section>
</template>
