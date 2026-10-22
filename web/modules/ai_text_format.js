/**
 * A little layout for what the AI writes in the workbench (its notes, replies): headings (#),
 * bullet and numbered lists, paragraphs, **bold** and `code`, the way AI apps write anyway.
 * parseNote reads the text into blocks (no DOM); noteNode draws them with textContent only,
 * so nothing the AI writes is ever taken as markup.
 */

const HEADING = /^\s{0,3}#{1,4}\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)、]\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** Inline pieces of one line: [{text, bold?, code?}]. */
export function inline(text) {
    const out = [];
    const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
    let at = 0;
    for (const match of String(text).matchAll(pattern)) {
        if (match.index > at) out.push({ text: text.slice(at, match.index) });
        out.push(match[1] !== undefined ? { text: match[1], bold: true } : { text: match[2], code: true });
        at = match.index + match[0].length;
    }
    if (at < text.length) out.push({ text: text.slice(at) });
    return out;
}

/** The blocks of `text`: {type: heading|paragraph|bullets|numbers|rule, lines: [inline pieces]}. */
export function parseNote(text) {
    const blocks = [];
    let current = null;
    const push = (type, line) => {
        if (current?.type !== type || type === 'heading' || type === 'rule') {
            current = { type, lines: [] };
            blocks.push(current);
        }
        if (line !== null) current.lines.push(inline(line));
    };
    for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
        if (!raw.trim()) {
            current = null;
            continue;
        }
        let match;
        if (RULE.test(raw)) push('rule', null);
        else if ((match = HEADING.exec(raw))) push('heading', match[1]);
        else if ((match = BULLET.exec(raw))) push('bullets', match[1]);
        else if ((match = NUMBERED.exec(raw))) push('numbers', match[2]);
        else if (current?.type === 'paragraph') current.lines.push(inline(raw.trim()));
        else push('paragraph', raw.trim());
    }
    return blocks;
}

function line(pieces) {
    const box = document.createDocumentFragment();
    for (const piece of pieces) {
        const node = document.createElement(piece.code ? 'code' : piece.bold ? 'strong' : 'span');
        node.textContent = piece.text;
        box.append(node);
    }
    return box;
}

/** `text` laid out, in an element of `className`. */
export function noteNode(text, className = 'anomalous-ai-note-text') {
    const box = document.createElement('div');
    box.className = className;
    for (const block of parseNote(text)) {
        if (block.type === 'rule') {
            box.append(document.createElement('hr'));
        } else if (block.type === 'heading') {
            const heading = document.createElement('h4');
            heading.append(line(block.lines[0]));
            box.append(heading);
        } else if (block.type === 'paragraph') {
            const paragraph = document.createElement('p');
            block.lines.forEach((pieces, index) => {
                if (index) paragraph.append(document.createElement('br'));
                paragraph.append(line(pieces));
            });
            box.append(paragraph);
        } else {
            const list = document.createElement(block.type === 'numbers' ? 'ol' : 'ul');
            for (const pieces of block.lines) {
                const item = document.createElement('li');
                item.append(line(pieces));
                list.append(item);
            }
            box.append(list);
        }
    }
    return box;
}
