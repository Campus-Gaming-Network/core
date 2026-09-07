<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useData } from "vitepress";
import { renderMermaid } from "./mermaid";

const MINIMUM_ZOOM = 50;
const MAXIMUM_ZOOM = 300;
const ZOOM_STEP = 25;

const properties = defineProps<{
  encoded: string;
}>();

const frame = ref<HTMLElement | null>(null);
const chart = ref<HTMLElement | null>(null);
const error = ref<string | null>(null);
const zoom = ref(100);
const isFullscreen = ref(false);
const { isDark } = useData();
const canZoomOut = computed(() => zoom.value > MINIMUM_ZOOM);
const canZoomIn = computed(() => zoom.value < MAXIMUM_ZOOM);

function decodeSource(encoded: string) {
  const bytes = Uint8Array.from(atob(encoded), (character) =>
    character.charCodeAt(0)
  );
  return new TextDecoder().decode(bytes);
}

async function renderChart() {
  await nextTick();
  const chartElement = chart.value;
  if (!chartElement) return;

  error.value = null;
  chartElement.replaceChildren();

  try {
    const result = await renderMermaid(
      decodeSource(properties.encoded),
      isDark.value
    );
    if (chart.value !== chartElement) return;

    chartElement.innerHTML = result.svg;
    result.bindFunctions?.(chartElement);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Unable to render diagram";
  }
}

function changeZoom(amount: number) {
  zoom.value = Math.min(
    MAXIMUM_ZOOM,
    Math.max(MINIMUM_ZOOM, zoom.value + amount)
  );
}

function resetZoom() {
  zoom.value = 100;
}

function updateFullscreenState() {
  isFullscreen.value = document.fullscreenElement === frame.value;
}

async function toggleFullscreen() {
  if (document.fullscreenElement === frame.value) {
    await document.exitFullscreen();
    return;
  }

  await frame.value?.requestFullscreen();
}

onMounted(renderChart);
onMounted(() => document.addEventListener("fullscreenchange", updateFullscreenState));
onBeforeUnmount(() =>
  document.removeEventListener("fullscreenchange", updateFullscreenState)
);
watch(isDark, renderChart);
</script>

<template>
  <figure ref="frame" class="mermaid-frame">
    <figcaption class="mermaid-toolbar">
      <span class="mermaid-toolbar-label">Diagram</span>
      <div class="mermaid-controls" aria-label="Diagram controls">
        <button
          type="button"
          class="mermaid-control mermaid-zoom-button"
          :disabled="!canZoomOut"
          aria-label="Zoom out"
          title="Zoom out"
          @click="changeZoom(-ZOOM_STEP)"
        >
          −
        </button>
        <button
          type="button"
          class="mermaid-control mermaid-zoom-level"
          aria-label="Reset zoom"
          title="Reset zoom"
          @click="resetZoom"
        >
          {{ zoom }}%
        </button>
        <button
          type="button"
          class="mermaid-control mermaid-zoom-button"
          :disabled="!canZoomIn"
          aria-label="Zoom in"
          title="Zoom in"
          @click="changeZoom(ZOOM_STEP)"
        >
          +
        </button>
        <button
          type="button"
          class="mermaid-control mermaid-fullscreen-button"
          :aria-label="isFullscreen ? 'Exit full screen' : 'Enter full screen'"
          :title="isFullscreen ? 'Exit full screen' : 'Enter full screen'"
          @click="toggleFullscreen"
        >
          <span aria-hidden="true">⛶</span>
          {{ isFullscreen ? "Exit" : "Full screen" }}
        </button>
      </div>
    </figcaption>
    <div class="mermaid-viewport">
      <div
        ref="chart"
        class="mermaid-chart"
        :style="{ width: `${zoom}%` }"
        aria-label="Architecture diagram"
      />
    </div>
    <pre v-if="error" class="mermaid-error">{{ error }}</pre>
  </figure>
</template>
