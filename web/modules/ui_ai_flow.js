/**
 * The flow over an AI task: the stages of the work its steps went through, in the order they
 * came (models, combo, prompt, canvas, run, pictures, voice, library: action_catalog.py's), each
 * saying whether it is done, running, waiting for the user or failed. A stage leads to its first
 * step in the timeline (`goTo(stepId)`). The stages come from ai_task_view.js flowStages.
 */

import { translate as t } from './locales.js';
import { flowStages } from './ai_task_view.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function flowMap(task, goTo) {
    const stages = flowStages(task);
    if (!stages.length) return null;
    const box = el('div', 'anomalous-ai-flow');
    box.setAttribute('aria-label', t('aiFlow'));
    stages.forEach((item, at) => {
        if (at) box.append(el('span', 'anomalous-ai-flow-arrow', '›'));
        const chip = el('button', `anomalous-ai-flow-stage is-${item.state}`);
        chip.type = 'button';
        chip.title = t(`aiFlowState_${item.state}`);
        chip.append(el('span', 'anomalous-ai-flow-mark'), el('span', '', t(`aiStage_${item.stage}`)));
        if (item.count > 1) chip.append(el('span', 'anomalous-ai-flow-count', `×${item.count}`));
        chip.onclick = () => goTo(item.first);
        box.append(chip);
    });
    return box;
}
