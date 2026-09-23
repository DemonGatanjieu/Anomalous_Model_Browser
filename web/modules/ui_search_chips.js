import { translate } from './locales.js';

/**
 * Search box whose terms are visible blocks. Enter (or a comma) turns the typed
 * text into a block; a block may contain spaces and matches as one phrase.
 * The text still being typed also takes part in the search.
 */

const t = (key, params) => translate(key, params);
const COMMIT_KEYS = new Set(['Enter', ',', '，', '、']);
const DRAFT_DELAY_MS = 350;

/** 'hash' for 8+ hex characters, 'number' for digits (seed, steps…), else 'text'. */
export function termKind(term) {
    const value = String(term || '').trim();
    if (/^\d+$/.test(value)) return 'number';
    if (/^[0-9a-f]{8,64}$/i.test(value)) return 'hash';
    return 'text';
}

function normaliseTerm(term) {
    return String(term || '').replace(/\s+/g, ' ').trim();
}

export function createSearchChips({ placeholder = '', help = '', onChange } = {}) {
    const root = document.createElement('div');
    root.className = 'anomalous-search-chips';
    if (help) root.title = help;

    const icon = document.createElement('span');
    icon.className = 'anomalous-search-chips-icon';
    icon.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

    const list = document.createElement('div');
    list.className = 'anomalous-search-chips-list';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'anomalous-search-chips-input';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);

    const count = document.createElement('span');
    count.className = 'anomalous-search-chips-count';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'anomalous-search-chips-clear';
    clearBtn.textContent = '×';
    clearBtn.title = t('searchChipsClear');
    clearBtn.setAttribute('aria-label', t('searchChipsClear'));

    const chips = [];
    let lastEmitted = '[]';
    let timer = null;

    const currentTerms = () => {
        const terms = [];
        for (const term of [...chips, normaliseTerm(input.value)]) {
            const key = term.toLowerCase();
            if (term && !terms.some(existing => existing.toLowerCase() === key)) terms.push(term);
        }
        return terms;
    };

    const emit = () => {
        clearTimeout(timer);
        const terms = currentTerms();
        clearBtn.hidden = terms.length === 0;
        const key = JSON.stringify(terms.map(term => term.toLowerCase()));
        if (key === lastEmitted) return;
        lastEmitted = key;
        onChange?.(terms);
    };

    const renderChips = () => {
        list.replaceChildren(...chips.map((term, index) => {
            const chip = document.createElement('span');
            const kind = termKind(term);
            chip.className = `anomalous-search-chip is-${kind}`;
            if (kind !== 'text') {
                const badge = document.createElement('span');
                badge.className = 'anomalous-search-chip-kind';
                badge.textContent = t(kind === 'hash' ? 'searchChipHash' : 'searchChipNumber');
                chip.appendChild(badge);
            }
            const label = document.createElement('span');
            label.className = 'anomalous-search-chip-text';
            label.textContent = term;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'anomalous-search-chip-remove';
            remove.textContent = '×';
            remove.title = t('searchChipRemove');
            remove.setAttribute('aria-label', t('searchChipRemove'));
            remove.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                chips.splice(index, 1);
                renderChips();
                emit();
                input.focus();
            };
            chip.append(label, remove);
            return chip;
        }));
        input.placeholder = chips.length ? '' : placeholder;
    };

    const commitDraft = () => {
        const term = normaliseTerm(input.value);
        input.value = '';
        if (term && !chips.some(existing => existing.toLowerCase() === term.toLowerCase())) chips.push(term);
        renderChips();
        emit();
    };

    input.addEventListener('keydown', (e) => {
        if (e.isComposing) return; // IME candidate selection also uses Enter
        if (COMMIT_KEYS.has(e.key)) {
            e.preventDefault();
            commitDraft();
        } else if (e.key === 'Backspace' && !input.value && chips.length) {
            e.preventDefault();
            chips.pop();
            renderChips();
            emit();
        } else if (e.key === 'Escape' && input.value) {
            e.stopPropagation();
            input.value = '';
            emit();
        }
    });
    input.addEventListener('input', (e) => {
        // IMEs insert "，" / "、" as text instead of a key event: treat them as separators too.
        if (!e.isComposing && /[,，、]/.test(input.value)) {
            const parts = input.value.split(/[,，、]/);
            const rest = parts.pop();
            for (const part of parts) {
                const term = normaliseTerm(part);
                if (term && !chips.some(existing => existing.toLowerCase() === term.toLowerCase())) chips.push(term);
            }
            input.value = rest.trimStart();
            renderChips();
            emit();
            return;
        }
        clearBtn.hidden = currentTerms().length === 0;
        clearTimeout(timer);
        timer = setTimeout(emit, DRAFT_DELAY_MS);
    });
    input.addEventListener('blur', () => { if (normaliseTerm(input.value)) commitDraft(); });
    clearBtn.onclick = () => {
        chips.length = 0;
        input.value = '';
        renderChips();
        emit();
        input.focus();
    };
    root.addEventListener('mousedown', (e) => {
        if (e.target === root || e.target === list) {
            e.preventDefault();
            input.focus();
        }
    });

    clearBtn.hidden = true;
    root.append(icon, list, input, count, clearBtn);
    return { element: root, countElement: count, getTerms: currentTerms };
}
