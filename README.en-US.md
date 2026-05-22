# EASYAnalyse User Guide

[中文](README.zh-CN.md) | [Back to README](README.md)

EASYAnalyse is a hardware circuit construction, review, and AI-assisted analysis workspace. It is not a PCB layout tool or a SPICE simulator. Its core goal is to store circuit intent, devices, terminals, network labels, parameters, and layout as semantic JSON that humans, software, and AI agents can read and validate.

Think of it as a hardware circuit workspace: the engineer defines the goal, reviews the result, and makes the final decision; the AI Agent helps generate blueprints, inspect the current circuit, explain topology, propose changes, and write candidate circuits into the blueprint workspace when needed.

## What It Is For

- Build semantic circuit diagrams for power supplies, MCUs, op-amp blocks, filters, interfaces, drivers, and mixed analog/digital modules.
- Ask AI to generate circuit candidates, for example “design a low-pass filter with a 5 kHz cutoff frequency”.
- Ask AI to read the current circuit JSON, explain the design, or diagnose display and structure problems.
- Keep multiple blueprint candidates without overwriting the main document.
- Use one JSON representation that can be understood by humans, software, and large language models.
- Switch the UI between Chinese and English.

## Basic Workflow

1. Open EASYAnalyse and create a new circuit or open an existing `.json` circuit file.
2. Choose a device template from the top toolbar, then add the device to the canvas.
3. Use the right-side inspector to edit device names, types, parameters, terminals, directions, positions, and network labels.
4. Use the same terminal `label` to express connectivity. Two terminals with the same non-empty label are treated as belonging to the same network.
5. Run validation to check whether the current JSON can be understood and rendered by the app.
6. Use the blueprint workspace to snapshot the current document or ask the Agent to generate new candidates.
7. Before applying a blueprint, review validation results, the diff summary, and the raw JSON preview.

## Canvas And Inspector

The canvas is used to view and adjust circuit structure. The inspector edits the selected entity.

On the canvas, you can:

- Move devices.
- Move multiple selected devices together.
- Rotate selected devices.
- Focus a device or network to inspect upstream and downstream relations.
- Inspect network lines, device terminals, and label relationships.

In the inspector, you can:

- Edit device name, type, reference, package, and parameters.
- Add input and output terminals.
- Set terminal direction, side, order, pin name, and network label.
- Add electrical parameters for resistors, capacitors, inductors, crystals, supplies, op-amps, regulators, and similar devices.

## Connectivity Rule

EASYAnalyse uses terminal labels as the source of connectivity truth, not traditional wire geometry.

- If an MCU `SCL` terminal and a sensor `SCL` terminal both use label `I2C_SCL`, they are part of the same network.
- If regulator output and IC power pins use label `3V3`, they are part of the 3.3 V power network.
- A terminal without a label is treated as unconnected or semantically incomplete.

This lets AI understand circuit meaning without guessing from wire geometry, and it lets engineers read connectivity directly from JSON.

## How To Read Validation

Validation has two categories:

- Hard format checks: required fields, field types, unknown fields, and errors that can prevent opening or rendering.
- Semantic hints: missing parameters, unconnected terminals, unclear power labels, suspicious direction choices, and similar review prompts.

Hard format problems usually must be fixed because they can prevent the document or devices from rendering. Semantic hints are engineering review signals, not proof that the circuit is wrong.

## Using The Agent

The AI panel is first a normal chat surface. Tool use is available when the model needs it.

Recommended flow:

1. Configure the Provider, model, and API key in model settings.
2. Describe your goal in the Agent input, for example “design a high-Q 5 kHz low-pass filter”.
3. Enable `Context` when the Agent should read the current circuit.
4. The Agent can autonomously call tools such as reading the current document, checking blueprint format, checking a candidate, or creating a blueprint candidate.
5. Tool activity is collapsed by default and can be expanded for debugging.
6. Generated blueprint candidates enter the blueprint panel and do not overwrite the main canvas automatically.

`Context` means the current circuit JSON is sent to the model with your message. Use it for current-circuit inspection, explanation, or iteration. Leave it disabled for general questions or from-scratch design requests.

## Blueprint Workspace

Blueprints are candidate circuits or history snapshots. They protect the main document from being overwritten by AI or experimental changes.

In the blueprint panel, you can:

- Create a snapshot of the current main document.
- View Agent-generated blueprint candidates.
- Preview a blueprint circuit.
- Re-run validation.
- Compare a blueprint with the current main document.
- Apply a blueprint to replace the current main document.
- Archive or delete candidates.

If the Agent run completes but the main canvas does not change, check the blueprint panel first. Candidates are stored there by default.

## Provider And API Keys

Model settings store only public Provider metadata: provider name, API URL, model list, and default model.

API keys are saved in the local SecretStore. Ordinary settings keep only an opaque `apiKeyRef`, which keeps secrets out of project configuration and circuit JSON.

When `Context` is enabled and an external model is used, the current circuit JSON is sent to that Provider. For private hardware designs, confirm that the Provider and data policy meet your requirements.

## Mobile Viewing

The desktop app can create a read-only local network link for the current circuit snapshot.

This is useful for:

- Quick phone review.
- Landscape browsing of large circuit diagrams.
- Temporary review links for colleagues on the same LAN.

The mobile view is read-only. It does not sync later edits and does not modify the desktop document.

## Current Boundaries

EASYAnalyse does not currently replace:

- PCB layout tools.
- SPICE simulators.
- Component selection databases.
- Production-grade DRC/ERC systems.

Agent-generated circuits are candidates. They can improve construction and review speed, but final electrical correctness still requires engineering review, especially for high-Q filters, switching power supplies, high-speed interfaces, protection circuits, and safety-related designs.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). The project uses trunk-based development: `main` is the trunk, short-lived branches are merged through PRs, and bug, feature, and discussion issues use structured templates.

