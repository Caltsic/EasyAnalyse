# M2 Blueprint UI Loop Acceptance (No Agent)

Date: 2026-04-28
Scope: Milestone 2 regression for the manual blueprint workflow only. No Agent/provider/settings/API-key behavior is included.

## Automated acceptance coverage

Covered by `easyanalyse-desktop/src/components/blueprints/BlueprintsPanel.test.tsx`:

1. Load/list a sidecar workspace (`*.easyanalyse-blueprints.json`) without adding blueprint data to the main semantic-v4 JSON.
2. Select a blueprint and render the read-only `BlueprintPreviewCanvas` path.
3. Validate a blueprint and surface invalid state, issue count, and warning count without blocking apply.
4. Open the apply confirmation dialog and show summary diff/risk warning.
5. Confirm apply as an in-memory whole-document replacement: editor becomes dirty, sidecar save is not called, `appliedInfo` is recorded, and no legacy `status='applied'` field is introduced.
6. Undo restores the previous main-document content.
7. Unknown blueprints remain apply-eligible.

## Manual smoke checklist

- Open a saved semantic-v4 document and switch the right sidebar to **Blueprints**.
- Confirm sidecar status shows `<name>.easyanalyse-blueprints.json` for saved files, or in-memory workspace for unsaved files.
- Create/select a manual snapshot and confirm the preview panel appears below the list.
- Click **Validate** and verify validation status/issues update on the card.
- Click **Apply**, review the warning/diff dialog, then **Confirm apply**.
- Confirm the main editor changes in memory and is marked dirty; main save is still a separate explicit action.
- Use undo and confirm the previous main document content returns.
- Inspect saved main JSON when saved normally: it must not contain top-level `blueprints`, `agent`, or `workspace` fields.
