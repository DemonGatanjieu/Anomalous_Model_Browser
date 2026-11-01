/**
 * Starting a training round (api/ai_training.py) from the training network (ui_ai_network.js): what
 * to try, a skill (the AI's prompts with its advice and without, side by side) or the ready-made ways
 * of one use; on which main models, up to four, listed by base model; how many pictures each (seeds);
 * what to draw, or the picture the ways work on (from the gallery). Then the task waits for the AI
 * and the sentence to paste into the AI app is shown, as handing a task over does (ui_ai_handoff.js).
 * POST /anomalous/ai_training.
 */

import { resolveLocale, translate as t } from './locales.js';
import { copyLine } from './ui_ai_connect.js';
import { galleryPicker, thumbUrl } from './ui_ai_gallery_pick.js';

const MAX_MODELS = 4;
const words = value => (resolveLocale() === 'zh' ? value?.zh : value?.en) || value?.en || value?.zh || '';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

function field(label, ...content) {
    const box = el('div', 'anomalous-ai-train-field');
    box.append(el('div', 'anomalous-ai-train-label', label), ...content);
    return box;
}

/** What a round can try: each skill on, each use with a way that runs here. */
function targetsOf(data) {
    const out = data.skills.filter(skill => skill.on).map(skill => ({ value: `skill:${skill.name}`, skill: skill.name, title: words(skill.title),
        label: t('aiTrainSkill', { name: words(skill.title) }) }));
    for (const job of data.jobs) {
        const ways = data.blocks.filter(block => block.job === job && block.usable && block.on);
        if (ways.length) out.push({ value: `use:${job}`, use: job, title: t(`aiBlocksJob_${job}`), takes: ways.some(way => way.takes),
            label: t('aiTrainUse', { job: t(`aiBlocksJob_${job}`), count: ways.length }), kinds: ways.length });
    }
    return out;
}

/**
 * The form for `data` (the network, GET /anomalous/ai_training); `preset`: {item?, base?} picked in the
 * network; `back()` returns to it, `openTask(id)` shows the task made.
 */
