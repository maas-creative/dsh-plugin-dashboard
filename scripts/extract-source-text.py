"""Read only: no document writes, formula calculation, macro execution or network."""
import json, sys, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

path = Path(sys.argv[1])
parts, limited, length = [], False, 0
def add(value):
    global length, limited
    if length + len(value) > 2_000_000:
        limited = True
        return False
    parts.append(value)
    length += len(value)
    return True

if path.suffix.lower() == '.pdf':
    from pypdf import PdfReader
    reader = PdfReader(path)
    if reader.is_encrypted:
        raise ValueError('暗号化PDFは解除された資料を指定してください')
    has_text = False
    for number, page in enumerate(reader.pages, 1):
        content = page.extract_text() or ''
        if not content.strip():
            limited = True
        has_text = has_text or bool(content.strip())
        if not add(f'[Page {number}]\n' + content + '\n'):
            break
    if not has_text:
        raise ValueError('PDF本文を抽出できません。画像PDFにはOCRが必要です')
elif path.suffix.lower() == '.docx':
    with zipfile.ZipFile(path) as archive:
        info = archive.getinfo('word/document.xml')
        if info.file_size > 10_000_000:
            raise ValueError('Word本文XMLが大きすぎます')
        document = ET.fromstring(archive.read(info))
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    for paragraph in document.findall('.//w:p', ns):
        if not add(''.join(t.text or '' for t in paragraph.findall('.//w:t', ns)) + '\n'):
            break
elif path.suffix.lower() == '.xlsx':
    from openpyxl import load_workbook
    with zipfile.ZipFile(path) as archive:
        if sum(i.file_size for i in archive.infolist()) > 100_000_000:
            raise ValueError('展開後のExcel資料が100MBを超えています')
    book = load_workbook(path, read_only=True, data_only=False, keep_links=False)
    try:
        for sheet in book:
            add(f'[Sheet {sheet.title}]\n')
            if sheet.max_column and sheet.max_column > 100:
                limited = True
            for index, row in enumerate(sheet.iter_rows(max_row=min(sheet.max_row or 5001, 5001), max_col=min(sheet.max_column or 100, 100)), 1):
                if index > 5000:
                    limited = True
                    break
                values = [f'{cell.coordinate}={cell.value}' for cell in row[:100] if cell.value is not None]
                if len(row) > 100:
                    limited = True
                if values and not add('\t'.join(values) + '\n'):
                    break
    finally:
        book.close()
else:
    raise ValueError('未対応の資料形式です')
print(json.dumps({'text': ''.join(parts), 'limited': limited, 'format': path.suffix.lower(), 'notice': 'ページ・セル位置は原資料の参照です。数式は再計算していません。抽出範囲外・画像本文・Wordの注釈は未読です。'}, ensure_ascii=False))
