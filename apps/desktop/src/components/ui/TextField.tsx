import type { ComponentPropsWithRef } from "react";

// autoComplete defaults to "off" so the webview never offers saved form data.
export function Input({ autoComplete = "off", ...props }: ComponentPropsWithRef<"input">) {
  return <input autoComplete={autoComplete} {...props} />;
}

export function TextArea({
  autoComplete = "off",
  ...props
}: ComponentPropsWithRef<"textarea">) {
  return <textarea autoComplete={autoComplete} {...props} />;
}
