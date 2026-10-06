/**
 * Combos with a node structure (combo_structure.js), on the Combos page: saving the canvas's
 * picked nodes as one (a dialog listing what is kept and its slots, which can be renamed or
 * dropped), its editor (models, LoRAs and prompts in the order they flow: a model chosen from
 * that slot's models folder, filtered by base model, with its node's saved values shown; a text
 * box), and "New" offering the default combo, the picked nodes, or the
 * structure of a combo already saved. The canvas's node menu has "Save as combo" too
 * (browser_entry.js). Putting one on the canvas is notebook_canvas.js.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { STRUCTURED, chainOrder, isModelWidget, missingTypes, structureKey, structureSummary } from './combo_slots.js';
import { typeTakesPrompt } from './prompt_boxes.js';
import { captureStructure } from './combo_structure.js';
import { freeComboName, listCombos } from './image_keep.js';
import { anomalousAlert, anomalousPrompt } from './ui_dialog.js';
import { typeLabel } from './ui_model_types.js';
import { showTranslation, translationTarget } from './ui_translation_peek.js';

const SAVE_WAIT_MS = 500;
const MAX_PATHS = 4; // models folders a type may have (extra_model_paths)
const TEXT_MAX_PX = 260; // a prompt box grows with its text up to this, then scrolls
const FIXED_MAX_CHARS = 40; // longer saved values are not listed beside a model
// Slot names by models folder; other folders use the models page's name.
const SLOT_NAMES = { diffusion_models: 'comboSlotMainModel', checkpoints: 'comboSlotMainModel', unet: 'comboSlotMainModel',
    text_encoders: 'comboSlotTextEncoder', clip: 'comboSlotTextEncoder' };
// Saved values shown beside a model, named by their box ("strength_02", "lora_3_clip_strength", "model_weight_1"…).
const FIXED_NAMES = [
    [/^(lora_)?strength_?clip$|^lora_(\d+_)?clip_strength$|^clip_weight_\d+$|^strength_clip_\d+$/i, 'comboFixedClipStrength'],
    [/^(lora_)?strength(_?model)?(_\d+)?$|^lora_(\d+_)?(model_)?strength$|^model_weight_\d+$/i, 'comboFixedStrength'],
    [/^weight_dtype$/i, 'comboFixedDtype'], [/^type$/i, 'comboFixedType'], [/^device$/i, 'comboFixedDevice'],
];
const FIXED_SHOWN = 4; // more saved values fold behind "+N"
const numberIn = (name) => { const found = String(name).match(/(\d+)(?!.*\d)/); return found ? Number(found[1]) : null; };
// A model without a cover shows its kind in the empty frame.
const SHORT_TYPES = { loras: 'LoRA', vae: 'VAE', text_encoders: 'CLIP', clip: 'CLIP', clip_vision: 'CLIP-V', diffusion_models: 'UNet',
    unet: 'UNet', checkpoints: 'CKPT', controlnet: 'CN', upscale_models: 'UP' };

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

const fileName = (value) => String(value || '').split(/[\\/]/).pop();
const shortName = (value) => fileName(value).replace(/\.[^.]+$/, '');
const isNone = (value) => /^\s*(none)?\s*$/i.test(String(value ?? ''));
const modelRel = (model) => [String(model.subfolder || '').replace(/^\/+|\/+$/g, ''), model.filename].filter(Boolean).join('/');
const sameRel = (a, b) => String(a || '').replace(/\\/g, '/') === String(b || '').replace(/\\/g, '/');
const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shortType = (folder) => SHORT_TYPES[folder] || '';

/** A slot's default name: the model type ("LoRA 2") or the prompt's role. */
export function slotLabel({ kind, folder, index, role }) {
    if (kind === 'text') return t(role === 'negative' ? 'comboSlotNegative' : role === 'positive' ? 'comboSlotPositive' : 'comboSlotText');
    const name = SLOT_NAMES[folder] ? t(SLOT_NAMES[folder]) : folder ? typeLabel({ type: folder }) : t('comboSlotModel');
    return index ? `${name} ${index}` : name;
}

/** Whether a slot still has a name made for it (now or by an older version), not one the user gave. */
function isDefaultLabel(slot) {
    const label = String(slot.label || '').trim();
    if (!label || label === slot.widget) return true;
    if (slot.kind === 'text') return ['comboSlotPositive', 'comboSlotNegative', 'comboSlotText'].some(key => label === t(key));
    const names = [slotLabel({ kind: 'model', folder: slot.folder }), slot.folder ? typeLabel({ type: slot.folder }) : t('comboSlotModel')];
    return names.some(name => new RegExp(`^${escapeRe(name)}( \\d+)?$`).test(label));
}

