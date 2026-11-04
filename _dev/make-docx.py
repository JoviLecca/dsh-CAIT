from docx import Document

doc = Document()
doc.add_heading('CAIT import test', level=1)
doc.add_paragraph('First paragraph contains two sentences. This is the second one.')
doc.add_paragraph('Second paragraph with a term: translation memory.')
doc.save(r'C:\Users\ShawnFu\Desktop\dsh-CAIT\_dev\sample.docx')
print('wrote sample.docx')
