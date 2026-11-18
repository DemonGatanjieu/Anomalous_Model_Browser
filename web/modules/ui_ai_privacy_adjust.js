/**
 * Inline privacy adjusters inside Privacy Overview (ui_ai_privacy_overview.js):
 * - A hidden `[P*]` prompt as Prompt Studio's chips (meanings on request): pick tags, or select words, to let through
 * - Retroactively seal an unsealed phrase from a user message in the "Visible" column
 * - Toggle per-task model hiding or individual model hide/expose (`POST /privacy_rules`)
 */

import { translate as t } from './locales.js';
import { partsShowingRange, partsShowingTags, promptChunks } from './ai_privacy_view.js';
import { fetchGlosses, glossOf, pageGlossLang } from './prompt_gloss.js';
import { tagWeight } from './prompt_tags.js';
import { icon } from './ui_ai_icons.js';
import { anomalousAlert } from './ui_dialog.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** Call `POST /anomalous/ai_tasks/{id}/privacy_rules` and sync `task` fields in place. */
export async function postPrivacyRule(task, payload) {
    const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}/privacy_rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText);
    const snapshot = await response.json();
    task.privacy_models = snapshot.privacy_models;
    task.privacy_models_source = snapshot.privacy_models_source;
    task.sealed = snapshot.sealed || {};
    if (snapshot.sealed_legacy && Object.keys(snapshot.sealed_legacy).length) task.sealed_legacy = snapshot.sealed_legacy;
    else delete task.sealed_legacy;
    if (snapshot.sealed_notes && Object.keys(snapshot.sealed_notes).length) task.sealed_notes = snapshot.sealed_notes;
    else delete task.sealed_notes;
    if (snapshot.public_models?.length) task.public_models = snapshot.public_models;
    else delete task.public_models;
    if (snapshot.private_models?.length) task.private_models = snapshot.private_models;
    else delete task.private_models;
    if (snapshot.exposed_prompts?.length) task.exposed_prompts = snapshot.exposed_prompts;
    else delete task.exposed_prompts;
    if (snapshot.sealed_views && Object.keys(snapshot.sealed_views).length) task.sealed_views = snapshot.sealed_views;
    else delete task.sealed_views;
    if (payload.action !== 'model_rule') {
        // Letting words through or hiding more rewrites the user's messages on the server: read them again.
        const fresh = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
        if (Array.isArray(fresh?.task?.steps)) task.steps = fresh.task.steps;
    }
    return snapshot;
}

const MANY_TAGS = 16; // more than this: the chips fold to a few rows until "show all"

/**
 * A hidden `[P*]` prompt in the Privacy Overview, as Prompt Studio shows it: its tags as chips, a
 * meaning under each on request (pageGlossLang), or one text when it is no list of tags. Clicking chips
 * (or selecting words of the text) picks what the AI may read; Let through sends the parts
 * (partsShowingTags / partsShowingRange) and `onApplied()` redraws the overview.
 */