/**
 * The saved values ("强度 0.85") shown on `slot`'s row: the short ones of its node, without slots
 * and plain defaults. On a node with several models a value goes to the row with its number
 * (strength_02 → lora_02); one without a number goes to the node's first model row, one whose
 * row is no slot is not shown.
 */
function fixedValues(node, slots, slot) {
    const own = slots.filter(item => item.node === node?.key);
    const models = own.filter(item => item.kind === 'model');
    const taken = new Set(own.map(item => item.widget));
    const rowOf = (name) => {
        if (models.length < 2 || numberIn(name) === null) return models[0];
        return models.find(item => numberIn(item.widget) === numberIn(name));
    };
    return (node?.widgets || []).filter(([name, value]) => !taken.has(name) && value !== null && value !== ''
        && !/^(default|none)$/i.test(String(value)) && String(value).length <= FIXED_MAX_CHARS && rowOf(name) === slot)
        .map(([name, value]) => {
            const known = FIXED_NAMES.find(([pattern]) => pattern.test(name));
            return `${known ? t(known[1]) : name} ${typeof value === 'number' ? Number(value.toFixed(3)) : value}`;
        });
}

/** An overlay with `dialog` in it; Esc or a click beside it calls `onClose`. */
function overlay(dialog, onClose) {
    const back = el('div', 'anomalous-dialog-overlay anomalous-structure-overlay');
    back.append(dialog);
    const close = () => {
        back.remove();
        document.removeEventListener('keydown', onKey, true);
        onClose?.();
    };
    const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
    };
    back.onclick = (event) => { if (event.target === back) close(); };
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    return close;
}

/** The cover of a model chosen elsewhere (canvas), looked up by its file name; '' when unknown. */
async function coverOf(value) {
    if (isNone(value)) return '';
    try {
        const data = await (await fetch(`/anomalous/find_model?search=${encodeURIComponent(fileName(value))}`)).json();
        return data?.model && fileName(data.model.filename) === fileName(value) ? data.model.preview_url || '' : '';
    } catch {
        return '';
    }
}

async function saveAndOpen(owner, note) {
    owner.currentNotebook = note;
    if (!(await owner.saveCurrentNotebook())) return;
    owner.show?.(); // from the canvas's menu the browser may be closed
    await owner.openCombo(note);
}

/** The nodes a canvas menu acts on: the picked ones when the node is one of them, else that node. */
export function menuNodes(node) {
    const picked = Object.values(app.canvas?.selected_nodes || {});
    return picked.includes(node) ? picked : [node];
}

/** Whether a combo could keep any of these nodes (a model drop-down or a prompt box). */
export function hasComboNodes(nodes) {
    return nodes.some(node => (node.widgets || []).some(isModelWidget) || typeTakesPrompt(node.type));
}

