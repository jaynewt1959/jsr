import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Release builds strip dev tooling and source maps.
// Xcode preBuildScript passes VITE_APP_CONFIG=$CONFIGURATION.
const releaseBuild = process.env.VITE_APP_CONFIG === "Release";

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(
      new Date().toISOString().slice(0, 16).replace("T", " ")
    ),
    __DEV_TOOLS__: JSON.stringify(!releaseBuild),
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:8089",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: !releaseBuild,
  },
});
