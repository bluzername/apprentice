import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const nodeBuiltins = ["node:sqlite", "sqlite"];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@apprentice/schemas", "@apprentice/core", "@apprentice/model-adapters", "@apprentice/test-fixtures"] })],
    build: {
      rollupOptions: { external: nodeBuiltins, input: { index: resolve(__dirname, "src/main/index.ts") } },
      sourcemap: true
    },
    resolve: { alias: { "@main": resolve(__dirname, "src/main") } }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@apprentice/schemas"] })],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/preload/index.ts") }, output: { format: "cjs" } },
      sourcemap: true
    }
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/renderer/index.html") } },
      sourcemap: true
    },
    resolve: { alias: { "@renderer": resolve(__dirname, "src/renderer/src") } }
  }
});