/** Saves the canvas's picked nodes (or `nodes`, from the canvas menu) as a new combo, after a dialog showing what is kept. */
export async function saveSelectionAsCombo(owner, nodes = null) {
    const picked = nodes || Object.values(app.canvas?.selected_nodes || {});
    if (!picked.length) {
        await anomalousAlert(t('comboFromSelectionNone'));
        return;
    }
    let captured;
    try {
        captured = await captureStructure(picked, { labelFor: slotLabel });
    } catch (error) {
        console.error('[AMB] Combo: reading the picked nodes failed.', error);
        await anomalousAlert(t('comboFromSelectionFailed'));
        return;
    }
    const { structure, values, dropped } = captured;
    if (!structure) {
        await anomalousAlert(t('comboFromSelectionNothing', { count: dropped.length }));
        return;
    }
    const name = freeComboName(t('comboStructureName'), await listCombos());

    const dialog = el('div', 'anomalous-structure-dialog');
    dialog.setAttribute('role', 'dialog');
    const nameInput = el('input', 'anomalous-structure-name');
    nameInput.value = name;
    dialog.append(el('h3', 'anomalous-structure-title', t('comboFromSelectionTitle')), nameInput,
        el('p', 'anomalous-structure-note', t('comboFromSelectionKept', { count: structure.nodes.length, nodes: structureSummary(structure) })));
    if (dropped.length) {
        dialog.append(el('p', 'anomalous-structure-note is-muted', t('comboFromSelectionDropped', {
            count: dropped.length, nodes: dropped.map(node => node.title || node.type).join('、'),
        })));
    }
    const rows = el('div', 'anomalous-structure-slots');
    const choices = structure.slots.map((slot) => {
        const row = el('label', 'anomalous-structure-slot');
        const keep = el('input');
        keep.type = 'checkbox';
        // An empty row of a stack node (a LoRA stack's ten rows) is no slot unless ticked.
        keep.checked = !(slot.optional && isNone(values[slot.id]));
        const label = el('input', 'anomalous-structure-slot-label');
        label.value = slot.label;
        const node = structure.nodes.find(item => item.key === slot.node);
        const where = `${node?.title || node?.name || node?.type || ''} · ${slot.widget}`;
        const now = slot.kind === 'model' ? fileName(values[slot.id]) || t('comboSlotEmpty') : String(values[slot.id] || '').slice(0, 60) || t('comboSlotEmpty');
        row.append(keep, label, el('span', 'anomalous-structure-slot-where', `${where} — ${now}`));
        rows.append(row);
        return { slot, keep, label };
    });
    dialog.append(el('p', 'anomalous-structure-note', t('comboFromSelectionSlots')), rows);
    if (!structure.slots.length) rows.append(el('p', 'anomalous-structure-note is-muted', t('comboFromSelectionNoSlots')));

    const footer = el('div', 'anomalous-structure-footer');
    const close = overlay(dialog);
    footer.append(button('anomalous-scan-secondary', t('dialogCancel'), close), button('anomalous-scan-primary', t('comboFromSelectionSave'), async () => {
        const kept = choices.filter(choice => choice.keep.checked);
        const slots = kept.map(({ slot, label }) => ({ ...slot, label: label.value.trim() || slot.label }));
        const keptValues = Object.fromEntries(slots.map(slot => [slot.id, values[slot.id]]));
        const models = slots.filter(slot => slot.kind === 'model' && !isNone(keptValues[slot.id]));
        const covers = Object.fromEntries(await Promise.all(models.map(async slot => [slot.id, await coverOf(keptValues[slot.id])])));
        const finalName = freeComboName(nameInput.value.trim() || name, await listCombos());
        close();
        await saveAndOpen(owner, {
            filename: `${finalName}.json`, name: finalName,
            data: { name: finalName, kind: STRUCTURED, structure: { ...structure, slots }, values: keptValues, covers },
        });
    }));
    dialog.append(footer);
    nameInput.focus();
    nameInput.select();
}

/** The models of a folder type, from every models folder of that type. */
async function modelsOf(folder) {
    const lists = await Promise.all(Array.from({ length: MAX_PATHS }, async (_unused, index) => {
        try {
            const data = await (await fetch(`/anomalous/type_models?type=${encodeURIComponent(folder)}&path_idx=${index}`)).json();
            return data.models || [];
        } catch {
            return [];
        }
    }));
    return lists.flat();
}

