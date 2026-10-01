import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Published at https://reginaldoke.github.io/Vocal-trainer/; locally from /.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/Vocal-trainer/" : "/",
  build: { outDir: "../dist", emptyOutDir: true },
}));
