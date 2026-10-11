#!/usr/bin/env python3
import sys
import json
from pathlib import Path
from typing import Union
import re

def uncomment_code_options(raw_code: str) -> str:
    """
    Uncomments MyST directive options (# :option: value) before the first empty line.
    """
    lines = raw_code.split("\n")
    in_header_options = True
    processed_lines = []

    for line in lines:
        trimmed = line.strip()

        # Une ligne vide marque la fin de la section des options
        if not trimmed:
            in_header_options = False
            processed_lines.append(line)
            continue

        # Si la ligne commence par '# :' dans la section en-tête
        if in_header_options and re.match(r"^#\s*:", trimmed):
            processed_lines.append(re.sub(r"^#\s*", "", line))
        else:
            in_header_options = False
            processed_lines.append(line)

    return "\n".join(processed_lines)


def convert_notebook_to_myst(input_data: Union[str, bytes, Path]) -> str:
    """
    Converts Jupyter Notebook content (JSON string, bytes/buffer, or Path) 
    into MyST Markdown format.
    """
    # Parse JSON from string, bytes, or file path
    if isinstance(input_data, Path):
        with input_data.open('r', encoding='utf-8') as f:
            nb = json.load(f)
    elif isinstance(input_data, bytes):
        nb = json.loads(input_data.decode('utf-8'))
    elif isinstance(input_data, str):
        nb = json.loads(input_data)
    else:
        raise TypeError("Input must be a str, bytes, or Path object")

    lang = nb.get("metadata", {}).get("language_info", {}).get("name", "python")
    output_lines = []

    for idx, cell in enumerate(nb.get("cells", [])):
        source = cell.get("source", "")
        
        # Handle cells source as list of strings or single string
        if isinstance(source, list):
            content = "".join(source).strip()
        else:
            content = source.strip()

        if not content:
            continue

        # 1. Handle YAML Frontmatter in the first cell (no +++ break)
        if idx == 0 and content.startswith("---"):
            output_lines.append(content)
            output_lines.append("\n")
            continue

        # Add MyST cell break before every other non-empty cell
        output_lines.append("+++")

        cell_type = cell.get("cell_type")

        # 2. Standard Markdown cells
        if cell_type == "markdown":
            output_lines.append(content)
            output_lines.append("\n")

        # 3. Code cells
        elif cell_type == "code":
            cleaned_content = uncomment_code_options(content)
            output_lines.append(f":::{{code-cell}} {lang}")
            output_lines.append(cleaned_content)
            output_lines.append(":::\n")

        # 4. Raw cells
        elif cell_type == "raw":
            output_lines.append(content)
            output_lines.append("\n")

    return "\n".join(output_lines)


def main():
    """CLI execution handler."""
    if len(sys.argv) < 2:
        print("Usage: python ipynb2myst.py <input.ipynb> [output.md]")
        sys.exit(1)

    input_file = Path(sys.argv[1])
    if not input_file.exists():
        print(f"Error: file {input_file} does not exist.")
        sys.exit(1)

    if len(sys.argv) >= 3:
        output_file = Path(sys.argv[2])
    else:
        output_file = input_file.with_suffix(".md")

    try:
        myst_text = convert_notebook_to_myst(input_file)
        output_file.write_text(myst_text, encoding="utf-8")
        print(f"Successfully converted: {output_file}")
    except Exception as err:
        print(f"Error processing notebook: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()