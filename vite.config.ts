import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The earlier, full app. It is published under /full/ beside the simple app, which now has the
// main address https://reginaldoke.github.io/Vocal-trainer/. Locally it is served from /.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/Vocal-trainer/full/" : "/",
  build: { outDir: "dist/full" },
}));
