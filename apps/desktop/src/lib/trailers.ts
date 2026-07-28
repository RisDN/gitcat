import type { Identity } from "./types";

const CO_AUTHOR_LINE = /^\s*co-authored-by:\s*(.*?)\s*(?:<\s*([^>]*)\s*>)?\s*$/i;

export function parseCoAuthors(body: string): Identity[] {
  const coAuthors: Identity[] = [];

  for (const line of body.split("\n")) {
    const match = CO_AUTHOR_LINE.exec(line);
    if (!match) continue;
    const name = match[1] ?? "";
    const email = match[2] ?? "";
    if (!name && !email) continue;
    coAuthors.push({ name: name || email, email });
  }

  return coAuthors;
}

export function identityInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
