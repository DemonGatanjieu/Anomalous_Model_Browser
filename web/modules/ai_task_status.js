/** Derive only confirmed execution facts. Recent contact is not proof that the AI is working. */
export function taskStatus(task, now = Date.now() / 1000) {
    const steps = task?.steps || [];
    const runs = steps.filter(step => step.tool === 'run_workflow');
    const run = runs.findLast(step => step.state === 'running') || runs.at(-1);
    const active = steps.findLast(step => step.state === 'running');
    const contact = steps.filter(step => step.kind !== 'user').reduce((at, step) => Math.max(at, step.at || 0), task?.started || now);
    const age = Math.max(0, Math.floor(now - contact));
    if (run && (run.state === 'running' || !active)) {
        const progress = run.progress || { state: 'submitting' };
        return { state: run.state === 'running' ? progress.state : run.state, run,
            seconds: Math.max(0, Math.floor(run.state === 'running' ? now - run.at : (run.ms || 0) / 1000)), age };
    }
    return { state: active ? 'tool' : task?.waiting ? 'waiting' : task?.ended ? 'ended' : 'untracked', active, age };
}
