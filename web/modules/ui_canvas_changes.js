/** Shared read-only activity receipt: recorded before/after values, never a live graph guess. */
import { translate as t } from './locales.js';
import { changeLine } from './activity_log.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function changeRow(change, locate) {
    const row = el('div', `anomalous-canvas-change is-${change.kind}`);
    const head = el('div', 'anomalous-canvas-change-head');
    head.append(el('span', 'anomalous-canvas-change-node', change.node));
    if (change.widget) head.append(el('span', 'anomalous-canvas-change-widget', change.widget));
    if (locate && change.kind !== 'removed') {
        const button = el('button', 'anomalous-ai-link', t('activityLocate'));
        button.type = 'button';
        button.onclick = () => locate(change);
        head.append(button);
    }
    row.append(head);
    if (change.kind === 'changed') {
        const values = el('div', 'anomalous-canvas-change-values');
        for (const side of ['before', 'after']) {
            const cell = el('div', `anomalous-canvas-change-value is-${side}`);
            cell.append(el('span', 'anomalous-canvas-change-label', t(side === 'before' ? 'aiChangeBefore' : 'aiChangeAfter')),
                el('div', 'anomalous-canvas-change-text', change[side] || t('activityEmptyValue')));
            values.append(cell);
        }
        row.append(values);
    } else row.append(el('div', 'anomalous-canvas-change-description', changeLine(change)));
    return row;
}

export function canvasChanges(entry, { locate = null } = {}) {
    const box = el('div', 'anomalous-canvas-changes');
    const changes = (entry?.detail?.changes || []).filter(change => change.kind !== 'opened');
    if (!changes.length) {
        box.append(el('div', 'anomalous-canvas-change-note', t('aiChangesUnavailable')));
        return box;
    }
    box.append(el('div', 'anomalous-canvas-changes-title', t('aiCanvasReceipt', { count: entry.detail.total || changes.length })));
    box.append(...changes.slice(0, 3).map(change => changeRow(change, locate)));
    if (changes.length > 3) {
        const more = el('details', 'anomalous-canvas-change-more');
        more.append(el('summary', '', t('aiMoreChanges', { count: changes.length - 3 })));
        more.addEventListener('toggle', () => {
            if (more.open && more.children.length === 1) more.append(...changes.slice(3).map(change => changeRow(change, locate)));
        });
        box.append(more);
    }
    if (entry.detail.total > changes.length) box.append(el('div', 'anomalous-canvas-change-note', t('activityMore', { count: entry.detail.total - changes.length })));
    box.append(el('div', 'anomalous-canvas-change-note', t('aiChangeExcerpt')));
    return box;
}
