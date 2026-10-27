import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./firebase-pages/", import.meta.url));
const appRoot = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  root,
  base: process.env.VITE_BASE_PATH || (process.env.GITHUB_REPOSITORY ? `/${process.env.GITHUB_REPOSITORY.split("/").at(-1)}/` : "/"),
  publicDir: fileURLToPath(new URL("./public/", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\//, replacement: appRoot },
      { find: /^\.\/auth-context$/, replacement: `${root}auth-context.tsx` },
      { find: /^\.\/settings-module$/, replacement: `${root}settings-module.tsx` },
      { find: /^\.\/offline-status$/, replacement: `${root}offline-status.tsx` },
      { find: /^\.\/osint-module$/, replacement: `${root}osint-module.tsx` },
    ],
  },
  build: { outDir: fileURLToPath(new URL("./firebase-pages-dist/", import.meta.url)), emptyOutDir: true },
});
