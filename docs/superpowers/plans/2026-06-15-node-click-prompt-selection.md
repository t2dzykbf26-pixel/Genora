# Node Click Prompt and Selection Visual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make prompt panels open only from deliberate node clicks and refine the multi-selection overlay to match canvas nodes.

**Architecture:** Keep `promptOpen` in existing node data and update it from the React Flow `onNodeClick` handler. Preserve selection as a separate concern so box selection never changes prompt visibility. Restrict visual changes to existing workflow CSS.

**Tech Stack:** Next.js, React, TypeScript, `@xyflow/react`, CSS.

---

### Task 1: Add interaction regression checks

**Files:**
- Modify: `scripts/check-node-context-group-selection.mjs`

- [ ] Assert that the node component no longer renders `prompt-toggle`.
- [ ] Assert that the node click handler updates `promptOpen`.
- [ ] Assert that CSS has no parent-node hover rule that reveals `.prompt-pop`.
- [ ] Run `node scripts/check-node-context-group-selection.mjs` and confirm it fails before implementation.

### Task 2: Replace prompt toggle with node click behavior

**Files:**
- Modify: `app/page.tsx`

- [ ] Remove the bottom-right prompt toggle button.
- [ ] Change `focusNode` into a deliberate click handler that opens the clicked generation node and closes other prompt panels.
- [ ] Ignore clicks originating from controls or the prompt panel.
- [ ] Close prompt panels from `onPaneClick`.
- [ ] Run the focused regression check and confirm it passes.

### Task 3: Refine multi-selection visuals

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/workflow.css`

- [ ] Reduce selection bounds padding.
- [ ] Give the selection border the same dark glass gradient, radius, border treatment, and shadow language as canvas nodes.
- [ ] Remove prompt-toggle and hover-open CSS.
- [ ] Preserve the group toolbar and left/right connection controls.

### Task 4: Verify

**Files:**
- Verify only.

- [ ] Run `npm.cmd run check`.
- [ ] Run `npx.cmd next build` with `NEXT_DIST_DIR=.next-build`.
- [ ] Verify node click and selection behavior in the in-app browser.