/** Picks a model for `slot`: its folder's models with their covers, by base model and name. Resolves { rel, cover } or null. */
function pickModel(slot, current) {
    return new Promise((resolve) => {
        const dialog = el('div', 'anomalous-structure-dialog is-picker');
        const search = el('input', 'anomalous-structure-search');
        search.type = 'search';
        search.placeholder = t('comboPickSearch');
        const bases = el('div', 'anomalous-structure-bases');
        const grid = el('div', 'anomalous-structure-models');
        grid.append(el('p', 'anomalous-structure-note', t('loading')));
        dialog.append(el('h3', 'anomalous-structure-title', t('comboPickTitle', { slot: slot.label })), search, bases, grid);
        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            close();
            resolve(value);
        };
        const close = overlay(dialog, () => finish(null));
        modelsOf(slot.folder).then((models) => {
            const baseOf = (model) => String(model.metadata?.baseModel || '').trim();
            const known = [...new Set(models.map(baseOf).filter(Boolean))].sort();
            let base = baseOf(models.find(model => sameRel(modelRel(model), current)) || {}) || '';
            const draw = () => {
                bases.replaceChildren(...['', ...known].map(name => {
                    const chip = button(`anomalous-structure-base${name === base ? ' is-active' : ''}`, name || t('comboPickAllBases'), () => {
                        base = name;
                        draw();
                    });
                    return chip;
                }));
                const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
                const shown = models.filter(model => (!base || baseOf(model) === base)
                    && words.every(word => `${model.filename} ${model.metadata?.custom_name || ''} ${model.metadata?.name || ''}`.toLowerCase().includes(word)));
                grid.replaceChildren(...shown.map((model) => {
                    const card = button(`anomalous-structure-model${sameRel(modelRel(model), current) ? ' is-current' : ''}`, '', () => {
                        finish({ rel: modelRel(model), cover: model.preview_url || '' });
                    });
                    if (model.preview_url && !/\.(mp4|webm)(?:&|$)/i.test(model.preview_url)) {
                        const img = el('img');
                        img.loading = 'lazy';
                        img.alt = '';
                        img.src = model.preview_url;
                        card.append(img);
                    }
                    card.append(el('span', 'anomalous-structure-model-name', model.metadata?.custom_name || shortName(model.filename)));
                    // Base model and folder: two files of one name in different folders are told apart.
                    const folder = String(model.subfolder || '').replace(/^\/+|\/+$/g, '');
                    const facts = [baseOf(model), folder].filter(Boolean).join(' · ');
                    if (facts) card.append(el('span', 'anomalous-structure-model-base', facts));
                    card.title = modelRel(model);
                    return card;
                }));
                if (!shown.length) grid.append(el('p', 'anomalous-structure-note', t(models.length ? 'comboPickNoMatch' : 'comboPickNone')));
            };
            search.oninput = draw;
            draw();
            search.focus();
        });
    });
}

