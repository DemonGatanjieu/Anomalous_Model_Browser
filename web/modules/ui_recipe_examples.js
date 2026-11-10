/**
 * The example workflows on the Workflows page (api/example_workflows.py): one card that opens a window of
 * them by plan, each version with its note and a button that opens it in a tab of its own, on a model and a
 * picture that are here. A version that lacks a pack or a model says what, a pack with the way into the
 * Manager, and has no button. What holds for every version of a model family is said once, above the first of
 * them in a plan. The card comes first, or it is lost under the user's own, and goes while the list is filtered.
 */

import { app } from "../../../scripts/app.js";
import { resolveLocale, translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { aiWindow } from './ui_ai_connect.js';
import { icon } from './ui_ai_icons.js';
import { openManager } from './ui_pack_usage.js';
import { appendText } from './ui_recipe_detail_dom.js';

const words = value => value?.[resolveLocale()] || value?.en || value?.zh || '';
const FAMILY_NOTES = { anima: 'recipeExampleNote_anima' };

async function openExample(owner, example, closeWindow) {
    const response = await fetch(`/anomalous/example_workflows?id=${encodeURIComponent(example.id)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.data?.workflow) throw new Error(payload.error || response.statusText);
    const tab = `${words(example.title)} ${words(example.version)}`.replace(/\s*\/\s*/g, ' '); // a tab's name is a path to ComfyUI
    await app.loadGraphData(payload.data.workflow, true, true, tab);
    closeWindow();
    owner?.close?.();
}

/** What `example` lacks: a pack is a button into the Manager, a model a word. */
function lacksLine(owner, example) {
    const line = document.createElement('div');
    line.className = 'anomalous-ai-block-lacks';
    for (const lack of example.lacks) {
        if (lack.model) {
            appendText(line, 'span', t(`recipeExampleLacks_${lack.model}`), 'anomalous-ai-block-lack');
            continue;
        }
        const pack = appendText(line, 'button', t('aiBlocksNeedsPack', { name: lack.pack }), 'anomalous-ai-block-lack is-pack');
        pack.type = 'button';
        pack.title = t('aiBlocksFindPack');
        pack.onclick = () => void openManager(owner, { name: lack.pack });
    }
    return line;
}

function exampleRow(owner, example, closeWindow) {
    const row = document.createElement('div');
    row.className = `anomalous-example${example.lacks.length ? ' is-missing' : ''}`;
    const text = appendText(row, 'div', '', 'anomalous-example-words');
    const head = appendText(text, 'div', '', 'anomalous-example-title');
    appendText(head, 'span', words(example.version));
    if (example.recommended) appendText(head, 'span', t('recipeExampleRecommended'), 'anomalous-example-badge');
    appendText(text, 'div', words(example.about), 'anomalous-example-about');
    if (example.lacks.length) {
        text.append(lacksLine(owner, example));
        return row;
    }
    const open = appendText(row, 'button', t('recipeOpenCanvas'), 'anomalous-example-open');
    open.type = 'button';
    open.onclick = async () => {
        open.disabled = true;
        try {
            await openExample(owner, example, closeWindow);
        } catch (error) {
            open.disabled = false;
            await anomalousAlert(t('recipeOpenError'));
        }
    };
    return row;
}

async function showExamples(owner) {
    const response = await fetch('/anomalous/example_workflows');
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.statusText);
    const body = document.createElement('div');
    body.className = 'anomalous-examples';
    appendText(body, 'p', t('recipeExamplesHint'), 'anomalous-examples-hint');
    let closeWindow = () => {};
    let plan = '';
    let noted = new Set();
    for (const example of payload.examples || []) {
        if (words(example.title) !== plan) {
            plan = words(example.title);
            noted = new Set();
            appendText(body, 'div', plan, 'anomalous-examples-plan');
        }
        if (FAMILY_NOTES[example.family] && !noted.has(example.family)) {
            noted.add(example.family);
            appendText(body, 'div', t(FAMILY_NOTES[example.family]), 'anomalous-examples-note');
        }
        body.append(exampleRow(owner, example, () => closeWindow()));
    }
    closeWindow = aiWindow(t('recipeExamplesTitle'), body);
}

/** The card; `owner`: the browser window. */
export function exampleCard(owner) {
    const card = document.createElement('article');
    card.className = 'anomalous-wf-card is-examples';
    const cover = document.createElement('div');
    cover.className = 'anomalous-wf-cover';
    cover.append(icon('blocks', 34));
    const info = document.createElement('div');
    info.className = 'anomalous-wf-info';
    appendText(info, 'h3', t('recipeExamplesTitle'), 'anomalous-wf-title');
    appendText(info, 'div', t('recipeExamplesCard'), 'anomalous-wf-meta');
    card.append(cover, info);
    card.onclick = () => showExamples(owner).catch(() => anomalousAlert(t('recipeLoadError')));
    return card;
}
