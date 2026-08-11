import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 8788,
    proxy: {
      "/cloud": {
        target: process.env.VITE_GATEWAY_PROXY || "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
