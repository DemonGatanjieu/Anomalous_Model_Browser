import { t } from './interface_settings.js';
import { button, el } from './usage_view.js';
import { PARAM_RANGES, SAMPLING, compareFeel, liveliness } from './tts_presets_api.js';

/**
 * The generation modes as a row of choices and what the picked one means, always against one
 * fixed mode (the default preset in the settings, Auto in the Script Director): a steady-to-lively
 * scale with both marked, a sentence ("livelier than your default"), the caller's listen row, and
 * folded, the four numbers as the Current node card's bars (base → this one), each with its
 * plain name and the node's own name (`top_k` …) and editable in place. Shared by GPT-SoVITS
 * Settings (ui_tts_presets.js) and the Script Director (ui_script_run.js); the callers keep the
 * state and draw it again after each change.
 */

const brief = value => String(Math.round(value * 100) / 100);
let numbersOpen = false; // the fold stays as the user left it, across redraws and both places

function numberInput(key, value, onChange) {
    const [min, max, step] = PARAM_RANGES[key];
    const input = el('input', 'anomalous-tts-number');
    Object.assign(input, { type: 'number', min, max, step, value });
    input.onchange = () => {
        const number = key === 'top_k' ? Math.round(Number(input.value)) : Number(input.value);
        if (Number.isFinite(number) && number >= min && number <= max) onChange(number);
        else input.value = value;
    };
    return input;
}

/** One number: two bars (base, this one), "base → this ↑", the built-in value when it was changed. */
function valueRow(key, before, now, { builtin, onEdit }) {
    const line = el('div', `anomalous-tts-switch-row${before === now ? ' is-same' : ''}`);
    const label = el('span', 'anomalous-tts-switch-label');
    label.title = t(`scriptRunParamHint_${key}`);
    label.append(el('span', '', t(`scriptRunParamName_${key}`)), el('code', '', key));
    const largest = Math.max(Math.abs(before), Math.abs(now)) || 1;
    const bars = el('span', 'anomalous-node-param-bars');
    for (const [value, kind] of [[before, 'is-now'], [now, 'is-then']]) {
        const bar = el('span', `anomalous-node-param-bar ${kind}`);
        bar.style.width = `${Math.max(3, (Math.abs(value) / largest) * 100)}%`;
        bars.append(bar);
    }
    const values = el('span', 'anomalous-node-param-nums anomalous-tts-switch-nums');
    if (before !== now) values.append(el('span', 'is-now', `${brief(before)} → `));
    if (onEdit) {
        const input = numberInput(key, now, onEdit);
        input.dataset.param = key;
        input.title = t('ttsFeelEditHint');
        values.append(input);
    } else {
        values.append(el('strong', '', brief(now)));
    }
    if (before !== now) values.append(el('span', 'anomalous-node-param-trend', now > before ? '↑' : '↓'));
    if (typeof builtin === 'number' && builtin !== now) values.append(el('span', 'anomalous-tts-switch-was', t('ttsPresetWas', { value: brief(builtin) })));
    line.append(label, bars, values);
    return line;
}

/** The steady-to-lively scale: a hollow ring for the base, a dot for the mode picked. */
function feelScale(base, now, baseName) {
    const box = el('div', 'anomalous-tts-feel');
    const track = el('div', 'anomalous-tts-feel-track');
    for (const [values, kind] of [[base, 'is-base'], [now, 'is-now']]) {
        const mark = el('span', `anomalous-tts-feel-mark ${kind}`);
        mark.style.left = `${liveliness(values)}%`;
        track.append(mark);
    }
    const ends = el('div', 'anomalous-tts-feel-ends');
    ends.append(el('span', '', t('ttsFeelSteady')), el('span', 'anomalous-tts-feel-legend', t('ttsFeelLegend', { base: baseName })),
        el('span', '', t('ttsFeelLively')));
    box.append(track, ends);
    return box;
}

/**
 * `choices`: `[{id, label, badge?}]`; `selected` and `base` are ids; `baseName` names the base in
 * sentences ("your default (Standard)"), `baseText` is said when the base itself is picked;
 * `values(id)` gives a mode's four numbers; `describe(id)` a line about it or ''; `builtin(id)`
 * its built-in numbers or null; `editable(id)`; `onPick(id)`; `onEdit(id, key, value)`;
 * `extra`: elements after the choices (a "+ New" button); `listen`: the caller's listen row;
 * `compact`: the scale goes into the fold with the numbers (the Script Director's narrow side).
 */
export function renderPresetSwitch({
    choices, selected, base, baseName, baseText, values, describe = () => '', builtin = () => null,
    editable = () => false, onPick, onEdit, extra = [], listen = null, disabled = false, compact = false,
}) {
    const box = el('div', 'anomalous-tts-switch');
    const row = el('div', 'anomalous-tts-switch-choices');
    row.setAttribute('role', 'radiogroup');
    for (const choice of choices) {
        const chip = button('anomalous-sd-run-choice', choice.label, () => { if (choice.id !== selected) onPick(choice.id); });
        chip.setAttribute('role', 'radio');
        chip.setAttribute('aria-checked', String(choice.id === selected));
        chip.disabled = disabled;
        if (choice.badge) chip.append(el('span', 'anomalous-tts-switch-badge', choice.badge));
        row.append(chip);
    }
    row.append(...extra);

    const now = values(selected);
    const before = values(base) || now;
    const said = selected === base ? baseText : t(`ttsFeel_${compareFeel(before, now)}`, { base: baseName });
    const sentence = el('div', 'anomalous-tts-feel-say');
    sentence.append(el('strong', '', said));
    const about = describe(selected);
    if (about) sentence.append(document.createTextNode(` ${about}`));

    const numbers = el('details', 'anomalous-tts-switch-numbers');
    numbers.open = numbersOpen;
    numbers.addEventListener('toggle', () => { numbersOpen = numbers.open; });
    numbers.append(el('summary', '', t(compact ? 'ttsFeelMore' : 'ttsFeelNumbers', { base: baseName })));
    if (compact) numbers.append(feelScale(before, now, baseName));
    const rows = el('div', 'anomalous-tts-switch-rows');
    const own = builtin(selected);
    for (const key of SAMPLING) {
        rows.append(valueRow(key, before[key], now[key], {
            builtin: own?.[key],
            onEdit: editable(selected) && !disabled ? value => onEdit(selected, key, value) : null,
        }));
    }
    numbers.append(rows);

    box.append(row);
    if (!compact) box.append(feelScale(before, now, baseName));
    box.append(sentence);
    if (listen) box.append(listen);
    box.append(numbers);
    return box;
}

/** Draw `root` again, keeping the focus on the number being typed in. */
export function keepParamFocus(root, draw) {
    const focused = root.contains(document.activeElement) ? document.activeElement?.dataset?.param : null;
    draw();
    if (focused) root.querySelector(`[data-param="${focused}"]`)?.focus();
}