/** The editor of a combo with a structure: models, LoRAs and prompts in the order they flow, and what the structure needs. */
export function renderStructuredCombo(owner, host, note, toolbar) {
    const data = note.data;
    data.values ||= {};
    data.covers ||= {};
    const structure = data.structure || { nodes: [], links: [], slots: [] };
    const nodeOf = new Map(structure.nodes.map(item => [item.key, item]));
    let timer = 0;
    const save = (now = false) => {
        clearTimeout(timer);
        if (now) void owner.saveCurrentNotebook();
        else timer = setTimeout(() => void owner.saveCurrentNotebook(), SAVE_WAIT_MS);
    };

    // Slots in flow order: by node along the links, then by their place on the node.
    const order = chainOrder(structure.nodes.map(item => item.key), structure.links.map(link => [link.from, link.to]));
    const rank = (slot) => order.indexOf(slot.node) * 1000 + structure.slots.indexOf(slot);
    const sorted = [...structure.slots].sort((a, b) => rank(a) - rank(b));
    const textRank = (slot) => ({ positive: 0, '': 1, negative: 2 }[slot.role || ''] ?? 1);
    const groups = [
        ['comboGroupModels', sorted.filter(slot => slot.kind === 'model' && slot.folder !== 'loras')],
        ['comboGroupLoras', sorted.filter(slot => slot.kind === 'model' && slot.folder === 'loras')],
        ['comboGroupPrompts', sorted.filter(slot => slot.kind === 'text').sort((a, b) => textRank(a) - textRank(b) || rank(a) - rank(b))],
    ];
    // Names left as they were made ("LoRA 3") are renumbered along the chain; names the user gave stay.
    const counts = {};
    const seen = {};
    for (const slot of sorted) if (slot.kind === 'model') counts[slot.folder] = (counts[slot.folder] || 0) + 1;
    const labels = new Map(sorted.map(slot => {
        if (!isDefaultLabel(slot)) return [slot.id, slot.label];
        if (slot.kind === 'text') return [slot.id, slotLabel(slot)];
        seen[slot.folder] = (seen[slot.folder] || 0) + 1;
        return [slot.id, slotLabel({ ...slot, index: counts[slot.folder] > 1 ? seen[slot.folder] : 0 })];
    }));
    // Which node a slot is on, and its node pack when it is not ComfyUI's own.
    const labelLine = (slot) => {
        const line = el('span', 'anomalous-structure-label', labels.get(slot.id));
        const node = nodeOf.get(slot.node);
        if (node) {
            line.append(el('span', 'anomalous-structure-node', ` · ${node.title || node.name || node.type}${node.pack ? `（${node.pack}）` : ''}`));
            line.title = node.pack ? `${node.type} · ${node.pack}` : node.type;
        }
        return line;
    };

    const drawThumb = (slot) => {
        const thumb = el('div', 'anomalous-structure-thumb');
        thumb.dataset.kind = shortType(slot.folder);
        const url = data.covers[slot.id];
        if (url) {
            const img = el('img');
            img.alt = '';
            img.src = url;
            img.onerror = () => img.remove();
            thumb.append(img);
        }
        return thumb;
    };
    const pick = async (slot, row) => {
        const chosen = await pickModel({ ...slot, label: labels.get(slot.id) }, data.values[slot.id]);
        if (!chosen) return;
        data.values[slot.id] = chosen.rel;
        data.covers[slot.id] = chosen.cover;
        save(true);
        row.replaceWith(drawModel(slot));
    };
    const drawModel = (slot) => {
        const row = el('div', 'anomalous-structure-row is-model');
        row.dataset.slot = slot.id;
        const value = data.values[slot.id];
        const copy = el('div', 'anomalous-structure-copy');
        copy.append(labelLine(slot),
            el('strong', 'anomalous-structure-value', isNone(value) ? t('comboSlotEmpty') : shortName(value)));
        if (!isNone(value)) copy.title = value;
        // The node's other values, as saved: shown, not changed here (a combo puts down exactly what was saved).
        const fixed = fixedValues(nodeOf.get(slot.node), structure.slots, slot);
        if (fixed.length) {
            const line = el('span', 'anomalous-structure-fixed');
            line.title = t('comboFixedHint');
            line.append(...fixed.slice(0, FIXED_SHOWN).map(text => el('span', 'anomalous-structure-chip', text)));
            if (fixed.length > FIXED_SHOWN) {
                const more = button('anomalous-structure-chip is-more', `+${fixed.length - FIXED_SHOWN}`, () => {
                    more.replaceWith(...fixed.slice(FIXED_SHOWN).map(text => el('span', 'anomalous-structure-chip', text)));
                });
                line.append(more);
            }
            copy.append(line);
        }
        const actions = el('div', 'anomalous-structure-actions');
        if (slot.folder) {
            actions.append(button('anomalous-scan-row-btn is-main', t('comboPick'), () => pick(slot, row)));
            row.classList.add('is-pickable');
            row.onclick = (event) => { if (!event.target.closest('button')) void pick(slot, row); };
        } else {
            copy.append(el('span', 'anomalous-structure-note is-muted', t('comboSlotUnknownFolder')));
        }
        if (slot.optional && !isNone(value)) {
            actions.append(button('anomalous-scan-row-btn', t('comboSlotClear'), () => {
                data.values[slot.id] = 'None';
                delete data.covers[slot.id];
                save(true);
                row.replaceWith(drawModel(slot));
            }));
        }
        row.append(drawThumb(slot), copy, actions);
        return row;
    };
    const fits = [];
    const drawText = (slot) => {
        const row = el('div', 'anomalous-structure-row is-text');
        const box = el('textarea', 'anomalous-structure-text');
        box.value = String(data.values[slot.id] ?? '');
        box.rows = 3;
        // As tall as its text, up to a limit; then it scrolls.
        const fit = () => {
            box.style.height = 'auto';
            box.style.height = `${Math.min(box.scrollHeight + 2, TEXT_MAX_PX)}px`;
        };
        fits.push(fit);
        box.oninput = () => {
            data.values[slot.id] = box.value;
            fit();
            save();
        };
        const head = el('div', 'anomalous-structure-text-head');
        head.append(labelLine(slot));
        // A quick look at what the prompt says; Prompt Studio is where prompts are worked on.
        if (translationTarget(box.value) || window.anomalous_browser_lang === 'zh') {
            const translateBtn = button('anomalous-structure-translate', t('comboTranslate'), () => {
                if (box.value.trim()) void showTranslation(translateBtn, box.value);
            });
            translateBtn.title = t('comboTranslateHint');
            head.append(translateBtn);
        }
        row.append(head, box);
        return row;
    };

    const card = el('section', 'anomalous-structure-card');
    for (const [key, slots] of groups) {
        if (!slots.length) continue;
        const section = el('div', 'anomalous-structure-group');
        const heading = el('h4', 'anomalous-structure-heading', t(key));
        if (slots.length > 1) heading.append(el('span', 'anomalous-structure-count', String(slots.length)));
        section.append(heading, ...slots.map(slot => (slot.kind === 'text' ? drawText(slot) : drawModel(slot))));
        card.append(section);
    }
    if (!structure.slots.length) card.append(el('p', 'anomalous-structure-note', t('comboFromSelectionNoSlots')));

    const about = el('div', 'anomalous-structure-about');
    about.append(el('p', 'anomalous-structure-note is-muted', t('comboStructureNodes', { nodes: structureSummary(structure) })),
        el('p', 'anomalous-structure-note is-muted', t('comboFixedHint')));
    const packs = [...new Set(structure.nodes.map(item => item.pack).filter(Boolean))];
    if (packs.length) about.append(el('p', 'anomalous-structure-note is-muted', t('comboStructurePacks', { packs: packs.join('、') })));
    const missing = missingTypes(structure);
    if (missing.length) {
        about.append(el('p', 'anomalous-structure-note is-bad', t('comboStructureMissing', {
            nodes: missing.map(item => (item.pack ? `${item.type}（${item.pack}）` : item.type)).join('、'),
        })));
    }
    card.append(about);
    host.replaceChildren(toolbar, card);
    for (const fit of fits) fit();

    // Covers of models chosen on the canvas, looked up once and kept with the combo.
    const lacking = structure.slots.filter(slot => slot.kind === 'model' && !data.covers[slot.id] && !isNone(data.values[slot.id]));
    if (lacking.length) {
        void Promise.all(lacking.map(async (slot) => {
            const url = await coverOf(data.values[slot.id]);
            if (!url || owner.currentNotebook !== note) return false;
            data.covers[slot.id] = url;
            const thumb = host.querySelector(`[data-slot="${slot.id}"] .anomalous-structure-thumb`);
            thumb?.replaceWith(drawThumb(slot));
            return true;
        })).then(found => { if (found.some(Boolean) && owner.currentNotebook === note) save(true); });
    }
}

