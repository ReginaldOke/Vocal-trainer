import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Published beside the full app at https://reginaldoke.github.io/Vocal-trainer/simple/; locally from /.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/Vocal-trainer/simple/" : "/",
  build: { outDir: "../dist/simple", emptyOutDir: true },
}));
