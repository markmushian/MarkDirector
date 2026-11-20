<template>
  <el-dialog v-model="visible" class="homeAssetLibraryDialog" title="素材库" width="min(1440px, 88vw)" alignCenter appendToBody destroyOnClose>
    <div class="libraryShell">
      <div class="libraryTabs" role="tablist" aria-label="素材库视图">
        <button type="button" role="tab" :aria-selected="view === 'project'" :class="{ active: view === 'project' }" @click="view = 'project'">项目资产</button>
        <button type="button" role="tab" :aria-selected="view === 'files'" :class="{ active: view === 'files' }" @click="view = 'files'">全部文件</button>
      </div>
      <div class="libraryBody">
        <projectAssetLibrary v-if="view === 'project'" class="libraryPane" :directory="directory" />
        <assetLibrary v-else v-model="visible" class="libraryPane" expanded />
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import assetLibrary from "@/pages/workspace/panels/canvas/components/assetLibrary.vue";
import { useWorkspaceStore } from "@/stores/workspace";
import projectAssetLibrary from "./projectAssetLibrary.vue";

const visible = defineModel<boolean>({ default: false });
const view = ref<"project" | "files">("project");
const { project } = storeToRefs(useWorkspaceStore());
const directory = computed(() => project.value?.directory ?? "");
</script>

<style lang="scss">
.homeAssetLibraryDialog.el-dialog {
  display: flex;
  flex-direction: column;
  height: 84dvh;
  max-height: calc(100dvh - 32px);
  overflow: hidden;
  .el-dialog__header { flex-shrink: 0; }

  .el-dialog__body { display: flex; flex: 1; min-width: 0; min-height: 0; padding: 0; overflow: hidden; }

  .libraryShell { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }

  .libraryTabs {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    padding: 10px 16px 0;
    border-bottom: 1px solid var(--el-border-color-lighter);

    button {
      padding: 8px 4px 10px;
      margin-inline-end: 16px;
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--el-text-color-secondary);
      font: inherit;
      font-size: 13px;
      cursor: pointer;

      &.active { border-bottom-color: var(--md-gold); color: var(--el-text-color-primary); }
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
    }
  }

  .libraryBody { display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
  .libraryPane { flex: 1; min-width: 0; min-height: 0; }

  @media (max-width: 700px) {
    width: calc(100vw - 24px);
    height: calc(100dvh - 32px);
  }
}
</style>
