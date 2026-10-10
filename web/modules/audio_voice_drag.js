import { app } from '../../../scripts/app.js';
import { t } from './interface_settings.js';
import { AUDIO_NODE_TARGETS, planVoiceDrop } from './audio_node_targets.js';
import { TTS_ENGINE } from './audio_engines.js';
import { bindMaterialDrag } from './material_drag.js';

/**
 * Dragging a character onto a canvas node, shared by the studio cards and the
 * audio sidebar. Which nodes take it is decided by audio_node_targets.js;
 * unlisted nodes are refused, never guessed.
 */

/** Why a hovered node is refused; every refusal names what to do instead. */
function dropRejectHint(node, group) {
    const plan = planVoiceDrop(node, group);
    if (plan.ok) return '';
    return t(`audioDropReject_${plan.reason}`, {
        node: plan.target?.label || '',
        supported: AUDIO_NODE_TARGETS.map(target => target.label).join(t('audioListSeparator')),
        character: group.character,
        file: plan.path || '',
    });
}

export function bindVoiceDrag(element, group, owner) {
    bindMaterialDrag(element, owner || {}, {
        payload: () => ({
            group,
            dragHint: t('audioDragCharacterHint', { character: group.character, node: TTS_ENGINE.label }),
        }),
        accepts: node => planVoiceDrop(node, group).ok,
        targetHint: node => {
            const plan = planVoiceDrop(node, group);
            return plan.ok ? t('audioDropCharacterTarget', { node: plan.target.label, character: group.character }) : '';
        },
        rejectHint: node => dropRejectHint(node, group),
        drop: async node => {
            const plan = planVoiceDrop(node, group);
            if (!plan.ok) return;
            plan.widget.value = plan.value;
            plan.widget.callback?.(plan.value, app.canvas, node);
            node.setDirtyCanvas?.(true, true);
        },
    });
}
