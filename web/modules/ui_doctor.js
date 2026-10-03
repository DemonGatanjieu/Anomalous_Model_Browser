/**
 * Model Check, the tool page: the models the open workflow uses and what is wrong with each
 * (model_check.js), with what can be done about it: put in the same file found under
 * another name or folder, take or leave a file of the same name or size, pick one by hand (the
 * node model picker) or look it up on Civitai. Nothing in the workflow changes without a
 * press here. Uses the scan page's layout classes (18-scan-page.css).
 */

import { translate as t } from './locales.js';
import { applyModelFix, checkWorkflowModels, fixWorkflowModels, isProblem, markReplaced, replacedFrom } from './model_check.js';
import { updateDoctorBanner } from './ui_doctor_banner.js';

const MODEL_EXT = /\.(safetensors|ckpt|pt|bin|pth|sft|gguf)$/i;
const CANDIDATE_WHY = { size: 'doctorWhyCandidate', name: 'doctorWhySameName', 'name-size': 'doctorWhyLikely' };
const ORDER = ['fixable', 'candidate', 'conflict', 'ambiguous', 'missing', 'changed'];
const MARKS = { fixable: '↻', candidate: '?', conflict: '✕', ambiguous: '?', missing: '✕', changed: '!', ready: '✓' };

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

const fileName = (value) => String(value).split(/[\\/]/).pop();
const nodeLabel = (entry) => `#${entry.node.id} ${entry.node.title || entry.node.type}`;

function stat(value, label, tone) {
    const box = el('div', `anomalous-scan-stat${tone ? ` is-${tone}` : ''}`);
    box.append(el('strong', 'anomalous-scan-stat-value', String(value)), el('span', 'anomalous-scan-stat-label', label));
    return box;
}

function reason(entry) {
    switch (entry.state) {
        case 'fixable': return t(entry.via === 'spelling' ? 'doctorWhySpelling' : 'doctorWhyFound', { file: entry.target });
        case 'candidate': return t(CANDIDATE_WHY[entry.via], { file: entry.target });
        case 'conflict': return t('doctorWhyConflict');
        case 'ambiguous': return t('doctorWhyAmbiguous');
        case 'changed': return t('doctorWhyChanged');
        default: return t(entry.record ? 'doctorWhyNotHere' : 'doctorWhyNoRecord');
    }
}

/** The hashes behind the verdict, folded. */
function proof(entry) {
    const line = (label, record) => {
        const parts = [record?.hash, record?.size && `${Number(record.size).toLocaleString()} B`].filter(Boolean);
        return el('div', '', `${label}: ${parts.join(' · ') || t('doctorProofNone')}`);
    };
    const details = el('details', 'anomalous-doctor-proof');
    details.append(el('summary', '', t('doctorProof')), line(t('doctorProofSaved'), entry.record), line(t('doctorProofLocal'), entry.local));
    return details;
}

/** The model's Civitai page by the workflow's hash, else a search by its file name. */
async function openOnCivitai(entry) {
    const tab = window.open('', '_blank'); // opened now: a window opened after the lookup is blocked
    let url = `https://civitai.com/search/models?sortBy=models_v9&query=${encodeURIComponent(fileName(entry.value).replace(MODEL_EXT, ''))}`;
    if (entry.record?.hash) {
        try {
            const res = await fetch(`https://civitai.com/api/v1/model-versions/by-hash/${encodeURIComponent(entry.record.hash)}`);
            const data = res.ok ? await res.json() : null;
            if (data?.modelId) {
                const domain = data.model?.nsfw || (data.nsfwLevel || 1) > 1 ? 'civitai.red' : 'civitai.com';
                url = `https://${domain}/models/${data.modelId}${data.id ? `?modelVersionId=${data.id}` : ''}`;
            }
        } catch (error) {
            console.warn('[AMB] Doctor: Civitai lookup by hash failed, searching by name.', error);
        }
    }
    if (tab) tab.location.href = url;
    else window.open(url, '_blank');
}

function pickByHand(owner, panel, entry) {
    const { node, widget } = entry;
    const from = widget.value;
    owner._openGalleryReplacer(node, widget, {
        onApplied: () => {
            markReplaced(widget, from, widget.value);
            renderDoctorPage(owner, panel);
        },
    });
}

function problemRow(owner, panel, entry) {
    const row = el('div', `anomalous-scan-row anomalous-doctor-row is-${entry.state}`);
    const copy = el('div', 'anomalous-scan-row-copy');
    copy.append(
        el('span', 'anomalous-scan-row-name', fileName(entry.value)),
        el('span', 'anomalous-scan-row-where', nodeLabel(entry)),
        el('span', 'anomalous-doctor-why', reason(entry)),
    );
    if (entry.record || entry.local) copy.append(proof(entry));
    const actions = el('div', 'anomalous-scan-row-actions');
    const put = (labelKey) => button('anomalous-scan-row-btn is-main', t(labelKey), () => {
        if (!applyModelFix(entry)) alert(t('doctorChangedMeanwhile'));
        renderDoctorPage(owner, panel);
    });
    if (entry.state === 'fixable') actions.append(put('doctorPutIn'));
    if (entry.state === 'candidate') actions.append(put('doctorUseCandidate'));
    if (entry.state !== 'fixable') {
        actions.append(button('anomalous-scan-row-btn', t('doctorPick'), () => pickByHand(owner, panel, entry)));
    }
    if (!['fixable', 'candidate', 'changed'].includes(entry.state)) {
        actions.append(button('anomalous-scan-row-btn', 'Civitai', () => openOnCivitai(entry)));
    }
    row.append(el('span', 'anomalous-scan-row-mark', MARKS[entry.state]), copy, actions);
    return row;
}

