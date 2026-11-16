/** Shared lexical rules for the document-wide layout passes. Never inspect literal/comment contents. */
export function skipNonCode(source: string, index: number): number {
    if (source.startsWith('//', index)) {
        const end = source.indexOf('\n', index);
        return end < 0 ? source.length : end;
    }
    if (source.startsWith('/*', index)) {
        const end = source.indexOf('*/', index + 2);
        return end < 0 ? source.length : end + 2;
    }
    const quote = source[index];
    if (quote !== '"' && quote !== "'") return index;
    const delimiter = source.startsWith('"""', index) ? '"""' : quote;
    for (let i = index + delimiter.length; i < source.length; i++) {
        if (source[i] === '\\') { i++; continue; }
        if (source.startsWith(delimiter, i)) return i + delimiter.length;
    }
    return source.length;
}

/** Protect all legacy passes, including regex spacing rules, with collision-free opaque tokens.
 * Single-line widths are preserved. Multiline literal contents are restored byte for byte.
 */
export function protectNonCode(source: string): { source: string; restore: (text: string) => string } {
    const replacements: [string, string][] = [];
    let result = '';
    let codePoint = 0xE100;
    for (let i = 0; i < source.length;) {
        const end = skipNonCode(source, i);
        if (end === i) { result += source[i++]; continue; }
        const original = source.slice(i, end);
        let marker: string;
        do { marker = String.fromCodePoint(codePoint++); } while (source.includes(marker));
        const comment = original.startsWith('/');
        const prefix = comment ? original.slice(0, 2) : original[0];
        const suffix = original.startsWith('/*') ? '*/' : comment ? '' : original[0];
        const width = original.split(/\r?\n/)[0].length;
        const token = prefix + marker.repeat(Math.max(1, width - prefix.length - suffix.length)) + suffix;
        replacements.push([token, original]);
        result += token;
        i = end;
    }
    return { source: result, restore: text => {
        for (const [token, original] of replacements) text = text.split(token).join(original);
        return text;
    } };
}

function closing(source: string, open: number): number {
    let depth = 1;
    for (let i = open + 1; i < source.length; i++) {
        const end = skipNonCode(source, i);
        if (end !== i) { i = end - 1; continue; }
        if (source[i] === '(') depth++;
        if (source[i] === ')' && --depth === 0) return i;
    }
    return -1;
}

function isCall(source: string, open: number, close: number): boolean {
    const before = source.slice(0, open).trimEnd();
    const name = before.match(/[\w$]+$/)?.[0] || '';
    return /[\w$\]>]$/.test(before) &&
        !['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'try'].includes(name) &&
        !/^\s*->/.test(source.slice(close + 1));
}

