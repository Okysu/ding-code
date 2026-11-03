<script setup lang="ts">
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Bookmark,
  LayoutGrid,
  Radio,
  Settings2,
  Globe,
  Sun,
  Moon,
  Search,
  ArrowUpRight,
  ArrowRight,
  FileCode,
  FolderGit2,
  Code2,
  BookOpen,
  Sparkles,
  Terminal,
  X,
  Check,
  Square,
  RefreshCw,
} from 'lucide-vue-next';
import type { AppState, Snippet, Candidate } from '../../../shared/types';
import { api, boot, getState, prepareWebview, streamAI, subscribe } from './lib/api';
import { Button } from './components/ui/button';
import CodeBlock from './components/CodeBlock.vue';
import Studio from './components/Studio.vue';
import Settings from './components/Settings.vue';
const { t, te, locale } = useI18n();
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
const compact = boot.compact;
const filterAll = '__ding_all__';
function toggleSelection(id: string, checked: boolean | 'indeterminate') {
  selectedIds.value =
    checked === true
      ? [...new Set([...selectedIds.value, id])]
      : selectedIds.value.filter((value) => value !== id);
}
function toggleCandidate(index: number, checked: boolean | 'indeterminate') {
  candidateSelection.value =
    checked === true
      ? [...new Set([...candidateSelection.value, index])]
      : candidateSelection.value.filter((value) => value !== index);
}
const openWorkbench = () => window.__VSCODE__?.postMessage({ type: 'openWeb' });
const view = ref<'gallery' | 'live' | 'settings'>(compact ? 'live' : 'gallery');
const state = ref<AppState>(),
  all = ref<Snippet[]>([]),
  snippets = ref<Snippet[]>([]),
  selected = ref<Snippet>(),
  dirty = ref(false);
const query = ref(''),
  project = ref(''),
  language = ref(''),
  tag = ref(''),
  connected = ref(false),
  loading = ref(true),
  error = ref('');
const searchInput = ref<InstanceType<typeof Input>>();
const dark = ref(
  localStorage.getItem('ding-code.theme') === 'dark' ||
    (!localStorage.getItem('ding-code.theme') &&
      matchMedia('(prefers-color-scheme: dark)').matches),
);
const selectedIds = ref<string[]>([]),
  running = ref(false),
  candidates = ref<Candidate[]>([]),
  candidateSelection = ref<number[]>([]),
  scanId = ref(''),
  scanComplete = ref(false);
let controller: AbortController | undefined,
  unsubscribe: (() => void) | undefined,
  filterTimer: ReturnType<typeof setTimeout>,
  sequence = 0;
