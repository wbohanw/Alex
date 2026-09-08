import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3901,
    proxy: {
      "/api": "http://localhost:3900",
      "/auth": "http://localhost:3900",
    },
  },
});
