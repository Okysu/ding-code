<script setup lang="ts">
import {
  ResizablePanelGroup as SplitterGroup,
  ResizablePanel as SplitterPanel,
  ResizableHandle,
} from './resizable';
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });
</script>
<template>
  <SplitterGroup :direction="compact ? 'vertical' : 'horizontal'" class="panel-group">
    <SplitterPanel :default-size="42" :min-size="24" class="split-panel source-panel">
      <slot name="left" />
    </SplitterPanel>
    <ResizableHandle with-handle class="resize-handle" />
    <SplitterPanel :default-size="58" :min-size="30" class="split-panel reader-panel">
      <slot name="right" />
    </SplitterPanel>
  </SplitterGroup>
</template>
