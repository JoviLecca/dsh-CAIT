"""Generate a small formatted DOCX fixture for the export-preservation test."""
from pathlib import Path

from docx import Document
from docx.shared import RGBColor

out = Path(__file__).with_name("sample-format.docx")
doc = Document()
doc.add_heading("CAIT DOCX format test", level=1)
paragraph = doc.add_paragraph()
run = paragraph.add_run("Bold source paragraph with ")
run.bold = True
run.font.color.rgb = RGBColor(0xC0, 0x39, 0x2B)
run = paragraph.add_run("a colored tail.")
run.italic = True
doc.add_paragraph("Plain source paragraph.")
doc.save(out)
print(out)
