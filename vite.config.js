import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { resolve } from "path";
import macrosPlugin from "vite-plugin-babel-macros";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { filePlugin } from "./vite-file-plugin.js";

// https://vitejs.dev/config/
export default defineConfig({
  base: "",
  root: "src",
  plugins: [
    macrosPlugin(),
    preact(),
    nodePolyfills({
      include: ["path"],
    }),
    filePlugin(),
  ],
  optimizeDeps: {
    include: [
      '@tauri-apps/plugin-dialog',
      '@tauri-apps/plugin-fs',
      '@tauri-apps/plugin-shell',
      '@tauri-apps/plugin-opener',
    ]
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: [resolve(import.meta.dirname, "src/MystEditor.jsx"), resolve(import.meta.dirname, "src/index.html"), resolve(import.meta.dirname, "src/myst-git/git.html")],
      formats: ["es"],
    },
    rollupOptions: {
      output: {
        assetFileNames: "MystEditor.css",
        manualChunks: (id) => {
          if (id.includes("index.html")) return "index";
          if (id.includes("myst-git/git.html") || id.includes("myst-git/demo-data") || id.includes("myst-git/stubGitBackend")) {
            return "git";
          }
          return "MystEditor";
        },
      },
    },
  },
  define: {
    "process.env": {},
  },
  // https://github.com/redhat-developer/yaml-language-server/issues/1014
  resolve: {
    alias: [
      {
        find: "vscode-json-languageservice/lib/umd",
        replacement: "vscode-json-languageservice/lib/esm",
      },
    ],
  },
});
