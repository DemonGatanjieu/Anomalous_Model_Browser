/**
 * The saves bar's calls to api/workflow_saves.py, where every save of a workflow lives. A group is
 * found by the key in the workflow's extra, or for a saved file by its path. No DOM.
 */

import { jsonResponse } from './ui_dom.js';

const FAILED = 'The saves did not answer';

const read = (route, query = {}) => fetch(`/anomalous/saves${route}?${new URLSearchParams(query)}`).then(response => jsonResponse(response, FAILED));

const send = (route, body) => fetch(`/anomalous/saves/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
}).then(response => jsonResponse(response, FAILED));

/** The group of `key`, or of the workflow file `path`; null when there is none. */
export const findGroup = (key, path) => read('/group', { key, path }).then(data => data.group);

/** Every group, the newest first, each with what it is called and its newest picture. */
export const listGroups = () => read('').then(data => data.groups);

/** `save` of group `key`'s whole workflow. */
export const readWorkflow = (key, id) => read('/workflow', { key, id }).then(data => data.workflow);

/** Keeps a save ({key, workflow, title, path, changes}); the group as it stands then. */
export const addSave = save => send('add', save).then(data => data.group);

export const setCount = (key, id, count) => send('update', { key, id, count }).then(data => data.group);

/** Says which runs came from save `id`, so their pictures can be found. */
export const noteRuns = (key, id, promptIds) => send('ran', { key, id, prompt_ids: promptIds }).then(data => data.group);

/** To the Recycle Bin; the group as it stands then, null after its last save. */
export const removeSave = (key, id) => send('remove', { key, id }).then(data => data.group);

export const removeGroup = key => send('remove_group', { key });
