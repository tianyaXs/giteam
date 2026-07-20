import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";

const isWeb = process.env.BUILD_TARGET === "web";

export default defineConfig({
  clearScreen: false,
  plugins: [tailwindcss()],
  build: {
    outDir: isWeb ? "dist-web" : "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: isWeb ? "web.html" : "index.html",
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/monaco-editor") || id.includes("node_modules/@monaco-editor")) {
            return "monaco";
          }
          if (id.includes("node_modules/react-markdown") || id.includes("node_modules/remark-") || id.includes("node_modules/rehype-")) {
            return "markdown";
          }
        }
      }
    }
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      react: fileURLToPath(new URL("./node_modules/react", import.meta.url)),
      "react-dom": fileURLToPath(new URL("./node_modules/react-dom", import.meta.url))
    },
    dedupe: ["react", "react-dom"]
  },
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5100",
        changeOrigin: true,
      },
      // The web preview talks to the Remote Repo Service through Vite instead
      // of calling it cross-origin. Set REMOTE_REPO_SERVICE_URL in the dev
      // environment; production should use VITE_REMOTE_REPO_SERVICE_URL or a
      // same-origin reverse-proxy route.
      "/remote-repo-service": {
        target: process.env.REMOTE_REPO_SERVICE_URL || "http://127.0.0.1:8765",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/remote-repo-service/, ""),
      },
    },
  }
});
