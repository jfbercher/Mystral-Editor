#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * CLI execution handler
 */
function main() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.log('Usage: node ipynb2myst.js <input.ipynb> [output.md]');
        process.exit(1);
    }

    const inputFile = path.resolve(args[0]);

    if (!fs.existsSync(inputFile)) {
        console.error(`Error: file ${inputFile} does not exist.`);
        process.exit(1);
    }

    const outputFile = args[1] 
        ? path.resolve(args[1]) 
        : inputFile.replace(/\.ipynb$/, '.md');

    try {
        const inputBuffer = fs.readFileSync(inputFile);
        const mystText = convertNotebookToMyst(inputBuffer);
        fs.writeFileSync(outputFile, mystText, 'utf-8');
        console.log(`Successfully converted: ${outputFile}`);
    } catch (err) {
        console.error(`Error processing notebook: ${err.message}`);
        process.exit(1);
    }
}

// Execute CLI if run directly
const nodePath = fileURLToPath(import.meta.url);
if (process.argv[1] === nodePath) {
    main();
}