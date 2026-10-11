

/*** -----------------  MYST To IPYNB ------------------ ******/

// Comment MyST options (:option: value) before the first empty line
const processCodeContent = (rawCode) => {
    const lines = rawCode.split('\n');
    let inHeaderOptions = true;

    const processedLines = lines.map((line) => {
        const trimmedLine = line.trim();

        // The first empty line marks the end of directive options
        if (trimmedLine === '') {
            inHeaderOptions = false;
            return line;
        }

        // If we are still in options section and line starts with :
        if (inHeaderOptions && trimmedLine.startsWith(':')) {
            return `# ${line}`;
        }

        // Once regular code starts, options header is closed
        inHeaderOptions = false;
        return line;
    });

    return processedLines.join('\n');
};

/**
 * Converts MyST Markdown content into a Jupyter Notebook JSON string.
 * Supports monolithic files without +++ cell separators.
 *
 * @param {string | Uint8Array | ArrayBuffer} input - Raw MyST text or buffer
 * @returns {string} JSON string of the generated .ipynb notebook
 */
export function convertMystToNotebook(input) {
    let text;

    if (typeof input === 'string') {
        text = input;
    } else if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
        text = new TextDecoder('utf-8').decode(input);
    } else {
        throw new TypeError('Input must be a string, Uint8Array, or ArrayBuffer');
    }

    const cells = [];
    let detectedLanguage = 'python';

    // Helper to format source text as an array of line strings
    const formatSource = (srcText) => {
        return srcText.split('\n').map((line, idx, arr) => 
            idx === arr.length - 1 ? line : line + '\n'
        );
    };

    // Regex matching code-cell directives anywhere in a block
    const codeCellRegex = /:::\s*\{\s*code-cell\s*\}\s*(\w*)\n([\s\S]*?)\n:::/g;

    // Parses a single block (which may contain inline code-cells and Markdown)
    const parseBlockContent = (blockText) => {
        let lastIndex = 0;
        let match;

        while ((match = codeCellRegex.exec(blockText)) !== null) {
            // Extract Markdown text preceding the code-cell
            const markdownBefore = blockText.slice(lastIndex, match.index).trim();
            if (markdownBefore) {
                cells.push({
                    cell_type: 'markdown',
                    metadata: {},
                    source: formatSource(markdownBefore)
                });
            }

            // Extract code-cell language and content
            const [, lang, codeContent] = match;
            if (lang) {
                detectedLanguage = lang;
            }

            cells.push({
                cell_type: 'code',
                execution_count: null,
                metadata: {},
                outputs: [],
                source: formatSource(processCodeContent(codeContent.trimEnd()))
            });

            lastIndex = codeCellRegex.lastIndex;
        }

        // Extract remaining Markdown text after the last code-cell
        const markdownAfter = blockText.slice(lastIndex).trim();
        if (markdownAfter) {
            cells.push({
                cell_type: 'markdown',
                metadata: {},
                source: formatSource(markdownAfter)
            });
        }
    };

    // 1. Extract potential Frontmatter at the very beginning
    let contentToSplit = text;
    const trimmedText = text.trimStart();

    if (trimmedText.startsWith('---')) {
        const parts = trimmedText.split('---');
        if (parts.length >= 3) {
            const frontmatter = `---${parts[1]}---`;
            cells.push({
                cell_type: 'markdown',
                metadata: {},
                source: formatSource(frontmatter)
            });
            contentToSplit = parts.slice(2).join('---');
        }
    }

    // 2. Split content by explicit +++ separators if present, or process as one block
    const rawBlocks = contentToSplit.split(/\n\+\+\+\n|\n\+\+\+$|^\+\+\+\n/);

    for (const block of rawBlocks) {
        if (block.trim()) {
            parseBlockContent(block);
        }
    }

    // 3. Assemble Jupyter Notebook v4 JSON structure
    const notebook = {
        cells: cells,
        metadata: {
            language_info: {
                name: detectedLanguage
            }
        },
        nbformat: 4,
        nbformat_minor: 5
    };

    return JSON.stringify(notebook, null, 2);
}


/*** ----------------- IPYNB TO MYST ------------------ ******/


/**
 * Uncomments MyST directive options (# :option: value) before the first empty line.
 * 
 * @param {string} rawCode - Source code from Jupyter cell
 * @returns {string} Code with restored MyST options
 */
function uncommentCodeOptions(rawCode) {
    const lines = rawCode.split('\n');
    let inHeaderOptions = true;

    const processedLines = lines.map((line) => {
        const trimmed = line.trim();

        // Une ligne vide marque la fin de la section des options
        if (trimmed === '') {
            inHeaderOptions = false;
            return line;
        }

        // Si on est dans les options et que la ligne est un commentaire d'option MyST (# :)
        if (inHeaderOptions && /^#\s*:/.test(trimmed)) {
            return line.replace(/^#\s*/, '');
        }

        // Dès qu'on trouve autre chose, ce n'est plus une section d'options
        inHeaderOptions = false;
        return line;
    });

    return processedLines.join('\n');
}

/**
 * Converts a Jupyter Notebook (JSON string, Uint8Array or ArrayBuffer) into MyST Markdown format.
 * 
 * @param {string | Uint8Array | ArrayBuffer} input - Raw JSON string or binary buffer of the .ipynb file
 * @returns {string} Converted MyST Markdown text
 */
export function convertNotebookToMyst(input) {
    let jsonString;

    if (typeof input === 'string') {
        jsonString = input;
    } else if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
        jsonString = new TextDecoder('utf-8').decode(input);
    } else {
        throw new TypeError('Input must be a string, Uint8Array, or ArrayBuffer');
    }

    const nb = JSON.parse(jsonString);
    const lang = nb.metadata?.language_info?.name || 'python';
    const outputLines = [];

    nb.cells?.forEach((cell, idx) => {
        const content = Array.isArray(cell.source) 
            ? cell.source.join('').trim() 
            : cell.source?.trim() || '';

        if (!content) return;

        // 1. Handle YAML Frontmatter in the first cell (no +++ break)
        if (idx === 0 && content.startsWith('---')) {
            outputLines.push(content);
            outputLines.push('\n');
            return;
        }

        // Add MyST cell break before every other non-empty cell
        outputLines.push('+++');

        // 2. Standard Markdown cells
        if (cell.cell_type === 'markdown') {
            outputLines.push(content);
            outputLines.push('\n');
        } 
        // 3. Code cells
        else if (cell.cell_type === 'code') {
            const cleanedContent = uncommentCodeOptions(content);
            outputLines.push(`:::{code-cell} ${lang}`);
            outputLines.push(cleanedContent);
            outputLines.push(':::\n');
        }
        // 4. Raw cells
        else if (cell.cell_type === 'raw') {
            outputLines.push(content);
            outputLines.push('\n');
        }
    });

    return outputLines.join('\n');
}
