import { build } from "vite";
await build({
  build: { outDir: ".out-final", emptyOutDir: false },
  logLevel: "warn",
});
console.log("BUILD_DONE");
