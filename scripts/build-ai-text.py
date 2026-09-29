#!/usr/bin/env python3
"""build-ai-text.py — the 2012 text of SRMW as clean Markdown for AI readers.

Reads the published PDF (SOMA/canon/srmw/SRMW.pdf) and writes ai/srmw.md.
It removes only what the PDF layout added: running heads, page numbers,
line-end hyphens and soft hyphens, and the hard line breaks inside paragraphs.
Every word, typo and quirk of the published text stays as printed
("Just two more page." on p. 213 included). Printed page numbers are kept as
HTML comments (<!-- p. 213 -->) so a reader can cite a page.

Paragraphs: in the PDF a paragraph's first line is indented (x0 about 81 pt);
its continuation lines sit at the margin (x0 about 63 pt). Centered short lines
are headings. Written 2026-09-28 by Claude Opus 5.5 for Mike Wolf (bead es-s2p family).

Usage: python3 scripts/build-ai-text.py [path/to/SRMW.pdf]
"""
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

PDF = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "Projects/SOMA/canon/srmw/SRMW.pdf")
OUT = Path(__file__).resolve().parent.parent / "ai" / "srmw.md"
RUNNING_HEAD = "Self-Referential Metanovel Writing for D*mmies"
SOFT = "­"

doc = fitz.open(PDF)
paras = []          # list of (kind, text); kind in {"p", "h", "page"}
cur = []            # lines of the paragraph being built
pending = []        # printed pages that ended inside the open paragraph


def flush():
    if cur:
        text = ""
        for line in cur:
            if not text:
                text = line
            elif text.endswith(SOFT):
                text = text[:-1] + line
            elif re.search(r"[A-Za-z]-$", text) and re.match(r"[a-z]", line):
                text = text + line          # keep the printed hyphen, join the word
            else:
                text = text + " " + line
        paras.append(("p", text.replace(SOFT, "").strip()))
        cur.clear()
        for n in pending:
            paras.append(("page", n))
        pending.clear()


for pno, page in enumerate(doc):
    width = page.rect.width
    lines = []
    for block in page.get_text("dict")["blocks"]:
        for l in block.get("lines", []):
            t = "".join(s["text"] for s in l["spans"]).rstrip()
            if t.strip():
                lines.append((l["bbox"][0], l["bbox"][2], t))
    printed = None
    for x0, x1, t in lines:
        s = t.strip()
        if s == RUNNING_HEAD:
            continue
        if re.fullmatch(r"\d{1,3}", s) and (x1 - x0) < 20:
            printed = s                     # the printed page number
            continue
        if cur and cur[-1].endswith(SOFT):  # a word split across the line break: always continue
            cur.append(s)
            continue
        toc = re.match(r"(.*?)\s*\.{5,}\s*(\d+)$", s)
        centered = abs((x0 + x1) / 2 - width / 2) < 30 and (x1 - x0) < width * 0.6 and x0 > 100
        if toc:
            flush()
            paras.append(("toc", f"{toc.group(1).strip()} — {toc.group(2)}"))
        elif centered:
            flush()
            paras.append(("h", s))
        elif x0 > 72:                        # indented: a new paragraph
            flush()
            cur.append(s)
        else:                                # at the margin: continuation
            cur.append(s)
    if printed:
        # a paragraph may run across the page turn: note the page after the paragraph it ends in
        if cur:
            pending.append(printed)
        else:
            paras.append(("page", printed))

flush()

# Write: headings as ##, page markers as comments placed after the paragraph in progress.
out = [
    "# Self-Referential Metanovel Writing for D*mmies",
    "",
    "_The 2012 text as published (Salt Pond Publishing; Kindle edition 27 February 2025), by Michael Wolf · Joseph Beller · The Metanovel · (The reader) · You._",
    "_Converted for AI readers from the published PDF: only line breaks, page furniture and hyphenation were removed. Every word and every typo is as printed. `<!-- p. N -->` follows the paragraph in which printed page N ends._",
    "",
]
for kind, text in paras:
    if kind == "h":
        out += [f"## {text}", ""]
    elif kind == "toc":
        out += [f"- {text}"]
    elif kind == "page":
        out += [f"<!-- p. {text} -->", ""]
    else:
        out += [text, ""]

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("\n".join(out), encoding="utf-8")
words = sum(len(t.split()) for k, t in paras if k == "p")
print(f"wrote {OUT} — {sum(1 for k, _ in paras if k == 'p')} paragraphs, {sum(1 for k, _ in paras if k == 'h')} headings, {words} words")
