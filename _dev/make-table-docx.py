from pathlib import Path

from docx import Document

doc = Document()
doc.add_paragraph('Before table paragraph.')
table = doc.add_table(rows=2, cols=2)
table.cell(0, 0).text = 'Table cell A'
table.cell(0, 1).text = 'Table cell B'
table.cell(1, 0).text = 'Table cell C'
table.cell(1, 1).text = 'Table cell D'
doc.add_paragraph('After table paragraph.')

output = Path(__file__).with_name('sample-table.docx')
doc.save(output)
print(f'wrote {output.name}')