/** "New": the default combo, the canvas's picked nodes, or a structure a saved combo has. */
export async function chooseNewCombo(owner, newDefault) {
    const combos = await listCombos().catch(() => []);
    const structures = [];
    const seen = new Set();
    for (const note of combos) {
        if (note.data?.kind !== STRUCTURED || !note.data.structure) continue;
        const key = structureKey(note.data.structure);
        if (seen.has(key)) continue;
        seen.add(key);
        structures.push(note);
    }
    const picked = Object.keys(app.canvas?.selected_nodes || {}).length;
    const dialog = el('div', 'anomalous-structure-dialog');
    const close = overlay(dialog);
    const option = (title, hint, onPick, disabled = false) => {
        const item = button('anomalous-structure-option', '', () => {
            close();
            void onPick();
        });
        item.disabled = disabled;
        item.append(el('strong', '', title), el('span', 'anomalous-structure-note is-muted', hint));
        return item;
    };
    dialog.append(el('h3', 'anomalous-structure-title', t('comboNew')),
        option(t('comboNewDefault'), t('comboNewDefaultHint'), newDefault),
        option(t('comboNewFromSelection'), picked ? t('comboNewFromSelectionHint', { count: picked }) : t('comboNewFromSelectionEmpty'),
            () => saveSelectionAsCombo(owner), !picked));
    for (const note of structures) {
        dialog.append(option(t('comboNewLike', { name: note.name }), structureSummary(note.data.structure), async () => {
            const wanted = String(await anomalousPrompt(t('comboNewName'), '', t('comboNew')) || '').trim();
            if (!wanted) return;
            const name = freeComboName(wanted, await listCombos());
            const copy = JSON.parse(JSON.stringify(note.data));
            await saveAndOpen(owner, { filename: `${name}.json`, name, data: { ...copy, name } });
        }));
    }
    dialog.append(el('div', 'anomalous-structure-footer'));
    dialog.lastChild.append(button('anomalous-scan-secondary', t('dialogCancel'), close));
}

/** The card's line for a combo with a structure: its slots in short. */
export function structuredComboMeta(data) {
    const slots = data.structure?.slots || [];
    const models = slots.filter(slot => slot.kind === 'model' && !isNone(data.values?.[slot.id])).map(slot => shortName(data.values[slot.id]));
    const text = slots.find(slot => slot.kind === 'text' && String(data.values?.[slot.id] || '').trim());
    return {
        cover: Object.values(data.covers || {}).find(Boolean) || '',
        meta: models.length ? models.slice(0, 3).join(' · ') + (models.length > 3 ? ' …' : '') : t('comboNoModel'),
        prompt: text ? String(data.values[text.id]).trim() : '',
    };
}
