/**
 * Whether the AI has what the user gave it (an answer on a panel, a message, marks, pictures, a
 * stop, a change): a pill that says "sent, waiting for the AI" until the AI's next step or check
 * takes it, then "the AI has it" with the time it did (`delivered_at`, from ai_panels._collect).
 */

import { translate as t } from './locales.js';
import { timeLabel } from './activity_log.js';
import { icon } from './ui_ai_icons.js';

/** The pill for `item` ({delivered, delivered_at}); `seen` / `waiting` are locale keys. */
export function deliveryState(item, seen = 'aiDeliverySeen', waiting = 'aiDeliveryWaiting') {
    const got = Boolean(item?.delivered);
    const pill = document.createElement('div');
    pill.className = `anomalous-ai-delivery ${got ? 'is-seen' : 'is-waiting'}`;
    pill.setAttribute('role', 'status');
    const words = document.createElement('span');
    words.textContent = got && item.delivered_at ? `${t(seen)} · ${timeLabel(item.delivered_at)}` : t(got ? seen : waiting);
    pill.append(icon(got ? 'checks' : 'check', 13), words);
    if (!got) pill.title = t('aiDeliveryWaitingTip');
    return pill;
}
