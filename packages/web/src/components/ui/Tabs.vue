<script setup lang="ts">
import { Tabs as TabsRoot, TabsList, TabsTrigger, TabsContent } from './tabs';
defineProps<{ modelValue: string; items: { value: string; label: string }[] }>();
defineEmits<{ 'update:modelValue': [value: string] }>();
</script>
<template>
  <TabsRoot
    :model-value="modelValue"
    class="tabs-root"
    @update:model-value="$emit('update:modelValue', String($event))"
  >
    <TabsList class="tabs-list">
      <TabsTrigger v-for="item in items" :key="item.value" :value="item.value" class="tabs-trigger">
        {{ item.label }}
      </TabsTrigger>
    </TabsList>
    <TabsContent v-for="item in items" :key="item.value" :value="item.value" class="tabs-content">
      <slot :name="item.value" />
    </TabsContent>
  </TabsRoot>
</template>
