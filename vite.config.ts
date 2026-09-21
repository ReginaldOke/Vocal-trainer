import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://reginaldoke.github.io/Vocal-trainer/ on GitHub Pages; locally from /.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/Vocal-trainer/" : "/",
}));