function simpleRow(entry, detail, state = 'ready') {
    const row = el('div', `anomalous-scan-row anomalous-doctor-row is-${state}`);
    const copy = el('div', 'anomalous-scan-row-copy');
    copy.append(el('span', 'anomalous-scan-row-name', fileName(entry.value)), el('span', 'anomalous-scan-row-where', nodeLabel(entry)));
    if (detail) copy.append(el('span', 'anomalous-doctor-why', detail));
    row.append(el('span', 'anomalous-scan-row-mark', MARKS.ready), copy);
    return row;
}

function card(title, rows) {
    const box = el('div', 'anomalous-scan-card');
    const list = el('div', 'anomalous-scan-rows');
    list.append(...rows);
    box.append(el('div', 'anomalous-scan-card-title', title), list);
    return box;
}

/** Models the workflow carries a hash for may be among the files no scan has hashed yet. */
async function scanHint(owner, entries) {
    if (!entries.some(entry => entry.state === 'missing' && entry.record?.hash)) return null;
    const summary = await fetch('/anomalous/scan_summary').then(res => (res.ok ? res.json() : null)).catch(() => null);
    if (!summary?.new) return null;
    const box = el('div', 'anomalous-scan-card');
    box.append(
        el('p', 'anomalous-scan-note is-warn', t('doctorScanHint', { count: summary.new })),
        button('anomalous-scan-secondary anomalous-doctor-to-scan', t('doctorToScan'), () => owner.openScanPage()),
    );
    return box;
}

function head(page) {
    page.append(el('h1', 'anomalous-scan-title', t('sidebarDoctor')), el('p', 'anomalous-scan-lead', t('doctorLead')));
}

/** Checks the open workflow and renders the page into `panel`; `refresh` reloads the model lists first. */
export async function renderDoctorPage(owner, panel, { refresh = false } = {}) {
    const token = (panel._doctorRender = (panel._doctorRender || 0) + 1);
    if (refresh || !panel.firstChild) {
        const waiting = el('div', 'anomalous-scan-page');
        head(waiting);
        waiting.append(el('p', 'anomalous-scan-muted', t('doctorChecking')));
        panel.replaceChildren(waiting);
    }
    const entries = await checkWorkflowModels({ refresh });
    if (token !== panel._doctorRender) return;
    updateDoctorBanner(owner, entries);
    const hint = await scanHint(owner, entries);
    if (token !== panel._doctorRender || panel.style.display === 'none') return;

    const problems = entries.filter(entry => isProblem(entry) || entry.state === 'changed')
        .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || (b.via === 'name-size') - (a.via === 'name-size'));
    const fixable = entries.filter(entry => entry.state === 'fixable');
    const here = entries.filter(entry => entry.state === 'ready' || entry.state === 'changed');
    const replaced = here.filter(entry => replacedFrom(entry.widget));

    const page = el('div', 'anomalous-scan-page');
    head(page);
    const stats = el('div', 'anomalous-scan-stats');
    const missing = entries.filter(isProblem).length - fixable.length;
    stats.append(
        stat(entries.length, t('doctorStatUsed')),
        stat(here.length, t('doctorStatHere'), 'ok'),
        stat(fixable.length, t('doctorStatFixable'), fixable.length ? 'new' : ''),
        stat(missing, t('doctorStatMissing'), missing ? 'bad' : ''),
    );
    page.append(stats);

    const actions = el('div', 'anomalous-scan-actions');
    if (fixable.length) {
        actions.append(button('anomalous-scan-primary', t('doctorPutInAll', { count: fixable.length }), () => {
            fixWorkflowModels(fixable);
            renderDoctorPage(owner, panel);
        }));
    }
    actions.append(button('anomalous-scan-secondary', t('doctorRecheck'), () => renderDoctorPage(owner, panel, { refresh: true })),
        button('anomalous-scan-secondary', t('doctorSources'), () => owner.showModelSources('workflow')));
    page.append(actions);
    const verdict = !entries.length ? t('doctorNoModels')
        : !entries.some(isProblem) ? t('doctorAllHere', { count: entries.length })
            : t('doctorHowItWorks');
    page.append(el('p', 'anomalous-scan-muted', verdict));

    if (problems.length) page.append(card(t('doctorToHandle'), problems.map(entry => problemRow(owner, panel, entry))));
    if (hint) page.append(hint);
    if (replaced.length) {
        page.append(card(t('doctorReplaced'), replaced.map(entry => simpleRow(entry, t('doctorWas', { file: replacedFrom(entry.widget) })))));
    }
    const ready = here.filter(entry => entry.state === 'ready' && !replacedFrom(entry.widget));
    if (ready.length) {
        const fold = el('details', 'anomalous-scan-advanced');
        const list = el('div', 'anomalous-scan-rows');
        list.append(...ready.map(entry => simpleRow(entry)));
        fold.append(el('summary', '', t('doctorHereList', { count: ready.length })), list);
        page.append(fold);
    }
    panel.replaceChildren(page);
}

/** The rail's doctor button, Home's card and the canvas banner's "Show". */
export function openDoctorPage(owner) {
    owner.enterToolPage?.('doctor');
    owner.hideAllPanels();
    owner.doctorPanel.style.display = 'flex';
    renderDoctorPage(owner, owner.doctorPanel, { refresh: true });
}
