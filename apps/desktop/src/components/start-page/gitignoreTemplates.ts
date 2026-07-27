export interface GitignoreTemplate {
  id: string;
  label: string;
  patterns: string[];
}

export const GITIGNORE_TEMPLATES: GitignoreTemplate[] = [
  {
    id: "node",
    label: "Node",
    patterns: ["node_modules/", "dist/", "build/", ".env", ".env.local", "*.log", ".DS_Store"],
  },
  {
    id: "rust",
    label: "Rust",
    patterns: ["/target/", "**/*.rs.bk", "*.pdb", ".DS_Store"],
  },
  {
    id: "python",
    label: "Python",
    patterns: ["__pycache__/", "*.py[cod]", ".venv/", "venv/", "*.egg-info/", ".pytest_cache/", ".DS_Store"],
  },
  {
    id: "java",
    label: "Java",
    patterns: ["target/", "build/", "*.class", "*.jar", ".gradle/", ".DS_Store"],
  },
  {
    id: "go",
    label: "Go",
    patterns: ["bin/", "*.exe", "*.test", "*.out", "vendor/", ".DS_Store"],
  },
  {
    id: "unity",
    label: "Unity",
    patterns: ["Library/", "Temp/", "Obj/", "Build/", "Builds/", "Logs/", "UserSettings/", "*.csproj", "*.sln"],
  },
];
