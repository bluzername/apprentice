/**
 * Builds the extension into dist/: background.js and popup.js as ES modules
 * (shared chunks allowed), then content.js as a self-contained IIFE because
 * content scripts cannot import modules. Manifest, icons, and popup assets are
 * generated after the main bundle so the zip step sees a complete folder.
 */
import { copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, defineConfig, type Plugin } from "vite";
import { writeManifest } from "./scripts/generate-manifest";
import { writeIcons } from "./scripts/icons";

const root = dirname(fileURLToPath(import.meta.url));
const distDir = join(root, "dist");
const target = "chrome120";

function extensionAssets(): Plugin {
  return {
    name: "apprentice-extension-assets",
    apply: "build",
    async closeBundle() {
      await writeManifest(distDir);
      const icons = await writeIcons(distDir);
      await copyFile(join(root, "src/popup/popup.html"), join(distDir, "popup.html"));
      await copyFile(join(root, "src/popup/popup.css"), join(distDir, "popup.css"));
      await build({
        configFile: false,
        root,
        logLevel: "warn",
        build: {
          outDir: distDir,
          emptyOutDir: false,
          target,
          minify: false,
          sourcemap: false,
          lib: {
            entry: resolve(root, "src/content/content.ts"),
            formats: ["iife"],
            name: "ApprenticeContent",
            fileName: () => "content.js"
          }
        }
      });
      console.log(`[apprentice] manifest, popup, content.js and icons (${icons.renderer}) written to ${distDir}`);
    }
  };
}

export default defineConfig({
  root,
  base: "/",
  build: {
    outDir: distDir,
    emptyOutDir: true,
    target,
    minify: false,
    sourcemap: false,
    modulePreload: false,
    rollupOptions: {
      input: {
        background: resolve(root, "src/background/index.ts"),
        popup: resolve(root, "src/popup/popup.ts")
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  },
  plugins: [extensionAssets()]
});
