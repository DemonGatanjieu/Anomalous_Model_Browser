/**
 * The message box's "+" button menu (plugged into web/modules/ui_ai_message.js): opens the
 * materials picker's window on models, ways, or other materials
 * (combos, saved workflows, prompts, nodes), or opens the shared "Build a new one (text to
 * image)" dialog for this task, with a quiet hint about "@" at the bottom.
 */

import { translate as t } from './locales.js';
import { icon } from './ui_ai_icons.js';

const INTERACTIVE = '.anomalous-ai-message-tool, button, input, textarea, select, a';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/**
 * The "+" menu over `box`: second press on `button`, Esc and a press outside close it and return
 * focus to `field`. `opts`: `{button, onOpen, onPickKind(kind), onBuild}`.
 */
export function plusMenu(box, field, { button, onOpen, onPickKind, onBuild }) {
    let panel = null;
    let stop = null;

    function close(refocus = true) {
        if (!panel) return;
        stop?.();
        stop = null;
        panel.remove();
        panel = null;
        button.classList.remove('is-on');
        button.setAttribute('aria-expanded', 'false');
        if (refocus) field.focus();
    }

    function open() {
        onOpen?.();
        panel = el('div', 'anomalous-ai-plus');
        panel.dataset.anomalousEscape = '1';
        const list = el('div', 'anomalous-ai-plus-menu');
        list.setAttribute('role', 'menu');
        const makeItem = (iconName, label, onSelect, arrow = false) => {
            const item = el('button', 'anomalous-ai-plus-item');
            item.type = 'button';
            item.setAttribute('role', 'menuitem');
            item.append(icon(iconName, 16), el('span', 'anomalous-ai-plus-item-label', label));
            if (arrow) item.append(icon('chevronRight', 14, 'anomalous-ai-plus-arrow'));
            item.onclick = onSelect;
            return item;
        };
        const pickKind = kind => () => {
            close(false);
            onPickKind(kind);
        };
        const items = [
            makeItem('models', t('aiPlusModel'), pickKind('models'), true),
            makeItem('blocks', t('aiPlusWay'), pickKind('ways'), true),
            makeItem('sparkle', t('aiPlusOther'), pickKind('other'), true),
            makeItem('workflows', t('aiStartFrom_new'), () => {
                close(false);
                onBuild();
            }),
        ];
        list.append(...items);
        list.addEventListener('keydown', (event) => {
            const index = items.indexOf(document.activeElement);
            if (index < 0) return;
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                items[(index + 1) % items.length].focus();
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                items[(index + items.length - 1) % items.length].focus();
            } else if (event.key === 'Home') {
                event.preventDefault();
                items[0].focus();
            } else if (event.key === 'End') {
                event.preventDefault();
                items[items.length - 1].focus();
            }
        });
        panel.append(list, el('div', 'anomalous-ai-plus-hint', t('aiPlusAtHint')));
        box.append(panel);
        button.classList.add('is-on');
        button.setAttribute('aria-expanded', 'true');

        const outside = (event) => {
            if (!panel?.contains(event.target) && !event.target.closest?.('.anomalous-ai-message-plus')) {
                close(!event.target.closest?.(INTERACTIVE));
            }
        };
        const escape = (event) => {
            if (event.key === 'Escape') setTimeout(() => close(true));
        };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', escape);
        stop = () => {
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('keydown', escape);
        };
        items[0]?.focus();
    }

    return {
        toggle: () => (panel ? close(true) : open()),
        close,
    };
}
