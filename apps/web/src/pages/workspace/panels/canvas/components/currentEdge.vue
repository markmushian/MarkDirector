<template>
  <simple-bezier-edge v-bind="props" />
  <path class="edgeCurrentGlow" :d="path" pathLength="100" />
  <path class="edgeCurrentCore" :d="path" pathLength="100" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { getSimpleBezierPath, SimpleBezierEdge, type EdgeProps } from "@vue-flow/core";

const props = defineProps<EdgeProps>();
const path = computed(() => getSimpleBezierPath(props)[0]);
</script>
