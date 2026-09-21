import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        how: resolve(__dirname, "how.html"),
        app: resolve(__dirname, "app.html"),
      },
    },
  },
});
