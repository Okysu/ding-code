<script setup lang="ts">
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { onBeforeUnmount, ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Database,
  Download,
  KeyRound,
  Save,
  PlugZap,
  ShieldCheck,
  Trash2,
  Square,
} from 'lucide-vue-next';
import type { AppState } from '../../../../shared/types';
import { api, download, streamAI } from '../lib/api';
import { Button } from './ui/button';
const props = defineProps<{ state: AppState }>();
const emit = defineEmits<{ changed: []; error: [error: unknown] }>();
const { t, locale } = useI18n();
const form = ref({
  enabled: props.state.ai.enabled,
  baseUrl: props.state.ai.baseUrl,
  model: props.state.ai.model,
  protocol: props.state.ai.protocol,
  databasePath: props.state.databasePath,
  apiKey: '',
});
const saved = ref(false),
  busy = ref(false),
  tested = ref(false);
const controller = shallowRef<AbortController>();
onBeforeUnmount(() => controller.value?.abort());
async function save() {
  busy.value = true;
  try {
    const { apiKey, ...rest } = form.value;
    await api('settings', {
      method: 'POST',
      body: JSON.stringify({ ...rest, ...(apiKey ? { apiKey } : {}) }),
    });
    form.value.apiKey = '';
    saved.value = true;
    emit('changed');
    return true;
  } catch (error) {
    emit('error', error);
    return false;
  } finally {
    busy.value = false;
  }
}
async function clearKey() {
  try {
    await api('settings', { method: 'POST', body: JSON.stringify({ ...form.value, apiKey: '' }) });
    form.value.apiKey = '';
    emit('changed');
  } catch (error) {
    emit('error', error);
  }
}
async function test() {
  if (!(await save())) return;
  busy.value = true;
  const active = new AbortController();
  controller.value = active;
  try {
    await streamAI({ kind: 'test', locale: locale.value }, () => {}, active.signal);
    tested.value = true;
  } catch (error) {
    if (!active.signal.aborted) emit('error', error);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="settings-grid">
    <Card class="settings-card">
      <div class="section-icon"><Database /></div>
      <h2>{{ t('database') }}</h2>
      <p>{{ t('backupDescription') }}</p>
      <Label for="database-path">{{ t('databasePath') }}</Label>
      <Input id="database-path" v-model="form.databasePath" />
      <p class="field-help">{{ t('databaseHelp') }}</p>
      <div class="settings-actions">
        <Button
          variant="outline"
          @click="download('backup', 'knowledge.db').catch((error) => emit('error', error))"
        >
          <Download />
          {{ t('backup') }}
        </Button>
        <Button
          variant="ghost"
          @click="
            download('export', 'ding-code-backup.json').catch((error) => emit('error', error))
          "
        >
          {{ t('exportJson') }}
        </Button>
      </div>
    </Card>
    <Card class="settings-card">
      <div class="section-icon"><KeyRound /></div>
      <h2>{{ t('byok') }}</h2>
      <p>{{ t('aiDescription') }}</p>
      <Label class="switch-label" for="ai-enabled">
        <Switch id="ai-enabled" v-model="form.enabled" :aria-label="t('enabled')" />
        {{ t('enabled') }}
      </Label>
      <div class="form-grid">
        <div>
          <Label for="protocol">{{ t('protocol') }}</Label>
          <Select v-model="form.protocol">
            <SelectTrigger id="protocol"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="responses">OpenAI Responses</SelectItem>
              <SelectItem value="chat-completions">OpenAI Chat Completions</SelectItem>
              <SelectItem value="anthropic">Anthropic Messages</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label for="model">{{ t('model') }}</Label>
          <Input id="model" v-model="form.model" placeholder="model-id" autocomplete="off" />
        </div>
      </div>
      <Label for="base-url">{{ t('baseUrl') }}</Label>
      <Input
        id="base-url"
        v-model="form.baseUrl"
        placeholder="https://api.openai.com/v1"
        autocomplete="off"
      />
      <Label for="api-key">{{ t('apiKey') }}</Label>
      <Input
        id="api-key"
        v-model="form.apiKey"
        type="password"
        autocomplete="new-password"
        :placeholder="state.ai.hasKey ? t('keyPresent') : t('keyAbsent')"
      />
      <p class="field-help">{{ t('keyHelp') }}</p>
      <div class="privacy-note">
        <ShieldCheck :size="18" />
        <p>{{ t('aiPrivacy') }}</p>
      </div>
      <div class="settings-actions">
        <Button
          variant="outline"
          :disabled="busy || !form.enabled || !form.model || (!form.apiKey && !state.ai.hasKey)"
          @click="test"
        >
          <PlugZap />
          {{ t('test') }}
        </Button>
        <Button variant="ghost" :disabled="busy || !state.ai.hasKey" @click="clearKey">
          <Trash2 />
          {{ t('clearKey') }}
        </Button>
        <Button v-if="busy && controller" variant="ghost" @click="controller.abort()">
          <Square />
          {{ t('stop') }}
        </Button>
      </div>
      <p v-if="tested" class="success-text">{{ t('testSuccess') }}</p>
    </Card>
    <div class="settings-save">
      <span class="save-status">{{ saved ? t('saved') : '' }}</span>
      <Button :disabled="busy" @click="save">
        <Save />
        {{ busy ? t('saving') : t('save') }}
      </Button>
    </div>
  </div>
</template>
