import { t } from './interface_settings.js';
import { button, el } from './usage_view.js';
import { PARAM_RANGES, SAMPLING } from './tts_presets_api.js';

/**
 * The generation modes as a row of choices and the chosen one's four sampling numbers,
 * drawn like the Current node's value card (ui_node_parameters.js): each number as two bars,
 * the mode looked at before and this one, with "before → now" and an arrow. Each number
 * carries its plain name and the node's own name (top_k …), so values copied from the
 * GPT-SoVITS WebUI are recognised. Shared by GPT-SoVITS Settings (ui_tts_presets.js) and
 * the Script Director's "How it is read" (ui_script_run.js); the callers keep the state
 * and draw it again after each change.
 */

const brief = value => String(Math.round(value * 100) / 100);

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

/** One number: two bars (before, now), "before → now ↑", the built-in value when it was changed. */
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
        values.append(input);
    } else {
        values.append(el('strong', '', brief(now)));
    }
    if (before !== now) values.append(el('span', 'anomalous-node-param-trend', now > before ? '↑' : '↓'));
    if (typeof builtin === 'number' && builtin !== now) values.append(el('span', 'anomalous-tts-switch-was', t('ttsPresetWas', { value: brief(builtin) })));
    line.append(label, bars, values);
    return line;
}

/**
 * `choices`: `[{id, label, badge?}]`; `selected` and `previous` are ids; `values(id)` gives a
 * mode's four numbers; `builtin(id)` its built-in ones or null; `editable(id)`; `onPick(id)`;
 * `onEdit(id, key, value)`; `extra`: elements after the choices (a "+ New" button).
 */
export function renderPresetSwitch({ choices, selected, previous, values, builtin = () => null, editable = () => false, onPick, onEdit, extra = [], disabled = false }) {
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
    const before = (previous !== undefined && previous !== null && values(previous)) || now;
    const own = builtin(selected);
    const rows = el('div', 'anomalous-tts-switch-rows');
    for (const key of SAMPLING) {
        rows.append(valueRow(key, before[key], now[key], {
            builtin: own?.[key],
            onEdit: editable(selected) && !disabled ? value => onEdit(selected, key, value) : null,
        }));
    }
    box.append(row, rows);
    return box;
}

/** Draw `root` again, keeping the focus on the number being typed in. */
export function keepParamFocus(root, draw) {
    const focused = root.contains(document.activeElement) ? document.activeElement?.dataset?.param : null;
    draw();
    if (focused) root.querySelector(`[data-param="${focused}"]`)?.focus();
}
