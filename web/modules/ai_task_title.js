/**
 * A task's name on the page: the one the user or the AI gave, else the one Anomalous took from the
 * AI's first step that did something (api/ai_tasks.py keeps it as "tool: what", title_from "auto"),
 * with the tool said in the page's words, else "Untitled task". A task no one named is mostly one an
 * AI worked on from its own chat, without begin_task.
 */

import { translate as t } from './locales.js';
import { toolKey } from './ai_task_view.js';

export function taskTitle(task) {
    const title = task?.title || '';
    if (!title) return t('aiUntitled');
    if (task.title_from !== 'auto') return title;
    const [, tool, about] = title.match(/^([a-z_]+)(?::\s*([\s\S]*))?$/) || [];
    const what = tool ? t(toolKey(tool)) : '';
    if (!what || what === toolKey(tool)) return title;
    return about ? t('aiAutoTitle', { what, about }) : what;
}
