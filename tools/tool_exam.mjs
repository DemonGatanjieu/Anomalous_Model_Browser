// The exam's scorecard (docs/architecture/tool-exam.md): how an AI did on each task the AI
// workbench kept, read from its task files. Read only.
//   node tools/tool_exam.mjs <the ComfyUI user folder's anomalous/ai_tasks> [--since=2026-10-26T20:00]
// Per task: the AI's calls, the failed ones, detours (tool_help, or a call by an old tool list),
// questions asked and answered, runs (and the failed ones), whether it ended, and its minutes.
import fs from 'node:fs';
import path from 'node:path';

const [folder, ...rest] = process.argv.slice(2);
if (!folder || !fs.existsSync(folder)) {
    console.error('Usage: node tools/tool_exam.mjs <…/user/anomalous/ai_tasks> [--since=YYYY-MM-DDTHH:MM]');
    process.exit(2);
}
const since = rest.find(arg => arg.startsWith('--since='));
const from = since ? Date.parse(since.slice(8)) / 1000 : 0;
if (Number.isNaN(from)) {
    console.error('--since is a date and time, like 2026-10-26T20:00');
    process.exit(2);
}

/** The scorecard row of one task (its saved JSON). */
function score(task) {
    const steps = task.steps || [];
    const ai = steps.filter(step => step.kind !== 'user');
    const asks = ai.filter(step => step.tool === 'ask_user' || (step.kind === 'panel' && (step.panel?.blocks || [])
        .some(block => ['choices', 'input', 'picks'].includes(block.type))));
    const runs = ai.filter(step => step.kind === 'run');
    const last = Math.max(task.updated || 0, ...steps.map(step => (step.at || 0) + (step.ms || 0) / 1000));
    return {
        task: String(task.title || task.id).slice(0, 28), app: task.client || '', calls: ai.length,
        failed: ai.filter(step => step.ok === false).length,
        detours: ai.filter(step => step.tool === 'tool_help').length + (task.stale_tools ? 1 : 0),
        asked: asks.length, answered: asks.filter(step => Object.keys(step.answers || {}).length).length,
        runs: runs.length, runs_failed: runs.filter(step => step.ok === false).length,
        ended: task.ended ? 'yes' : 'no', minutes: task.started ? Math.round((last - task.started) / 6) / 10 : 0,
    };
}

const rows = fs.readdirSync(folder).filter(name => name.endsWith('.json'))
    .map(name => { try { return JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')); } catch { return null; } })
    .filter(task => task && (task.steps || []).some(step => step.kind !== 'user') && (task.started || 0) >= from)
    .sort((a, b) => (a.started || 0) - (b.started || 0))
    .map(score);
if (!rows.length) {
    console.log('No AI task in that folder' + (since ? ' since then.' : '.'));
    process.exit(0);
}
const total = Object.fromEntries(Object.keys(rows[0]).map(key => [key, typeof rows[0][key] === 'number'
    ? Math.round(rows.reduce((sum, row) => sum + row[key], 0) * 10) / 10 : '']));
total.task = `all ${rows.length}`;
console.table([...rows, total]);
const calls = total.calls || 1;
console.log(`Failed calls ${Math.round(total.failed * 100 / calls)}%, detours ${Math.round(total.detours * 100 / calls)}% of ${total.calls} calls.`);
