import type { KeyboardEvent as ReactKeyboardEvent } from "react";

// Arrow/Home/End roving focus for the toolbar dropdowns; Escape returns focus
// to the trigger so keyboard users do not lose their place.
export function handleMenuKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  close: () => void,
  restoreFocus: () => void,
) {
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  let next: number | null = null;
  if (event.key === "ArrowDown") next = (current + 1 + items.length) % items.length;
  else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else if (event.key === "Escape") {
    event.preventDefault();
    close();
    requestAnimationFrame(restoreFocus);
    return;
  } else if (event.key === "Tab") {
    close();
    return;
  }
  if (next !== null && items[next]) {
    event.preventDefault();
    items[next].focus();
  }
}
