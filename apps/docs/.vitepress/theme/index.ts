import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import MermaidChart from "./MermaidChart.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("MermaidChart", MermaidChart);
  }
} satisfies Theme;
