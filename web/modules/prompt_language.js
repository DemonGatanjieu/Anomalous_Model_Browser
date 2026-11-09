/**
 * Before a run: is a prompt in a language the canvas's drawing model cannot read (api/prompt_language.py)?
 * The model files come from the loaders' model boxes (ui_node_model_picker.js), the prompts from what the run
 * sends: the canvas's positive prompt boxes (prompt_boxes.js), or a job sheet's rows. Asked by the AI's
 * run_workflow (mcp_bridge.js) and job sheet (job_sheet_run.js), and the job sheet's Start (ui_job_sheet.js).
 * What was asked about once is let through the next time (`heard`, kept apart for the AI and the user: the AI's
 * refusal is no warning the user saw), so either can insist.
 */

import { promptBoxes } from './prompt_boxes.js';
import { modelComboWidgets } from './ui_node_model_picker.js';

const off = node => node.mode === 2 || node.mode === 4;
const heard = new Set();

function* nodesOf(graph) {
    for (const node of graph?._nodes || []) {
        yield node;
        if (node.subgraph) yield* nodesOf(node.subgraph);
    }
}

/** The text in `graph`'s positive prompt boxes. */
export const canvasPrompts = graph => [...nodesOf(graph)].filter(node => !off(node))
    .flatMap(node => promptBoxes(node).filter(box => box.role === 'positive').map(box => String(box.widget?.value ?? '')));

/** {family, model} when a prompt of `texts` (default: the canvas's) is in a language `graph`'s model cannot read; else null. */
export async function languageProblem(graph, texts = canvasPrompts(graph)) {
    const models = [...nodesOf(graph)].filter(node => !off(node)).flatMap(node => modelComboWidgets(node).map(widget => widget.value))
        .filter(value => typeof value === 'string' && value && value !== 'None');
    if (!models.length || !texts.some(Boolean)) return null;
    try {
        const response = await fetch('/anomalous/prompt_language', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ models: [...new Set(models)], texts }) });
        const found = await response.json();
        return found?.family ? found : null;
    } catch {
        return null; // the check only helps: a run is never stopped by it failing
    }
}

/** The problem the first time `who` ('ai' or 'user') meets it; null when they met it before with the same model and prompts. */
export function firstTime(problem, texts, who) {
    if (!problem) return null;
    const key = `${who}\n${problem.model}\n${texts.join('\n')}`;
    if (heard.has(key)) return null;
    heard.add(key);
    return problem;
}

/** What the AI is told: nothing ran, why, and how to go on. */
export const aiWords = problem => `Nothing was run: the canvas's model ${problem.model} (${problem.family}) reads English words and tags only, `
    + 'and the prompt is Chinese, Japanese or Korean, so the picture would not follow it and shows whatever the model leans to. '
    + 'Write the prompt in English for it (keep what the user asked for), then run again. If the user wants it run as written, call again unchanged.';
