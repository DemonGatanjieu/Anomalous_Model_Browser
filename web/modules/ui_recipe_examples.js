/**
 * The example workflows on the Workflows page (api/example_workflows.py): one card that opens a window of
 * them, each with a word on what it does and a button that opens it in a tab of its own, on a model and a
 * picture that are here. The card comes first, or it is lost under the user's own, and goes while the list is filtered.
 */

import { app } from "../../../scripts/app.js";
import { resolveLocale, translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { aiWindow } from './ui_ai_connect.js';
import { icon } from './ui_ai_icons.js';
import { appendText } from './ui_recipe_detail_dom.js';

const words = value => value?.[resolveLocale()] || value?.en || value?.zh || '';

async function openExample(owner, example, closeWindow) {
    const response = await fetch(`/anomalous/example_workflows?id=${encodeURIComponent(example.id)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.data?.workflow) throw new Error(payload.error || response.statusText);
    await app.loadGraphData(payload.data.workflow, true, true, words(example.title));
    closeWindow();
    owner?.close?.();
    if (payload.data.lacks_model) await anomalousAlert(t('recipeExampleNoModel'));
}

function exampleRow(owner, example, closeWindow) {
    const row = document.createElement('div');
    row.className = 'anomalous-example';
    const text = appendText(row, 'div', '', 'anomalous-example-words');
    appendText(text, 'div', words(example.title), 'anomalous-example-title');
    appendText(text, 'div', words(example.about), 'anomalous-example-about');
    const open = appendText(row, 'button', t('recipeOpenCanvas'), 'anomalous-example-open');
    open.type = 'button';
    open.onclick = async () => {
        open.disabled = true;
        try {
            await openExample(owner, example, () => closeWindow());
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
    body.append(...(payload.examples || []).map(example => exampleRow(owner, example, () => closeWindow())));
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
