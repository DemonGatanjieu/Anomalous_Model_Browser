/**
 * "Change type" for one model (its page's actions, model_detail_head.js; the toast after an
 * import, ui_model_import.js): for a file filed under the wrong type, which the header could not
 * tell, or told wrongly. The window says where it is now and what its header looks like (the
 * type it seems to be is marked; nothing when the header tells nothing), offers every type with
 * the node that loads it, where it would go (the root and the same subfolder, changeable, the full
 * path shown), and "Move there", done as the Tidy view moves models (api/model_placement.py:
 * covers and notes along, never over a file). Then ComfyUI's lists and the models page are read
 * anew and `done(moved)` runs.
 */

import { app } from "../../../scripts/app.js";
import { translate as t } from './locales.js';
import { IMPORT_KINDS, fetchImportFolders } from './model_import.js';
import { lookModel, moveErrorText, moveModel } from './model_placement.js';
import { joinPath } from './ui_model_download.js';
import { createViewScope } from './ui_lifecycle.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

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

const kindName = kind => (t(`importKind_${kind}`) === `importKind_${kind}` ? kind : t(`importKind_${kind}`));

/** What the header says, in a line. */
function guessLine(item, found) {
    if (!found?.kind) return t('retypeGuessNone');
    if (found.kind === item.type) return t(found.sure ? 'retypeGuessSame' : 'retypeGuessSameMaybe', { kind: kindName(found.kind) });
    return t(found.sure ? 'retypeGuessSure' : 'retypeGuessMaybe', { kind: kindName(found.kind) });
}

/** The window for model `item` ({type, root, rel, name}). */
export async function openRetype(owner, item, done = () => {}) {
    const scope = createViewScope();
    const overlay = el('div', 'anomalous-dialog-overlay anomalous-download-overlay');
    const dialog = el('div', 'anomalous-download-dialog anomalous-retype-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const now = el('div', 'anomalous-download-note', t('retypeNow', { kind: kindName(item.type) }));
    const guess = el('div', 'anomalous-retype-guess', t('retypeLooking'));
    const kinds = el('div', 'anomalous-retype-kinds');
    const where = el('div', 'anomalous-retype-where');
    const failure = el('div', 'anomalous-download-note is-bad');
    failure.hidden = true;
    const footer = el('div', 'anomalous-download-footer');
    const cancel = button('anomalous-scan-secondary', t('dialogCancel'), () => close());
    const go = button('anomalous-scan-primary', t('retypeGo'), () => void move());
    go.disabled = true;
    footer.append(cancel, go);
    dialog.append(el('h3', 'anomalous-download-title', t('retypeTitle', { name: item.name })), now, guess, kinds, where,
        el('div', 'anomalous-download-note', t('retypeNote')), failure, footer);
    overlay.append(dialog);
    document.body.append(overlay);

    let busy = false;
    let folders = {};
    let chosen = '';
    let root = null;
    const rel = el('input', 'anomalous-download-rel');
    rel.type = 'text';
    rel.spellcheck = false;
    rel.value = item.rel;
    const full = el('div', 'anomalous-download-path');

    function close() {
        if (busy) return;
        scope.dispose();
        overlay.remove();
    }
    scope.listen(document, 'keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
    }, true);
    overlay.onclick = (event) => { if (event.target === overlay) close(); };

    function drawWhere() {
        const roots = folders[chosen] || [];
        if (!chosen || !roots.length) {
            where.replaceChildren();
            go.disabled = true;
            return;
        }
        if (!roots.includes(root)) root = roots.find(entry => entry.exists) || roots[0];
        const parts = [el('div', 'anomalous-retype-label', t('retypeWhere'))];
        if (roots.length > 1) {
            const select = el('select', 'anomalous-download-root');
            for (const entry of roots) {
                const option = el('option', '', entry.path);
                option.value = String(entry.index);
                select.append(option);
            }
            select.value = String(root.index);
            select.onchange = () => {
                root = roots.find(entry => String(entry.index) === select.value) || root;
                showPath();
            };
            parts.push(select);
        }
        const showPath = () => { full.textContent = joinPath(root.path, rel.value.trim().replace(/\\/g, '/')); };
        rel.oninput = showPath;
        showPath();
        where.replaceChildren(...parts, rel, full);
        go.disabled = busy || !rel.value.trim();
    }

    function drawKinds(found) {
        kinds.replaceChildren(...IMPORT_KINDS.filter(kind => folders[kind]).map((kind) => {
            const card = button(`anomalous-retype-kind${kind === chosen ? ' is-on' : ''}${kind === item.type ? ' is-current' : ''}`, '', () => {
                chosen = kind;
                drawKinds(found);
                drawWhere();
            });
            card.title = t(`importKindHelp_${kind}`);
            card.disabled = kind === item.type;
            const top = el('span', 'anomalous-retype-kind-name', kindName(kind));
            if (kind === item.type) top.append(el('span', 'anomalous-retype-badge', t('retypeHere')));
            else if (kind === found?.kind) top.append(el('span', `anomalous-retype-badge${found.sure ? ' is-sure' : ''}`, t(found.sure ? 'retypeSuggested' : 'retypeMaybe')));
            card.append(top, el('span', 'anomalous-retype-kind-loader', t(`tidyLoader_${kind}`)));
            return card;
        }));
    }

    async function move() {
        if (busy || !chosen || !root) return;
        busy = true;
        go.disabled = cancel.disabled = true;
        failure.hidden = true;
        try {
            const moved = await moveModel(item, { type: chosen, root: root.index, rel: rel.value.trim().replace(/\\/g, '/') });
            busy = false;
            close();
            showWorkbenchToast(t('retypeDone', { name: item.name, kind: kindName(moved.type), loader: t(`tidyLoader_${moved.type}`) }));
            try {
                await app.refreshComboInNodes?.();
            } catch (error) {
                console.warn('[AMB] Change type: could not reload the model lists.', error);
            }
            owner.loadFolders?.();
            done(moved);
        } catch (error) {
            busy = false;
            cancel.disabled = false;
            go.disabled = false;
            failure.textContent = moveErrorText(error);
            failure.hidden = false;
        }
    }

    const [listed, found] = await Promise.all([
        fetchImportFolders().catch(() => ({ types: {} })),
        lookModel(item).catch(() => null),
    ]);
    if (scope.signal.aborted) return;
    folders = listed.types || {};
    guess.textContent = guessLine(item, found);
    guess.classList.toggle('is-sure', Boolean(found?.sure && found.kind && found.kind !== item.type));
    if (found?.kind && found.kind !== item.type && folders[found.kind]) chosen = found.kind;
    drawKinds(found);
    drawWhere();
}