export function renderHiddenPrompt(item, task, { onApplied }) {
    const box = el('div', 'anomalous-ai-priv-prompt');
    const { mode, items } = item.chunks || promptChunks(item.text);
    const shown = new Set();
    let range = null;

    const bar = el('div', 'anomalous-ai-priv-letbar');
    const picked = el('span', 'anomalous-ai-priv-letbar-count');
    const clear = el('button', 'anomalous-ai-tool', t('aiPrivacyAdjustCancel'));
    clear.type = 'button';
    const apply = el('button', 'anomalous-ai-tool is-primary', t('aiPrivacyLetThroughApply'));
    apply.type = 'button';
    bar.append(el('div', 'anomalous-ai-priv-letbar-warn', t('aiPrivacySplitWarn')), picked, clear, apply);
    const sync = () => {
        bar.hidden = mode === 'tags' ? !shown.size : !range;
        picked.textContent = mode === 'tags' ? t('aiPrivacyPickedTags', { count: shown.size })
            : range ? t('aiPrivacyPickedText', { words: item.text.slice(range[0], range[1]) }) : '';
    };

    const tools = el('div', 'anomalous-ai-priv-prompt-tools');
    const hint = t(mode === 'tags' ? 'aiPrivacyChipsHint' : 'aiPrivacyTextHint'); // on hover, not one more line
    box.append(tools);

    if (mode === 'tags') {
        const chips = el('div', 'anomalous-ps-tags anomalous-ai-priv-chips');
        chips.title = hint;
        const glosses = [];
        items.forEach((part, index) => {
            if (!part.text) return;
            const { core, weight } = tagWeight(part.text);
            const chip = el('button', 'anomalous-ps-tag anomalous-ai-priv-chip');
            chip.type = 'button';
            const main = el('span', 'anomalous-ps-tag-main');
            const mark = () => main.firstChild.replaceWith(icon(shown.has(index) ? 'check' : 'lock', 11));
            main.append(icon('lock', 11), el('span', 'anomalous-ps-tag-text', core));
            if (weight !== 1) main.append(el('span', 'anomalous-ps-tag-weight', String(weight)));
            const gloss = el('span', 'anomalous-ps-tag-gloss');
            glosses.push([gloss, part.text]);
            chip.append(main, gloss);
            chip.onclick = () => {
                if (shown.has(index)) shown.delete(index);
                else shown.add(index);
                chip.classList.toggle('is-shown', shown.has(index));
                mark();
                sync();
            };
            chips.append(chip);
        });
        clear.onclick = () => {
            shown.clear();
            for (const chip of chips.querySelectorAll('.is-shown')) {
                chip.classList.remove('is-shown');
                chip.querySelector('.anomalous-ps-tag-main').firstChild.replaceWith(icon('lock', 11));
            }
            sync();
        };
        box.append(chips);
        if (glosses.length > MANY_TAGS) {
            chips.classList.add('is-folded');
            const more = el('button', 'anomalous-ai-link anomalous-ai-priv-chips-more');
            more.type = 'button';
            const words = el('span', '', t('aiPrivacyShowAllTags', { count: glosses.length }));
            more.append(icon('chevronDown', 12), words);
            more.onclick = () => {
                const folded = chips.classList.toggle('is-folded');
                more.classList.toggle('is-open', !folded);
                words.textContent = folded ? t('aiPrivacyShowAllTags', { count: glosses.length }) : t('aiPrivacyCollapseText');
            };
            box.append(more);
        }
        const lang = pageGlossLang();
        if (lang) {
            const show = () => glosses.forEach(([span, tag]) => { span.textContent = glossOf(tag, lang) || ''; });
            const ask = el('button', 'anomalous-ai-link', t('aiTagsMeaning'));
            ask.type = 'button';
            ask.title = t('aiTagsMeaningHint');
            ask.onclick = async () => {
                ask.disabled = true;
                ask.textContent = t('aiTagsMeaningLoading');
                const ok = await fetchGlosses(glosses.map(([, tag]) => tag), lang);
                show();
                if (ok) ask.remove();
                else {
                    ask.disabled = false;
                    ask.textContent = t('aiTagsMeaningFailed');
                }
            };
            show(); // meanings asked for before in this session show at once
            if (glosses.some(([, tag]) => glossOf(tag, lang) === undefined)) tools.append(ask);
        }
    } else {
        const area = document.createElement('textarea');
        area.className = 'anomalous-ai-priv-adjust-area';
        area.readOnly = true;
        area.title = hint;
        area.rows = Math.min(5, Math.max(1, Math.ceil(item.text.length / 48)));
        area.value = item.text;
        const take = () => {
            const start = area.selectionStart ?? 0;
            const end = area.selectionEnd ?? 0;
            range = item.text.slice(start, end).trim().length >= 2 ? [start, end] : null;
            sync();
        };
        area.onmouseup = take;
        area.onkeyup = take;
        clear.onclick = () => {
            area.setSelectionRange(0, 0);
            range = null;
            sync();
        };
        box.append(area);
    }

    apply.onclick = async () => {
        const parts = mode === 'tags' ? partsShowingTags(item.text, shown) : partsShowingRange(item.text, range[0], range[1]);
        apply.disabled = true;
        try {
            await postPrivacyRule(task, { action: 'split_prompt', token: item.token, parts });
            onApplied();
        } catch (error) {
            apply.disabled = false;
            await anomalousAlert(error.message);
        }
    };
    sync();
    box.append(bar);
    return box;
}

/**
 * Inline phrase sealer mounted on an unsealed message card in the right ("Visible") column.
 */
export function renderMessageSealer(msg, task, { onClose, onApplied }) {
    const box = el('div', 'anomalous-ai-priv-adjust');
    if (msg.delivered) box.append(el('div', 'anomalous-ai-priv-adjust-warn', t('aiPrivacySealRetroWarn')));
    box.append(el('div', 'anomalous-ai-priv-adjust-hint', t('aiPrivacySealPhraseHint')));

    const area = document.createElement('textarea');
    area.className = 'anomalous-ai-priv-adjust-area';
    area.readOnly = true;
    area.rows = Math.min(4, Math.max(2, Math.ceil(msg.raw.length / 48)));
    area.value = msg.raw;

    const actions = el('div', 'anomalous-ai-priv-adjust-actions');
    const cancelBtn = el('button', 'anomalous-ai-tool', t('aiPrivacyAdjustCancel'));
    cancelBtn.type = 'button';
    cancelBtn.onclick = onClose;

    const sealBtn = el('button', 'anomalous-ai-tool is-primary', t('aiPrivacySealPhraseBtn'));
    sealBtn.type = 'button';
    sealBtn.onmousedown = (e) => e.preventDefault();
    sealBtn.onclick = async () => {
        const picked = area.value.slice(area.selectionStart ?? 0, area.selectionEnd ?? 0).trim();
        if (picked.length < 2) {
            await anomalousAlert(t('aiHideMarkNone'));
            return;
        }
        sealBtn.disabled = true;
        try {
            await postPrivacyRule(task, { action: 'seal_message_phrase', step_id: msg.stepId || '', phrase: picked });
            onApplied();
        } catch (error) {
            sealBtn.disabled = false;
            await anomalousAlert(error.message);
        }
    };

    actions.append(cancelBtn, sealBtn);
    box.append(area, actions);
    return box;
}
