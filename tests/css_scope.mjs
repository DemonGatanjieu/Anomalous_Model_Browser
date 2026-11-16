// AMB's styles load into ComfyUI's whole page, so every rule must stay on AMB's own elements:
// a selector that names nothing of AMB's (a bare [data-tooltip], button:active, *) changes other
// extensions and ComfyUI itself. Rules on <html> / :root may only set AMB's own variables.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'styles');
const OURS = /anomalous|amb-|theme-abyssal-scarlet/i;
const OWN_VARIABLE = /^--(amb|anomalous)-/;

/** Every rule of a stylesheet as { selector, declarations }, at-rule wrappers opened, keyframes skipped. */
function rules(css) {
    const found = [];
    const stack = [];
    let buffer = '';
    for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
        if (ch === '{') {
            stack.push({ head: buffer.trim(), body: '' });
            buffer = '';
        } else if (ch === '}') {
            const block = stack.pop();
            if (!block) continue;
            block.body += buffer;
            buffer = '';
            const inKeyframes = stack.some(outer => /^@(-webkit-)?keyframes/.test(outer.head));
            if (!block.head.startsWith('@') && !inKeyframes) {
                found.push({ selector: block.head, declarations: block.body });
            }
        } else {
            buffer += ch;
            if (ch === ';' && stack.length) {
                stack[stack.length - 1].body += buffer;
                buffer = '';
            }
        }
    }
    return found;
}

const parts = (selector) => selector.split(/,(?![^(]*\))/).map(part => part.trim()).filter(Boolean);
/** The element the part styles: its last compound, after the last combinator outside parentheses. */
const subject = (part) => part.replace(/\([^()]*(\([^()]*\))*[^()]*\)/g, '()').split(/[\s>+~]+/).pop();
const properties = (declarations) => declarations.split(';').map(line => line.split(':')[0].trim()).filter(Boolean);

test('every style rule stays on AMB\'s own elements', () => {
    const leaks = [];
    for (const file of fs.readdirSync(STYLES).filter(name => name.endsWith('.css')).sort()) {
        for (const { selector, declarations } of rules(fs.readFileSync(path.join(STYLES, file), 'utf8'))) {
            for (const part of parts(selector)) {
                const target = subject(part);
                const onPage = /^(html|:root)/.test(target) || target === '.theme-abyssal-scarlet';
                if (onPage) {
                    const foreign = properties(declarations).filter(name => !OWN_VARIABLE.test(name));
                    if (foreign.length) leaks.push(`${file}: ${part} sets ${foreign.join(', ')} on the page`);
                } else if (!OURS.test(part.replace(/:not\([^()]*\)/g, ''))) {
                    leaks.push(`${file}: ${part}`);
                }
            }
        }
    }
    assert.deepEqual(leaks, []);
});

// ComfyUI's dialogs and context menus sit at 1700 (--z-index-overlay), its toasts at 9999: every
// layer of ours stays under them, so what ComfyUI says while the browser is open is seen.
const COMFY_OVERLAY = 1700;
const MODULES = path.join(STYLES, '..', 'modules');

test('every layer stays under ComfyUI\'s dialogs and toasts', () => {
    const table = fs.readFileSync(path.join(STYLES, '56-layers.css'), 'utf8');
    const level = (name) => Number(table.match(new RegExp(`--amb-z-${name}:\\s*(\\d+)`))[1]);
    // window + 5 < popup - 10 and popup + 5 < top: the calc() steps in use never cross.
    assert.ok(level('window') + 5 < level('popup') - 10, 'window and popup overlap');
    assert.ok(level('popup') + 5 < level('top') && level('top') < COMFY_OVERLAY, 'top is not under ComfyUI');
    const high = [];
    const sources = [
        ...fs.readdirSync(STYLES).filter(name => name.endsWith('.css')).map(name => path.join(STYLES, name)),
        ...fs.readdirSync(MODULES).filter(name => name.endsWith('.js')).map(name => path.join(MODULES, name)),
    ];
    for (const file of sources) {
        const text = fs.readFileSync(file, 'utf8');
        for (const [, value] of text.matchAll(/z[-_]?index\w*\s*[:=]\s*['"]?(\d+)/gi)) {
            if (Number(value) >= COMFY_OVERLAY) high.push(`${path.basename(file)}: z-index ${value}`);
        }
    }
    assert.deepEqual(high, []);
});

test('the reader sees through comments, at-rules and keyframes', () => {
    const found = rules('/* a { } */ @media (x) { .anomalous-a, b { color: red; } } @keyframes k { from { top: 0; } }');
    assert.deepEqual(found.map(rule => rule.selector), ['.anomalous-a, b']);
    assert.deepEqual(parts(':is(a, b) .anomalous-c, d'), [':is(a, b) .anomalous-c', 'd']);
    assert.equal(subject('html.x :is(body > [id^="a"]) .anomalous-b'), '.anomalous-b');
    assert.equal(subject('html.theme-abyssal-scarlet'), 'html.theme-abyssal-scarlet');
    // An AMB name inside :not() does not keep a rule on AMB's elements.
    assert.equal(OURS.test('[data-tooltip]:not(.anomalous-x)'.replace(/:not\([^()]*\)/g, '')), false);
});
