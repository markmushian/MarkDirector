<template>
  <teleport to="body">
    <div v-if="visible" class="loadingPage" :class="{ filling }" role="status" aria-label="正在加载项目" @animationend.self="finishFilling">
      <div class="openingFrame" aria-hidden="true">
        <img class="openingMark" :src="logoUrl" alt="" @animationend.self="finishDrawing" />
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import logoUrl from "@markdirector/assets/logo.svg";

const props = defineProps<{ active: boolean }>();
const visible = defineModel<boolean>("visible", { default: false });
const drawn = defineModel<boolean>("drawn", { default: false });
const filling = ref(false);
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const reducedMotion = ref(motionPreference.matches);

function updateMotionPreference(event: MediaQueryListEvent) {
  reducedMotion.value = event.matches;
}
motionPreference.addEventListener("change", updateMotionPreference);
// ACT: WebView 隐藏、系统减少动画或窗口失焦时 CSS animationend 可能不触发，
// 首页会一直等 drawn 而不跳转。用定时器兜底放行，动画正常触发时立即由 finishDrawing 提前置位。
let drawTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => {
  motionPreference.removeEventListener("change", updateMotionPreference);
  clearTimeout(drawTimer);
});

watch([() => props.active, reducedMotion], ([active, reducedMotion]) => {
  clearTimeout(drawTimer);
  if (active) {
    if (!visible.value) {
      drawn.value = false;
      visible.value = true;
    }
    filling.value = false;
    drawTimer = setTimeout(() => {
      if (drawn.value) return;
      drawn.value = true;
      if (!props.active) filling.value = true;
    }, 900);
  }
  if (reducedMotion) {
    drawn.value = true;
    if (!active) visible.value = false;
  } else if (!active && drawn.value && visible.value) {
    filling.value = true;
  }
}, { immediate: true });

function finishDrawing() {
  drawn.value = true;
  if (!props.active) filling.value = true;
}

function finishFilling() {
  if (!props.active) visible.value = false;
}
</script>

<style lang="scss" scoped>
.loadingPage {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  background: var(--el-bg-color);

  &.filling { animation: studioFade 240ms ease both; }
}

.openingFrame {
  position: relative;
  display: grid;
  place-items: center;
  width: min(68vw, 440px);
  aspect-ratio: 2.35;
  isolation: isolate;

  &::before, &::after {
    position: absolute;
    content: "";
    inset: 0;
    border: 1px solid var(--el-border-color-dark);
    animation: frameOpen 620ms cubic-bezier(.2,.72,.28,1) both;
  }
  &::after {
    inset: 10px;
    border-color: color-mix(in srgb, var(--el-color-primary) 45%, transparent);
    animation-delay: 65ms;
  }
}

.openingMark {
  width: clamp(66px, 12vw, 94px);
  animation: markReveal 610ms cubic-bezier(.2,.72,.28,1) both;
}

@keyframes frameOpen {
  from { opacity: 0; clip-path: inset(46% 43%); transform: scaleX(.55); }
  to { opacity: .85; clip-path: inset(0); transform: scaleX(1); }
}
@keyframes markReveal {
  0%, 14% { opacity: 0; clip-path: inset(49% 0); transform: scale(.78); }
  100% { opacity: 1; clip-path: inset(0); transform: scale(1); }
}
@keyframes studioFade { to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .loadingPage.filling, .openingFrame::before, .openingFrame::after, .openingMark { animation: none; }
}
</style>
