import { app } from '../../../scripts/app.js';
import { t } from './interface_settings.js';
import { AUDIO_NODE_TARGETS, planVoiceDrop } from './audio_node_targets.js';
import { engineById } from './audio_engines.js';
import { bindMaterialDrag } from './material_drag.js';

/**
 * Dragging a voice onto a canvas node, shared by the studio cards and the audio
 * sidebar: an item is `{ kind: 'character', group }` or `{ kind: 'clip', slice }`.
 */

function itemEngine(item) {
    return (item.kind === 'character' ? item.group?.engine : item.slice?.engine) || 'f5';
}

function engineLabel(id) {
    return engineById(id)?.label || id;
}

function itemLabel(item) {
    if (item.kind === 'character') return item.group.character;
    return `${item.slice.character} · ${String(item.slice.emotion || '').toUpperCase()}`;
}

/** What the drop will do, shown while hovering an accepted node. */
function dropTargetHint(node, item) {
    const plan = planVoiceDrop(node, item);
    if (!plan.ok) return '';
    return item.kind === 'character'
        ? t('audioDropCharacterTarget', { node: plan.target.label, character: item.group.character })
        : t('audioDropClipTarget', { node: plan.target.label, clip: itemLabel(item) });
}

/** Why a hovered node is refused; every refusal names what to do instead. */
function dropRejectHint(node, item) {
    const plan = planVoiceDrop(node, item);
    if (plan.ok) return '';
    const params = {
        node: plan.target?.label || '',
        supported: AUDIO_NODE_TARGETS.filter(target => target.engine === itemEngine(item)).map(target => target.label).join(t('audioListSeparator')),
        voiceEngine: engineLabel(itemEngine(item)),
        character: item.kind === 'character' ? item.group.character : item.slice.character,
        emotion: item.kind === 'clip' && !item.slice.is_main ? `{${item.slice.emotion}}` : t('audioEmotionTagExample'),
        file: plan.path || '',
    };
    return t(`audioDropReject_${plan.reason}`, params);
}

/**
 * Drag a character (card header) or one clip (row) onto a canvas node. Which one a node
 * takes is decided by audio_node_targets.js; unlisted nodes are refused, never guessed.
 */
export function bindVoiceDrag(element, item, owner) {
    bindMaterialDrag(element, owner || {}, {
        payload: () => ({
            ...item,
            dragHint: item.kind === 'character'
                ? t('audioDragCharacterHint', { character: item.group.character, node: engineLabel(itemEngine(item)) })
                : t('audioDragClipHint', { clip: itemLabel(item) }),
        }),
        accepts: node => planVoiceDrop(node, item).ok,
        targetHint: node => dropTargetHint(node, item),
        rejectHint: node => dropRejectHint(node, item),
        drop: async node => {
            const plan = planVoiceDrop(node, item);
            if (!plan.ok) return;
            plan.widget.value = plan.value;
            plan.widget.callback?.(plan.value, app.canvas, node);
            node.setDirtyCanvas?.(true, true);
        },
    });
}