export function trainingSetup(data, preset, { back, openTask }) {
    const box = el('div', 'anomalous-ai-train');
    const targets = targetsOf(data);
    const item = preset.item;
    const wanted = item?.kind === 'skill' ? `skill:${item.name}` : item?.kind === 'way' ? `use:${data.blocks.find(block => block.name === item.name)?.job}` : '';
    let target = targets.find(entry => entry.value === wanted) || targets[0];
    const models = new Set(data.models.filter(model => model.base === preset.base).slice(0, 1).map(model => model.model_id));
    let each = 2;
    let picture = null;
    const note = el('div', 'anomalous-ai-train-note');
    box.append(button('anomalous-ai-train-back', t('aiTrainBack'), back), el('div', 'anomalous-ai-net-detail-title', t('aiTrainHead')));
    if (!targets.length || !data.models.length) {
        box.append(el('div', 'anomalous-ai-stage-empty', t(data.models.length ? 'aiTrainNothing' : 'aiTrainModelsNone')));
        return box;
    }

    const pick = el('select', 'anomalous-ai-train-select');
    for (const entry of targets) {
        const option = el('option', '', entry.label);
        option.value = entry.value;
        option.selected = entry === target;
        pick.append(option);
    }
    const list = el('div', 'anomalous-ai-train-models');
    const byBase = new Map();
    for (const model of data.models) byBase.set(model.base, [...(byBase.get(model.base) || []), model]);
    const boxes = [];
    for (const [base, entries] of [...byBase].sort((a, b) => (b[0] === preset.base) - (a[0] === preset.base) || a[0].localeCompare(b[0]))) {
        list.append(el('div', 'anomalous-ai-train-base', base || t('aiRecordOther')));
        for (const model of entries) {
            const row = el('label', 'anomalous-ai-train-model');
            const check = el('input');
            check.type = 'checkbox';
            check.checked = models.has(model.model_id);
            check.onchange = () => {
                if (check.checked) models.add(model.model_id);
                else models.delete(model.model_id);
                update();
            };
            boxes.push([check, model]);
            row.append(check, el('span', '', model.name));
            list.append(row);
        }
    }
    const subject = el('textarea', 'anomalous-ai-prompt-field');
    subject.rows = 2;
    subject.value = t('aiTrainSubjectDefault');
    const shot = el('div', 'anomalous-ai-train-picture');
    const tray = el('div', 'anomalous-ai-prompt-tray');
    const choose = button('anomalous-ai-prompt-pick', t('aiTrainPick'), () => picker.toggle());
    const picker = galleryPicker(shot, () => 1, (items) => {
        const image = items[0]?.image || items[0];
        if (!image) return;
        picture = [image.subfolder, image.filename].filter(Boolean).join('/');
        const tile = el('span', 'anomalous-ai-prompt-pic');
        const img = el('img');
        img.src = thumbUrl(image);
        img.alt = '';
        tile.append(img);
        tray.replaceChildren(tile);
        update();
    }, choose, { hint: 'aiTrainPicsHint', full: 'aiTrainPicsFull', add: 'aiTrainPicsAdd' });
    shot.append(tray, choose);
    const counts = el('div', 'anomalous-ai-gates-choice anomalous-ai-train-seg');
    const segment = [1, 2, 3].map((value) => {
        const node = button('anomalous-ai-gates-option', String(value), () => { each = value; update(); });
        counts.append(node);
        return [node, value];
    });
    const sum = el('div', 'anomalous-ai-train-sum');
    const send = button('anomalous-ai-net-train', t('aiTrainStart'), start);
    const what = field(t('aiTrainSubject'), subject);
    const where = field(t('aiTrainPicture'), shot);

    function update() {
        target = targets.find(entry => entry.value === pick.value) || targets[0];
        what.hidden = !target.skill;
        where.hidden = !target.takes;
        for (const [check, model] of boxes) check.disabled = !models.has(model.model_id) && models.size >= MAX_MODELS;
        segment.forEach(([node, value]) => node.classList.toggle('is-on', value === each));
        const kinds = target.skill ? 2 : target.kinds;
        sum.textContent = t('aiTrainCount', { total: models.size * kinds * each, models: models.size, kinds, each });
        note.textContent = '';
    }
    pick.onchange = update;

    async function start() {
        if (!models.size) {
            note.textContent = t('aiTrainNeedModel');
            return;
        }
        if (target.takes && !picture) {
            note.textContent = t('aiTrainNeedPicture');
            return;
        }
        const title = t('aiTrainTaskTitle', { what: target.title, count: models.size });
        send.disabled = true;
        try {
            const response = await fetch('/anomalous/ai_training', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, models: [...models], each, skill: target.skill || '', use: target.use || '',
                    subject: target.skill ? subject.value.trim() : '', picture: target.takes ? picture : '' }),
            });
            const answer = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(answer.error || response.statusText);
            const done = el('div', 'anomalous-ai-train-done');
            done.append(el('p', 'anomalous-ai-handoff-text', t('aiTrainMade')),
                copyLine(t('aiHandSentence', { task: title }), { code: false, label: t('aiConnectCopySentence') }),
                button('anomalous-ai-net-train is-small', t('aiTrainOpen'), () => openTask?.(answer.task.id)));
            box.replaceChildren(button('anomalous-ai-train-back', t('aiTrainBack'), back), done);
        } catch (error) {
            send.disabled = false;
            note.textContent = error.message;
        }
    }

    box.append(field(t('aiTrainWhat'), pick), field(t('aiTrainModels', { max: MAX_MODELS }), list), what, where,
        field(t('aiTrainEach'), counts), sum, el('div', 'anomalous-ai-blocks-note', t('aiTrainHow')), send, note);
    update();
    return box;
}
