
#!/usr/bin/env python3

import argparse
import re
import sys
from pathlib import Path


def slugify(title: str) -> str:
    """Convertit un titre en nom de fichier."""
    slug = title.strip().lower()
    slug = re.sub(r"\s+", "-", slug)
    slug = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


def split_markdown(input_file: Path, keep_heading: bool = False) -> None:
    content = input_file.read_text(encoding="utf-8")

    # Reconnaît un titre ## précédé éventuellement d'un label MyST :
    # (scientific_authoring)=
    # ## Scientific Authoring
    heading_pattern = re.compile(
        r"^(?:(?P<label>\([^)]+\)=[ \t]*\r?\n))?"
        r"(?P<heading>##[ \t]+(?P<title>.+?)\s*#*[ \t]*)$",
        re.MULTILINE,
    )

    matches = list(heading_pattern.finditer(content))

    if not matches:
        print("Aucune section de niveau ## trouvée.", file=sys.stderr)
        sys.exit(1)

    created_files = []

    for i, match in enumerate(matches):
        title = match.group("title").strip()

        # Le début de section inclut le label éventuel.
        section_start = match.start()
        section_end = (
            matches[i + 1].start()
            if i + 1 < len(matches)
            else len(content)
        )

        if keep_heading:
            body = content[section_start:section_end].strip()
        else:
            # Supprime le titre et le label éventuel.
            body = content[match.end():section_end].strip()

        filename = f"{slugify(title)}.md"
        output_file = input_file.parent / filename

        # Évite les collisions avec des fichiers existants.
        if output_file.exists() or filename in created_files:
            base = slugify(title)
            suffix = 2
            while (
                (input_file.parent / f"{base}-{suffix}.md").exists()
                or f"{base}-{suffix}.md" in created_files
            ):
                suffix += 1
            filename = f"{base}-{suffix}.md"
            output_file = input_file.parent / filename

        front_matter = f"---\ntitle: {title}\n---\n\n"
        output_file.write_text(
            front_matter + body + "\n",
            encoding="utf-8",
        )

        created_files.append(filename)
        print(f"Créé : {filename}")

    # Liste des fichiers créés.
    list_file = input_file.parent / f"files_{input_file.stem}.md"
    list_file.write_text(
        "".join(f"- {name}\n" for name in created_files),
        encoding="utf-8",
    )

    print(f"Liste créée : {list_file.name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Découpe un fichier Markdown en sections ##."
    )
    parser.add_argument("input_file", type=Path, help="Fichier Markdown source")
    parser.add_argument(
        "--keep-heading",
        action="store_true",
        help="Conserve le titre ## et son label éventuel dans chaque fichier",
    )

    args = parser.parse_args()

    if not args.input_file.is_file():
        print(f"Fichier introuvable : {args.input_file}", file=sys.stderr)
        sys.exit(1)

    split_markdown(args.input_file, keep_heading=args.keep_heading)
