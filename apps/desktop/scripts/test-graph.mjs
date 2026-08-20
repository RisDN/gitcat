import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const entryPoints = [
  fileURLToPath(new URL("../tests/columns.test.ts", import.meta.url)),
  fileURLToPath(new URL("../tests/graphPresentation.test.ts", import.meta.url)),
  fileURLToPath(new URL("../tests/themePresets.test.ts", import.meta.url)),
];

for (const entryPoint of entryPoints) {
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
}
