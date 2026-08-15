import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const entryPoint = fileURLToPath(new URL("../tests/graphPresentation.test.ts", import.meta.url));
const result = await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
});
const source = result.outputFiles[0].text;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

await import(moduleUrl);
