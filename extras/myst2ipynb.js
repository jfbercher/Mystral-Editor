#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * CLI execution handler
 */
function main() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.log('Usage: node myst2ipynb.js <input.md> [output.ipynb]');
        process.exit(1);
    }

    const inputFile = path.resolve(args[0]);

    if (!fs.existsSync(inputFile)) {
        console.error(`Error: file ${inputFile} does not exist.`);
        process.exit(1);
    }

    const outputFile = args[1] 
        ? path.resolve(args[1]) 
        : inputFile.replace(/\.md$/, '.ipynb');

    try {
        const inputBuffer = fs.readFileSync(inputFile);
        const notebookJson = convertMystToNotebook(inputBuffer);
        fs.writeFileSync(outputFile, notebookJson, 'utf-8');
        console.log(`Successfully converted: ${outputFile}`);
    } catch (err) {
        console.error(`Error processing MyST document: ${err.message}`);
        process.exit(1);
    }
}

const nodePath = fileURLToPath(import.meta.url);
if (process.argv[1] === nodePath) {
    main();
}