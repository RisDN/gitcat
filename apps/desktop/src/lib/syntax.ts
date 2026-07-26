import type { HighlighterCore, ThemeRegistrationRaw } from "shiki/core";

export type SyntaxClass =
  | "plain"
  | "comment"
  | "keyword"
  | "string"
  | "number"
  | "boolean"
  | "function"
  | "type"
  | "variable"
  | "property"
  | "operator"
  | "punctuation"
  | "tag"
  | "attribute"
  | "regexp"
  | "constant";

export interface SyntaxToken {
  text: string;
  cls: SyntaxClass;
}

const SCOPE_GROUPS: readonly (readonly [SyntaxClass, readonly string[]])[] = [
  ["plain", []],
  ["variable", ["variable", "variable.other", "support.variable"]],
  ["punctuation", ["punctuation", "meta.brace", "punctuation.separator", "punctuation.terminator"]],
  ["operator", ["keyword.operator"]],
  ["keyword", [
    "keyword",
    "keyword.control",
    "storage",
    "storage.type",
    "storage.modifier",
    "variable.language",
    "keyword.operator.new",
    "keyword.operator.expression",
    "entity.name.namespace",
  ]],
  ["type", [
    "entity.name.type",
    "entity.name.class",
    "entity.other.inherited-class",
    "support.type",
    "support.class",
    "storage.type.primitive",
    "entity.name.scope-resolution",
  ]],
  ["function", [
    "entity.name.function",
    "support.function",
    "variable.function",
    "meta.function-call",
    "entity.name.function.macro",
  ]],
  ["property", [
    "variable.other.property",
    "variable.other.object.property",
    "meta.object-literal.key",
    "support.type.property-name",
    "entity.name.tag.yaml",
    "entity.name.label",
  ]],
  ["constant", ["constant", "constant.character.escape", "support.constant"]],
  ["number", ["constant.numeric"]],
  ["boolean", ["constant.language"]],
  ["string", [
    "string",
    "punctuation.definition.string",
    "string.template",
    "punctuation.definition.template-expression",
    "markup.inline.raw",
  ]],
  ["regexp", ["string.regexp", "punctuation.definition.group.regexp"]],
  ["tag", ["entity.name.tag", "punctuation.definition.tag", "support.type.property-name.css"]],
  ["attribute", ["entity.other.attribute-name", "meta.attribute"]],
  ["comment", ["comment", "punctuation.definition.comment", "markup.quote"]],
];

function sentinel(index: number): string {
  return `#00${index.toString(16).padStart(4, "0")}`;
}

const SENTINEL_TO_CLASS = new Map<string, SyntaxClass>(
  SCOPE_GROUPS.map(([cls], index) => [sentinel(index), cls]),
);

const SYNTAX_THEME: ThemeRegistrationRaw = {
  name: "gitcat",
  type: "dark",
  colors: { "editor.foreground": sentinel(0), "editor.background": "#000000" },
  settings: SCOPE_GROUPS.flatMap(([, scopes], index) =>
    scopes.length === 0 ? [] : [{ scope: [...scopes], settings: { foreground: sentinel(index) } }],
  ),
};

const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  bash: () => import("shiki/langs/bash.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  docker: () => import("shiki/langs/docker.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
};

const EXTENSION_LANGS: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  go: "go",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  json5: "jsonc",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  lua: "lua",
  markdown: "markdown",
  md: "markdown",
  mjs: "javascript",
  mts: "typescript",
  php: "php",
  py: "python",
  pyi: "python",
  rb: "ruby",
  rs: "rust",
  sass: "scss",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svelte: "svelte",
  svg: "xml",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

const FILENAME_LANGS: Record<string, string> = {
  ".babelrc": "json",
  ".eslintrc": "jsonc",
  ".npmrc": "ini",
  "cargo.lock": "toml",
  containerfile: "docker",
  dockerfile: "docker",
  gemfile: "ruby",
  makefile: "bash",
  rakefile: "ruby",
};

export function languageForPath(path: string): string | null {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const byName = FILENAME_LANGS[name];
  if (byName) return byName;
  if (name.startsWith("dockerfile.")) return "docker";

  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return EXTENSION_LANGS[name.slice(dot + 1)] ?? null;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Map<string, Promise<boolean>>();

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
        import("shiki/core"),
        import("shiki/engine/javascript"),
      ]);
      return createHighlighterCore({
        themes: [SYNTAX_THEME],
        langs: [],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      });
    })();
  }
  return highlighterPromise;
}

export function loadSyntaxLanguage(lang: string): Promise<boolean> {
  const cached = loadedLangs.get(lang);
  if (cached) return cached;

  const loader = LANG_LOADERS[lang];
  const pending = !loader
    ? Promise.resolve(false)
    : (async () => {
      try {
        const highlighter = await getHighlighter();
        const mod = await loader();
        await highlighter.loadLanguage(mod as never);
        return true;
      } catch {
        return false;
      }
    })();

  loadedLangs.set(lang, pending);
  return pending;
}

function tokenizeWith(
  highlighter: HighlighterCore,
  code: string,
  lang: string,
): SyntaxToken[][] | null {
  try {
    return highlighter.codeToTokensBase(code, { lang, theme: "gitcat" }).map((line) =>
      line.map((token) => ({
        text: token.content,
        cls: SENTINEL_TO_CLASS.get((token.color ?? "").toLowerCase()) ?? "plain",
      })),
    );
  } catch {
    return null;
  }
}

export async function tokenizeLinesAsync(code: string, lang: string): Promise<SyntaxToken[][] | null> {
  if (!(await loadSyntaxLanguage(lang))) return null;
  return tokenizeWith(await getHighlighter(), code, lang);
}
