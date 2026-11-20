<template>
  <el-card class="projectCard" shadow="never" :bodyStyle="{ padding: '0', height: '100%' }">
    <button class="projectEntry" type="button" :disabled="disabled" :title="project.directory" :aria-label="`${translate(actionLabel)} ${project.name}`" @click="emit('select')">
      <span class="projectCoverArea">
        <projectCover :directory="project.directory" ratio="16 / 9" />
        <span class="projectStatus" :data-status="status"><i aria-hidden="true" />{{ statusText }}</span>
        <span class="projectRatio">{{ aspect }}</span>
      </span>
      <span class="projectInfo">
        <span class="projectName" :title="project.name">{{ project.name }}</span>
        <span v-if="styleName || counts" class="projectTags">
          <span v-if="styleName" class="projectStyle">{{ styleName }}</span>
          <span v-if="counts" class="projectCounts">{{ counts }}</span>
        </span>
        <span class="projectTime" :title="fullTime">最近打开 {{ shortTime }}</span>
      </span>
    </button>
    <el-dropdown v-if="$slots.actions" class="projectActions" :class="{ actionsVisible: menuVisible || actionsLoading }" trigger="click" placement="bottom-end" :showArrow="false" :disabled="disabled" @visibleChange="menuVisible = $event">
      <el-button class="projectMenuButton" text :icon="IconDotsVertical" :loading="actionsLoading" :disabled="disabled" aria-label="更多操作" title="更多操作" />
      <template #dropdown>
        <el-dropdown-menu class="projectActionMenu" :aria-label="project.name">
          <el-dropdown-item :icon="IconFolderOpen" :disabled="disabled" @click="emit('select')">打开</el-dropdown-item>
          <slot name="actions" />
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </el-card>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { IconDotsVertical, IconFolderOpen } from "@tabler/icons-vue";
import { locale, translate } from "@markdirector/i18n/vue";
import type { Project } from "@/stores/workspace";
import { PROJECT_STATUS_TEXT, projectAssetCount, projectEpisodeCount, projectStatus, projectStyleName, type ProjectMeta } from "@/lib/projectMeta";
import projectCover from "./projectCover.vue";

const props = withDefaults(defineProps<{
  project: Project;
  meta?: ProjectMeta | null;
  disabled?: boolean;
  actionLabel?: string;
  actionsLoading?: boolean;
}>(), { actionLabel: "打开项目", meta: null });
const emit = defineEmits<{ select: [] }>();
const menuVisible = ref(false);

const status = computed(() => projectStatus(props.meta));
const statusText = computed(() => PROJECT_STATUS_TEXT[status.value]);
const aspect = computed(() => props.meta?.aspect ?? "16:9");
const styleName = computed(() => props.meta ? projectStyleName(props.meta.style) : "");
const counts = computed(() => {
  const parts: string[] = [];
  const characters = projectAssetCount(props.meta, "characters");
  const scenes = projectAssetCount(props.meta, "scenes");
  const episodes = projectEpisodeCount(props.meta);
  if (characters) parts.push(`${characters} 角色`);
  if (scenes) parts.push(`${scenes} 场景`);
  if (episodes) parts.push(`${episodes} 集`);
  return parts.join(" · ");
});
const fullTime = computed(() => new Date(props.project.lastOpenedAt).toLocaleString(locale.value, { hour12: false }));
const shortTime = computed(() => {
  const date = new Date(props.project.lastOpenedAt);
  if (!Number.isFinite(date.getTime())) return "";
  const month = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === new Date().getFullYear() ? month : `${date.getFullYear()}年${month}`;
});
</script>

<style lang="scss" scoped>
.projectCard {
  position: relative;
  overflow: hidden;
  border-radius: calc(var(--ui-radius) * 2.5);
  border-color: var(--el-border-color-lighter);
  background: color-mix(in srgb, var(--el-bg-color-overlay) 70%, transparent);
  box-shadow: var(--el-box-shadow-lighter);
  transition: border-color 0.18s ease, transform 0.18s ease;

  &:hover { border-color: var(--el-border-color-light); }
  &:focus-within { border-color: var(--el-color-primary-light-5); }

  .projectEntry {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 214px;
    padding: 0;
    border: 0;
    border-radius: calc(var(--ui-radius) * 2.5);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;

    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
    &:disabled { cursor: wait; opacity: 0.6; }

    .projectCoverArea {
      position: relative;
      display: block;
      width: 100%;
      overflow: hidden;
      border-radius: calc(var(--ui-radius) * 2.5) calc(var(--ui-radius) * 2.5) 0 0;

      .projectStatus,
      .projectRatio {
        position: absolute;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border-radius: 999px;
        font-size: 11px;
        line-height: 1;
        letter-spacing: 0.01em;
        backdrop-filter: blur(6px);
      }

      .projectStatus {
        top: 10px;
        left: 10px;
        padding: 5px 9px;
        background: rgba(16, 18, 22, 0.62);
        color: rgba(255, 255, 255, 0.88);

        i {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentcolor;
        }

        &[data-status="producing"] {
          background: color-mix(in srgb, var(--md-gold) 24%, rgba(16, 18, 22, 0.72));
          color: var(--md-gold-soft);
        }

        &[data-status="done"] {
          background: color-mix(in srgb, #3fae74 24%, rgba(16, 18, 22, 0.72));
          color: #a8e6c2;
        }
      }

      .projectRatio {
        right: 10px;
        bottom: 10px;
        padding: 4px 8px;
        border-radius: 6px;
        background: rgba(16, 18, 22, 0.58);
        color: rgba(255, 255, 255, 0.82);
        font-variant-numeric: tabular-nums;
      }
    }

    .projectInfo {
      display: flex;
      flex-direction: column;
      gap: 7px;
      width: 100%;
      min-width: 0;
      margin-top: auto;
      padding: 12px 14px 14px;

      .projectName {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.45;
      }

      .projectTags {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;

        .projectStyle {
          flex-shrink: 0;
          padding: 1px 7px;
          border: 1px solid color-mix(in srgb, var(--md-gold) 45%, transparent);
          border-radius: 5px;
          color: var(--md-gold);
          font-size: 11px;
          line-height: 1.6;
        }

        .projectCounts {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--el-text-color-secondary);
          font-size: 12px;
          line-height: 1.6;
        }
      }

      .projectTime {
        color: var(--el-text-color-secondary);
        font-size: 12px;
        line-height: 1.5;
        opacity: 0.82;
      }
    }
  }

  .projectActions {
    position: absolute;
    top: 10px;
    right: 10px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;

    .projectMenuButton {
      width: 30px;
      height: 30px;
      margin: 0;
      padding: 0;
      border-radius: var(--ui-radius);
      background: rgba(16, 18, 22, 0.6);
      color: rgba(255, 255, 255, 0.9);

      &:hover:not(:disabled), &[aria-expanded="true"] {
        background: rgba(16, 18, 22, 0.82);
        color: #fff;
      }

      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
    }
  }

  &:hover .projectActions, &:focus-within .projectActions, .projectActions.actionsVisible { opacity: 1; pointer-events: auto; }

  @media (hover: none), (any-pointer: coarse) {
    .projectActions { opacity: 1; pointer-events: auto; }
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
    .projectActions { transition: none; }
  }
}

.projectActionMenu {
  min-width: 170px;

  :deep(.removeAction:not(.is-disabled)) {
    color: var(--el-color-danger);
  }
}
</style>
