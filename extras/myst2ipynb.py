#!/usr/bin/env python3
import sys
import json
import re
from pathlib import Path
from typing import Union

def process_code_content(raw_code: str) -> str:
    lines = raw_code.split("\n")
    in_header_options = True
    processed_lines = []

    for line in lines:
        trimmed = line.strip()

        # Première ligne vide = fin des options de directive
        if not trimmed:
            in_header_options = False
            processed_lines.append(line)
            continue

        # Si on est encore dans les options et que la ligne commence par :
        if in_header_options and trimmed.startswith(":"):
            processed_lines.append(f"# {line}")
        else:
            in_header_options = False
            processed_lines.append(line)

    return "\n".join(processed_lines)

def convert_myst_to_notebook(input_data: Union[str, bytes, Path]) -> str:
    """
    Converts MyST Markdown content (JSON string, bytes/buffer, or Path)
    into a Jupyter Notebook JSON string.
    Supports monolithic files without +++ cell separators.
    """
    if isinstance(input_data, Path):
        text = input_data.read_text(encoding="utf-8")
    elif isinstance(input_data, bytes):
        text = input_data.decode("utf-8")
    elif isinstance(input_data, str):
        text = input_data
    else:
        raise TypeError("Input must be a str, bytes, or Path object")

    cells = []
    detected_language = "python"

    def format_source(src_text: str):
        lines = [f"{line}\n" for line in src_text.split("\n")]
        if lines:
            lines[-1] = lines[-1].rstrip("\n")
        return lines

    code_cell_pattern = re.compile(
        r":::\s*\{\s*code-cell\s*\}\s*(\w*)\n([\s\S]*?)\n:::"
    )

    def parse_block_content(block_text: str):
        nonlocal detected_language
        last_index = 0

        for match in code_cell_pattern.finditer(block_text):
            # Extract Markdown text preceding the code-cell
            markdown_before = block_text[last_index:match.start()].strip()
            if markdown_before:
                cells.append({
                    "cell_type": "markdown",
                    "metadata": {},
                    "source": format_source(markdown_before)
                })

            # Extract code-cell language and content
            lang, code_content = match.groups()
            if lang:
                detected_language = lang

            cells.append({
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": format_source(process_code_content(code_content.rstrip()))
            })

            last_index = match.end()

        # Extract remaining Markdown text after the last code-cell
        markdown_after = block_text[last_index:].strip()
        if markdown_after:
            cells.append({
                "cell_type": "markdown",
                "metadata": {},
                "source": format_source(markdown_after)
            })

    # 1. Extract potential Frontmatter at the very beginning
    content_to_split = text
    trimmed_text = text.lstrip()

    if trimmed_text.startswith("---"):
        parts = trimmed_text.split("---")
        if len(parts) >= 3:
            frontmatter = f"---{parts[1]}---"
            cells.append({
                "cell_type": "markdown",
                "metadata": {},
                "source": format_source(frontmatter)
            })
            content_to_split = "---".join(parts[2:])

    # 2. Split content by explicit +++ separators if present, or process as one block
    raw_blocks = re.split(r"\n\+\+\+\n|\n\+\+\+$|^\+\+\+\n", content_to_split)

    for block in raw_blocks:
        if block.strip():
            parse_block_content(block)

    # 3. Assemble Jupyter Notebook v4 JSON structure
    notebook = {
        "cells": cells,
        "metadata": {
            "language_info": {
                "name": detected_language
            }
        },
        "nbformat": 4,
        "nbformat_minor": 5
    }

    return json.dumps(notebook, indent=2, ensure_ascii=False)


def main():
    """CLI execution handler."""
    if len(sys.argv) < 2:
        print("Usage: python myst2ipynb.py <input.md> [output.ipynb]")
        sys.exit(1)

    input_file = Path(sys.argv[1])
    if not input_file.exists():
        print(f"Error: file {input_file} does not exist.")
        sys.exit(1)

    if len(sys.argv) >= 3:
        output_file = Path(sys.argv[2])
    else:
        output_file = input_file.with_suffix(".ipynb")

    try:
        notebook_json = convert_myst_to_notebook(input_file)
        output_file.write_text(notebook_json, encoding="utf-8")
        print(f"Successfully converted: {output_file}")
    except Exception as err:
        print(f"Error processing MyST document: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()