/**
 * Before a run: does each Anima ControlNet-LLLite fit the model it is put on (api/lllite_fit.py)? An LLLite
 * made for the 28-block (2B) Anima models stops a run on a 40-block (2.9B) one with "depth_embed slices
 * missing". The uses are read from what the run would send (app.graphToPrompt's output: bypassed nodes are
 * not in it): each LLLite node and the loader at the top of its model line. Asked by the AI's run_workflow
 * (mcp_bridge.js), which is refused with the nodes to change; such a run would only fail.
 */

const LLLITE = 'AnimaLLLiteApply_sdscripts';
const MAX_HOPS = 40; // a model line through LoRAs and patches

/** Whether `graph` (the canvas's, with its subgraphs) has an LLLite node at all: only then is the run's prompt read. */
export const usesLllite = graph => (graph?._nodes || []).some(node => node.type === LLLITE || (node.subgraph && usesLllite(node.subgraph)));

/** [{node, loader, model, lllite}] for the LLLite nodes in `output` (a prompt in API form): the loader a node's model comes from, and the file names both give. */
export function llliteUses(output) {
    const uses = [];
    for (const [id, node] of Object.entries(output || {})) {
        if (node?.class_type !== LLLITE || typeof node.inputs?.lllite_name !== 'string') continue;
        let at = node;
        let loader = id;
        for (let hops = 0; hops < MAX_HOPS && Array.isArray(at?.inputs?.model); hops++) {
            loader = String(at.inputs.model[0]);
            at = output[loader];
        }
        const model = at?.inputs?.unet_name ?? at?.inputs?.ckpt_name;
        if (at && at !== node && typeof model === 'string') uses.push({ node: id, loader, model, lllite: node.inputs.lllite_name });
    }
    return uses;
}

/** The first use in `output` whose LLLite does not fit its model: {node, loader, model, lllite, blocks, made_for}; null when all fit. */
export async function llliteProblem(output) {
    const uses = llliteUses(output);
    if (!uses.length) return null;
    try {
        const response = await fetch('/anomalous/lllite_fit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uses: uses.map(({ model, lllite }) => ({ model, lllite })) }) });
        const odd = (await response.json())?.problems?.[0];
        const use = odd && uses.find(item => item.model.replace(/\\/g, '/').endsWith(odd.model) && item.lllite.replace(/\\/g, '/').endsWith(odd.lllite));
        return use ? { ...odd, node: use.node, loader: use.loader } : null;
    } catch {
        return null; // the check only helps: a run is never stopped by it failing
    }
}

/** What the AI is told: nothing ran, why, and how to go on. */
export const llliteWords = odd => `Nothing was run: the LLLite ${odd.lllite} on node #${odd.node} is made for Anima models of ${odd.made_for} blocks `
    + `(the 2B ones), and the model it is put on, ${odd.model} (loader #${odd.loader}), has ${odd.blocks}: the run would stop with "depth_embed slices missing". `
    + `set_model loader #${odd.loader} to an Anima model of ${odd.made_for} blocks (the 2B ones; search_models). Where the LLLite only holds a redraw's lines `
    + `(a Tile on a refine), you may instead remove_nodes node #${odd.node} and set that redraw's denoise to 0.45. Tell the user which you did.`;