const projects = computed(() =>
  [...new Set(all.value.map((s) => s.project_name).filter(Boolean))].sort(),
);
const languages = computed(() => [...new Set(all.value.map((s) => s.language))].sort());
const tags = computed(() => [...new Set(all.value.flatMap((s) => s.tags))].sort());
const hasFilters = computed(() => !!(query.value || project.value || language.value || tag.value));
const stats = computed(() => [
  { icon: Bookmark, number: all.value.length, label: 'patterns' },
  { icon: FolderGit2, number: projects.value.length, label: 'projects' },
  { icon: Code2, number: languages.value.length, label: 'languages' },
  { icon: BookOpen, number: all.value.filter((s) => s.ai_article).length, label: 'articles' },
]);
function showError(value: unknown) {
  const message = value instanceof Error ? value.message : 'operationFailed';
  error.value = message.startsWith('providerHttp:')
    ? t('errors.providerHttp', { status: message.split(':')[1] })
    : t(te(`errors.${message}`) ? `errors.${message}` : 'errors.operationFailed');
}
async function loadState() {
  try {
    state.value = await getState();
  } catch (value) {
    showError(value);
  }
}
async function loadSnippets() {
  const id = ++sequence;
  const params = new URLSearchParams({
    query: query.value,
    project: project.value,
    language: language.value,
    tag: tag.value,
  });
  if (view.value === 'live') params.set('file', state.value?.activeFile ?? '__no_active_file__');
  try {
    const rows = await api<Snippet[]>(`snippets?${params}`);
    if (id !== sequence) return;
    snippets.value = rows;
    const collection = await api<Snippet[]>('snippets');
    if (id !== sequence) return;
    all.value = collection;
    selectedIds.value = selectedIds.value.filter((id) => all.value.some((s) => s.id === id));
    if (selected.value && !dirty.value)
      selected.value = all.value.find((s) => s.id === selected.value!.id);
  } catch (value) {
    showError(value);
  } finally {
    loading.value = false;
  }
}
function navigate(next: typeof view.value) {
  if (dirty.value) return;
  selected.value = undefined;
  view.value = next;
}
async function choose(snippet: Snippet) {
  if (dirty.value) return;
  selected.value = snippet;
  if (compact)
    try {
      await api('open', { method: 'POST', body: JSON.stringify({ id: snippet.id }) });
    } catch (value) {
      showError(value);
    }
}
function clear() {
  query.value = '';
  project.value = '';
  language.value = '';
  tag.value = '';
}
watch([query, project, language, tag, view, () => state.value?.activeFile], () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(loadSnippets, 160);
});
watch(
  locale,
  (value) => {
    localStorage.setItem('ding-code.locale', value);
    document.documentElement.lang = value;
  },
  { immediate: true },
);
watch(
  dark,
  (value) => {
    document.documentElement.classList.toggle('dark', value);
    localStorage.setItem('ding-code.theme', value ? 'dark' : 'light');
  },
  { immediate: true },
);
function shortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (!dirty.value) {
      selected.value = undefined;
      view.value = 'gallery';
      setTimeout(() => searchInput.value?.$el.focus(), 0);
    }
  }
}
async function run(kind: 'scan' | 'article') {
  running.value = true;
  controller = new AbortController();
  scanComplete.value = false;
  try {
    const result = await streamAI(
      { kind, ...(kind === 'article' ? { ids: selectedIds.value } : {}), locale: locale.value },
      () => {},
      controller.signal,
    );
    if (kind === 'scan') {
      if (!result) throw new Error('invalidCandidates');
      candidates.value = result.candidates;
      scanId.value = result.scanId;
      candidateSelection.value = candidates.value.map((_, i) => i);
      scanComplete.value = true;
    } else {
      await loadSnippets();
      const first = all.value.find((s) => s.id === selectedIds.value[0]);
      if (first) selected.value = first;
      selectedIds.value = [];
    }
  } catch (value) {
    if (!controller.signal.aborted) showError(value);
  } finally {
    running.value = false;
  }
}
async function adopt() {
  try {
    await api('adopt', {
      method: 'POST',
      body: JSON.stringify({ scanId: scanId.value, indices: candidateSelection.value }),
    });
    candidates.value = [];
    scanComplete.value = false;
    await loadSnippets();
  } catch (value) {
    showError(value);
  }
}
onMounted(async () => {
  window.addEventListener('keydown', shortcut);
  if (!boot.token) {
    loading.value = false;
    return;
  }
  try {
    await prepareWebview();
  } catch (value) {
    showError(value);
    loading.value = false;
    return;
  }
  await loadState();
  await loadSnippets();
  if (state.value && !error.value) window.__VSCODE__?.postMessage({ type: 'ready' });
  unsubscribe = subscribe(
    (event) => {
      if (event.type === 'state') void loadState();
      if (event.type === 'changed') void loadSnippets();
      if (event.type === 'focus' && !dirty.value) {
        const row = all.value.find((s) => s.id === event.id);
        if (row) selected.value = row;
        else
          void loadSnippets().then(() => {
            selected.value = all.value.find((s) => s.id === event.id);
          });
      }
    },
    (value) => {
      connected.value = value;
    },
  );
});
onBeforeUnmount(() => {
  unsubscribe?.();
  controller?.abort();
  clearTimeout(filterTimer);
  window.removeEventListener('keydown', shortcut);
});
</script>
<template>
  <div class="app-shell" :class="{ compact }">
    <aside v-if="!compact" class="navigation">
      <a class="brand" href="#" @click.prevent="navigate('gallery')">
        <span class="brand-mark"><Bookmark :size="23" stroke-width="1.6" /></span>
        <span>
          Ding Code
          <span class="brand-dot">.</span>
        </span>
      </a>
      <p class="brand-tagline">{{ t('tagline') }}</p>
      <div class="nav-section">{{ t('workspace') }}</div>
      <nav>
        <Button
          variant="ghost"
          :class="{ active: view === 'gallery' }"
          :disabled="dirty"
          @click="navigate('gallery')"
        >
          <LayoutGrid />
          {{ t('library') }}
          <span class="nav-count">{{ all.length }}</span>
        </Button>
        <Button :class="{ active: view === 'live' }" :disabled="dirty" @click="navigate('live')">
          <Radio />
          {{ t('live') }}
          <span class="live-indicator" />
        </Button>
        <Button
          :class="{ active: view === 'settings' }"
          :disabled="dirty"
          @click="navigate('settings')"
        >
          <Settings2 />
          {{ t('settings') }}
        </Button>
      </nav>
      <div class="sidebar-bottom">
        <div class="local-badge">
          <span class="local-dot" />
          {{ t('localFirst') }}
        </div>
        <p>{{ t('localOnly') }}</p>
        <span class="version">v{{ state?.version ?? '0.1.0' }}</span>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <div class="breadcrumb">
          <Bookmark v-if="compact" :size="17" />
          <span>{{ compact ? 'Ding Code' : t('workspace') }}</span>
          <span class="separator">/</span>
          <strong>
            {{ t(view === 'gallery' ? 'library' : view === 'live' ? 'live' : 'settings') }}
          </strong>
        </div>
        <div class="topbar-actions">
          <span v-if="!compact" class="connection" :class="{ disconnected: !connected }">
            <span />
            {{ connected ? t('online') : t('offline') }}
          </span>
          <Label class="locale-control" :title="t('language')">
            <Globe :size="16" />
            <Select v-model="locale">
              <SelectTrigger class="locale-trigger" :aria-label="t('language')">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-CN">简体中文</SelectItem>
                <SelectItem value="en-US">English</SelectItem>
              </SelectContent>
            </Select>
          </Label>
          <Button
            variant="ghost"
            size="icon"
            :title="t('theme')"
            :aria-label="t('theme')"
            @click="dark = !dark"
          >
            <Sun v-if="dark" />
            <Moon v-else />
          </Button>
          <Button
            v-if="compact"
            variant="ghost"
            size="icon"
            :title="t('openWorkbench')"
            :aria-label="t('openWorkbench')"
            @click="openWorkbench()"
          >
            <ArrowUpRight />
          </Button>
        </div>
      </header>
      <div v-if="error" class="error-banner" role="alert">
        <span>{{ error }}</span>
        <Button variant="ghost" size="icon" :aria-label="t('cancel')" @click="error = ''">
          <X />
        </Button>
      </div>
      <div v-if="!boot.token" class="empty-state">
        <Terminal :size="40" />
        <h2>Ding Code</h2>
        <p>{{ t('connectionRequired') }}</p>
      </div>
      <Studio
        v-else-if="selected"
        :key="selected.id"
        :snippet="selected"
        :ai-available="state?.ai.available ?? false"
        :compact="compact"
        @close="
          selected = undefined;
          dirty = false;
        "
        @dirty="dirty = $event"
        @changed="loadSnippets"
        @error="showError"
      />
      <main v-else class="content">
        <div v-if="compact" class="compact-nav">
          <Button
            v-for="item in ['gallery', 'live', 'settings'] as const"
            :key="item"
            :variant="view === item ? 'secondary' : 'ghost'"
            size="sm"
            @click="navigate(item)"
          >
            {{ t(item === 'gallery' ? 'library' : item === 'live' ? 'live' : 'settings') }}
          </Button>
        </div>
        <section v-if="!compact" class="page-heading">
          <div>
            <div class="eyebrow">
              <span class="tiny-line" />
              {{
                view === 'settings'
                  ? t('preferences')
                  : view === 'live'
                    ? t('live')
                    : t('collection')
              }}
            </div>
            <h1>
              {{
                t(view === 'settings' ? 'settingsTitle' : view === 'live' ? 'liveTitle' : 'title')
              }}
            </h1>
            <p>
              {{
                t(
                  view === 'settings'
                    ? 'settingsSubtitle'
                    : view === 'live'
                      ? 'liveSubtitle'
                      : 'subtitle',
                )
              }}
            </p>
          </div>
          <Button
            v-if="view !== 'settings'"
            variant="outline"
            :disabled="!state?.ai.available || running"
            :title="!state?.ai.available ? t('aiHint') : t('scan')"
            @click="run('scan')"
          >
            <Sparkles />
            {{ t('scan') }}
            <ArrowUpRight :size="14" />
          </Button>
        </section>
        <Settings
          v-if="view === 'settings' && state"
          :state="state"
          @changed="loadState"
          @error="showError"
        />
        <template v-else-if="view !== 'settings'">
          <div v-if="view === 'gallery' && !compact" class="stats-row">
            <div v-for="stat in stats" :key="stat.label" class="stat">
              <component :is="stat.icon" :size="17" />
              <span class="stat-number">{{ String(stat.number).padStart(2, '0') }}</span>
              <span>{{ t(stat.label) }}</span>
            </div>
          </div>
          <div v-if="view === 'live'" class="active-file">
            <FileCode :size="16" />
            <span>{{ state?.activeFile ?? t('noActive') }}</span>
            <Radio :size="14" />
          </div>
          <div class="collection-toolbar">
            <div class="search-field">
              <Search :size="17" />
              <Input
                ref="searchInput"
                v-model="query"
                :aria-label="t('search')"
                :placeholder="t('search')"
              />
              <kbd v-if="!compact">⌘ K / Ctrl K</kbd>
            </div>
            <div class="filter-row">
              <Select
                :model-value="project || filterAll"
                @update:model-value="project = $event === filterAll ? '' : String($event)"
              >
                <SelectTrigger :aria-label="t('projects')"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem :value="filterAll">{{ t('allProjects') }}</SelectItem>
                  <SelectItem v-for="p in projects" :key="p" :value="p">{{ p }}</SelectItem>
                </SelectContent>
              </Select>
              <Select
                :model-value="language || filterAll"
                @update:model-value="language = $event === filterAll ? '' : String($event)"
              >
                <SelectTrigger :aria-label="t('languages')"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem :value="filterAll">{{ t('allLanguages') }}</SelectItem>
                  <SelectItem v-for="l in languages" :key="l" :value="l">{{ l }}</SelectItem>
                </SelectContent>
              </Select>
              <Select
                :model-value="tag || filterAll"
                @update:model-value="tag = $event === filterAll ? '' : String($event)"
              >
                <SelectTrigger :aria-label="t('tags')"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem :value="filterAll">{{ t('allTags') }}</SelectItem>
                  <SelectItem v-for="tagName in tags" :key="tagName" :value="tagName">
                    {{ tagName }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button v-if="hasFilters" variant="ghost" size="sm" @click="clear">
                <X :size="14" />
                {{ t('clear') }}
              </Button>
            </div>
          </div>
          <div v-if="running" class="generation-status">
            <span class="pulse" />
            {{ t(selectedIds.length ? 'generating' : 'scanning') }}
            <Button variant="ghost" size="sm" @click="controller?.abort()">
              <Square />
              {{ t('stop') }}
            </Button>
          </div>
          <section v-if="scanComplete" class="candidates">
            <div class="section-heading">
              <h2>{{ t('candidates') }}</h2>
              <Button
                variant="ghost"
                size="icon"
                :aria-label="t('cancel')"
                @click="scanComplete = false"
              >
                <X />
              </Button>
            </div>
            <p v-if="!candidates.length">{{ t('noCandidates') }}</p>
            <Label v-for="(candidate, index) in candidates" :key="index" class="candidate">
              <Checkbox
                :model-value="candidateSelection.includes(index)"
                :aria-label="candidate.title"
                @update:model-value="toggleCandidate(index, $event)"
              />
              <div>
                <strong>{{ candidate.title }}</strong>
                <span class="mono">L{{ candidate.start_line }}–{{ candidate.end_line }}</span>
                <p>{{ candidate.reason }}</p>
              </div>
            </Label>
            <Button v-if="candidates.length" :disabled="!candidateSelection.length" @click="adopt">
              <Check />
              {{ t('adopt') }}
            </Button>
          </section>
          <div class="collection-meta">
            <span>
              {{ t('patterns') }}
              <b>{{ snippets.length }}</b>
            </span>
            <span v-if="!selectedIds.length" class="muted">{{ t('newest') }}</span>
            <div v-else class="selection-actions">
              <span>{{ t('selected', { count: selectedIds.length }) }}</span>
              <Button
                variant="secondary"
                size="sm"
                :disabled="!state?.ai.available || running || selectedIds.length > 10"
                :title="!state?.ai.available ? t('aiHint') : t('generateSelected')"
                @click="run('article')"
              >
                <BookOpen />
                {{ t('generateSelected') }}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                :aria-label="t('deselect')"
                @click="selectedIds = []"
              >
                <X />
              </Button>
            </div>
          </div>
          <div v-if="loading" class="loading-state"><RefreshCw class="spin" :size="24" /></div>
          <div v-else-if="!snippets.length" class="empty-state">
            <div class="empty-icon"><Bookmark :size="32" stroke-width="1.4" /></div>
            <h2>{{ t(hasFilters ? 'emptySearch' : 'emptyTitle') }}</h2>
            <p>{{ t(hasFilters ? 'emptySearchBody' : 'emptyBody') }}</p>
            <code v-if="!hasFilters">
              // ding-code:
              {{ locale === 'zh-CN' ? '值得学习的工程细节' : 'A detail worth learning' }}
            </code>
          </div>
          <div v-else class="pattern-grid">
            <Card v-for="snippet in snippets" :key="snippet.id" class="pattern-card">
              <div class="card-header">
                <span class="language-badge">
                  <span />
                  {{ snippet.language }}
                </span>
                <Label class="card-select">
                  <Checkbox
                    :model-value="selectedIds.includes(snippet.id)"
                    :aria-label="`${t('selected', { count: 1 })}: ${snippet.relative_path}`"
                    @update:model-value="toggleSelection(snippet.id, $event)"
                  />
                </Label>
              </div>
              <Button class="card-main" variant="ghost" @click="choose(snippet)">
                <CodeBlock :code="snippet.code_content" :language="snippet.language" preview />
                <div class="card-content">
                  <div class="card-project">
                    <FolderGit2 :size="13" />
                    {{ snippet.project_name || t('noProject') }}
                    <span>·</span>
                    {{ snippet.end_line - snippet.start_line + 1 }} {{ t('lines') }}
                  </div>
                  <h2>
                    {{
                      snippet.user_note.split('\n')[0].replace(/^#+\s*/, '') ||
                      snippet.relative_path
                    }}
                  </h2>
                  <p>
                    {{ snippet.user_note.split('\n').slice(1).join(' ').trim() || t('noNote') }}
                  </p>
                  <div class="tag-list">
                    <Badge
                      v-for="tagItem in snippet.tags.slice(0, 4)"
                      :key="tagItem"
                      variant="secondary"
                    >
                      {{ tagItem }}
                    </Badge>
                    <span v-if="!snippet.tags.length" class="source-tag">
                      {{
                        t(
                          snippet.source_type === 'comment_tag'
                            ? 'sourceComment'
                            : snippet.source_type === 'manual_selection'
                              ? 'sourceManual'
                              : 'sourceAI',
                        )
                      }}
                    </span>
                  </div>
                </div>
              </Button>
              <footer class="card-footer">
                <span>
                  <FileCode :size="13" />
                  {{ snippet.relative_path }}
                </span>
                <Button :title="t('note')" :aria-label="t('note')" @click="choose(snippet)">
                  <BookOpen v-if="snippet.ai_article" :size="15" />
                  <ArrowRight v-else :size="15" />
                </Button>
              </footer>
            </Card>
          </div>
          <div v-if="!compact" class="collection-footnote">
            <Terminal :size="14" />
            <span>{{ t('localOnly') }}</span>
            <span class="separator">/</span>
            <span>{{ t(state?.ai.available ? 'enabledStatus' : 'disabledStatus') }}</span>
          </div>
        </template>
      </main>
    </div>
  </div>
</template>
