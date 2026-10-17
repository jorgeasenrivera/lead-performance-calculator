import assert from "node:assert/strict";

// Overflow alone misses a date whose letters or digits wrap inside its own box.
export async function assertDateReadability(frame) {
  const failures = await frame.locator(".day-date").evaluateAll((dates) => {
    const failures = [];
    for (const date of dates) {
      const button = date.closest("[data-day]");
      const bounds = button.getBoundingClientRect();
      const walker = document.createTreeWalker(date, NodeFilter.SHOW_TEXT);
      const tokens = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        for (const match of node.textContent.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const rects = [...range.getClientRects()].filter(r => r.width && r.height);
          if (!rects.length) continue; // Desktop weekday labels are intentionally hidden.
          if (rects.some(r => Math.abs(r.top - rects[0].top) > 1))
            failures.push(`${button.dataset.day}: ${match[0]} wraps across lines`);
          if (rects.some(r => r.left < bounds.left || r.right > bounds.right || r.top < bounds.top || r.bottom > bounds.bottom))
            failures.push(`${button.dataset.day}: ${match[0]} leaves its day button`);
          tokens.push(...rects);
        }
      }
      for (let i = 0; i < tokens.length; i++)
        for (let j = i + 1; j < tokens.length; j++) {
          const a = tokens[i], b = tokens[j];
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)
            failures.push(`${button.dataset.day}: date tokens overlap`);
        }
    }
    return failures;
  });
  assert.deepEqual(failures, [], "weekday, date and Today tokens must each stay on one line, contained and non-overlapping");
}
