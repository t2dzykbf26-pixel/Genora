import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile("app/page.tsx", "utf8");
const css = await readFile("app/workflow.css", "utf8");

assert.match(page, /onNodeContextMenu=/);
assert.match(page, /copyCanvasSelection/);
assert.match(page, /cutCanvasSelection/);
assert.match(page, /pasteCanvasSelection/);
assert.match(page, /groupCanvasSelection/);
assert.match(page, /ungroupCanvasSelection/);
assert.match(page, /parentId:\s*groupId/);
assert.match(page, /extent:\s*"parent"/);
assert.match(page, /fanOutGroupConnection/);
assert.match(page, /selectionOnDrag/);
assert.match(page, /selectionMode=\{SelectionMode\.Partial\}/);
assert.match(page, /panOnDrag=\{\[1\]\}/);
assert.doesNotMatch(page, /className="prompt-toggle/);
assert.match(page, /node\.data\.kind !== "group" && !node\.data\.kind\.startsWith\("media-"\)/);
assert.match(page, /promptOpen:\s*item\.id === node\.id/);
assert.match(page, /onPaneClick=\{\(\) => \{[\s\S]*promptOpen:\s*false/);
assert.match(css, /\.node-context-menu/);
assert.match(css, /\.canvas-node\.group/);
assert.doesNotMatch(css, /\.canvas-node:hover \.prompt-pop/);
assert.doesNotMatch(css, /\.prompt-pop:hover/);
assert.match(css, /\.selection-border\{[^}]*linear-gradient/);

console.log("Node context, group, and selection checks passed.");
