import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const isWeb = process.env.BUILD_TARGET === "web";

export default defineConfig({
  clearScreen: false,
  build: {
    outDir: isWeb ? "dist-web" : "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: isWeb ? "web.html" : "index.html"
    }
  },
  resolve: {
    alias: {
      react: fileURLToPath(new URL("./node_modules/react", import.meta.url)),
      "react-dom": fileURLToPath(new URL("./node_modules/react-dom", import.meta.url))
    },
    dedupe: ["react", "react-dom"]
  },
  server: {
    port: 1420,
    strictPort: true
  }
});
