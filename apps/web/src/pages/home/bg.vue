<template>
  <div class="studioBackdrop" aria-hidden="true"><img :src="logoUrl" alt="" /></div>
</template>

<script setup lang="ts">
import logoUrl from "@markdirector/assets/logo.svg";
defineProps<{ scrollTop: number }>();
</script>

<style scoped lang="scss">
.studioBackdrop {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background-image: linear-gradient(90deg, color-mix(in srgb, var(--el-border-color) 23%, transparent) 1px, transparent 1px),
    linear-gradient(color-mix(in srgb, var(--el-border-color) 23%, transparent) 1px, transparent 1px);
  background-size: 42px 42px;

  img {
    position: absolute;
    top: 6%;
    right: -4%;
    width: min(48%, 520px);
    opacity: .18;
    transform: rotate(-12deg);
    filter: saturate(.6);
  }
}
</style>