export function splitJavaArguments(source: string): string[] {
    const result: string[] = [];
    let start = 0;
    let depth = 0;
    let angles = 0;
    for (let i = 0; i < source.length; i++) {
        const end = skipNonCode(source, i);
        if (end !== i) { i = end - 1; continue; }
        const ch = source[i];
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth--;
        // A type argument list follows a type name or a dot (explicit method type arguments).
        // Comparison operators with spaces must not hide argument separators.
        else if (ch === '<' && (angles > 0 || /(?:\b[A-Z_$][\w$]*\s*|\.\s*)$/.test(source.slice(0, i)) || /^[^;{}]*>\s*[.(]/.test(source.slice(i + 1))) && /^\s*[\w?@]/.test(source.slice(i + 1)) && source.indexOf('>', i + 1) >= 0) angles++;
        else if (ch === '>' && angles > 0) angles--;
        else if (ch === ',' && depth === 0 && angles === 0) {
            result.push(source.slice(start, i).trim()); start = i + 1;
        }
    }
    result.push(source.slice(start).trim());
    return result;
}

function containsCall(source: string): boolean {
    for (let i = 0; i < source.length; i++) {
        const end = skipNonCode(source, i);
        if (end !== i) { i = end - 1; continue; }
        if (source[i] === '(') {
            const close = closing(source, i);
            if (close >= 0 && isCall(source, i, close)) return true;
        }
    }
    return false;
}

function appendClose(source: string): string {
    let lastComment = false;
    for (let i = 0; i < source.length;) {
        const end = skipNonCode(source, i);
        if (end !== i) { lastComment = source.startsWith('//', i) && end === source.length; i = end; }
        else { i++; }
    }
    return source + (lastComment ? '\n)' : ')');
}

/** Recursive, document-wide argument layout: input newlines do not determine which calls are seen. */
export function formatCalls(source: string, maxLineLength: number, tabSize = 4, baseDepth = 0, continuation = 0, continuationSize = 2): string {
    let depth = baseDepth;
    let result = '';
    for (let i = 0; i < source.length;) {
        const end = skipNonCode(source, i);
        if (end !== i) { result += source.slice(i, end); i = end; continue; }
        if (source[i] !== '(') {
            if (source[i] === '{') depth++;
            if (source[i] === '}') depth = Math.max(0, depth - 1);
            result += source[i++]; continue;
        }
        const close = closing(source, i);
        if (close < 0) { result += source.slice(i); break; }
        const body = source.slice(i + 1, close);
        if (!isCall(source, i, close)) {
            result += '(' + formatCalls(body, maxLineLength, tabSize, depth, continuation, continuationSize) + ')';
        } else {
            const args = splitJavaArguments(body);
            const prefix = result.slice(result.lastIndexOf('\n') + 1).trimStart();
            const extra = /^(?:\.|ASSIGN_RHS:)/.test(prefix) ? continuationSize : 0;
            const width = depth * tabSize + continuation + extra + prefix.replace(/^ASSIGN_RHS:/, '').length + body.trim().length + 2;
            const compactChain = prefix.startsWith('.') && args.length === 1 && !args[0].includes('\n') && !args[0].includes('//');
            const multiline = args.length > 1 || containsCall(body) || (body.includes('\n') && !compactChain) ||
                (body.trim().length > 0 && width >= maxLineLength);
            const formatted = args.map(arg => formatCalls(arg, maxLineLength, tabSize, depth, continuation + extra + (multiline ? continuationSize : 0), continuationSize));
            result += multiline && body.trim() ? '(\n' + appendClose(formatted.join(',\n')) : '(' + body.trim() + ')';
        }
        i = close + 1;
        const chain = source.slice(i).match(/^\s*\.\s*([\w$]+)\s*\(/);
        if (chain) {
            result += '\n.' + chain[1];
            i += chain[0].length - 1;
        }
    }
    return result;
}

/** Expand executable blocks, without splitting array initializers or for-header semicolons. */
export function expandBlocks(source: string): string {
    const stack: { kind: string; block: boolean }[] = [];
    let result = '';
    let previous = '';
    for (let i = 0; i < source.length;) {
        const end = skipNonCode(source, i);
        if (end !== i) { result += source.slice(i, end); i = end; continue; }
        const token = source.slice(i).match(/^[\w$]+/)?.[0] || source[i];
        const frame = stack.at(-1);
        if ('({['.includes(token)) {
            const block = token === '{' && (previous === ')' || previous === '>' || ['else', 'try', 'finally', 'do'].includes(previous));
            stack.push({ kind: token, block });
            result += token;
            if (block && !/^[ \t]*(?:[\r\n}]|\/\/)/.test(source.slice(i + 1))) result += '\n';
        } else if (')}]'.includes(token)) {
            if (token === '}' && frame?.block && previous !== '{') result = result.trimEnd() + '\n';
            stack.pop(); result += token;
        } else {
            result += token;
            if (token === ';' && frame?.block && !/^\s*(?:[\r\n}]|\/\/|\/\*)/.test(source.slice(i + 1))) result += '\n';
        }
        if (token.trim()) previous = token;
        i += token.length;
    }
    // Avoid manufacturing empty lines next to existing breaks.
    return result;
}

/** Consume complete annotations before splitting declarations; nested annotations stay inside their owner. */
export function formatAnnotations(source: string): string {
    let result = '';
    for (let i = 0; i < source.length;) {
        const skipped = skipNonCode(source, i);
        if (skipped !== i) { result += source.slice(i, skipped); i = skipped; continue; }
        const name = source.slice(i).match(/^@[\w$.]+/);
        if (!name || name[0] === '@interface') { result += source[i++]; continue; }
        let end = i + name[0].length;
        const gap = source.slice(end).match(/^\s*/)?.[0].length || 0;
        if (source[end + gap] === '(') {
            const close = closing(source, end + gap);
            if (close < 0) { result += source.slice(i); break; }
            end = close + 1;
        }
        if (result.slice(result.lastIndexOf('\n') + 1).trim()) result = result.trimEnd() + '\n';
        result += source.slice(i, end);
        const following = source.slice(end);
        if (/^[ \t]*[^\s,;)\]>.]/.test(following)) result += '\n';
        i = end;
    }
    return result;
}
