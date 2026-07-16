"""PDF / HWP / HWPX 문서에서 텍스트를 추출하는 모듈."""

import html
import re
import sys
import tempfile
import zipfile
from pathlib import Path


def extract_text(file_path: str) -> str:
    """확장자에 따라 적절한 추출기로 텍스트를 반환한다."""
    ext = Path(file_path).suffix.lower()
    if ext == ".pdf":
        return _extract_pdf(file_path)
    if ext == ".hwpx":
        return _extract_hwpx(file_path)
    if ext == ".hwp":
        return _extract_hwp(file_path)
    raise ValueError(f"지원하지 않는 파일 형식입니다: {ext} (pdf/hwp/hwpx만 지원)")


def _extract_pdf(file_path: str) -> str:
    from pypdf import PdfReader

    reader = PdfReader(file_path)
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages)


def _extract_hwp(file_path: str) -> str:
    """hwp5html로 변환 후 HTML 태그를 제거한다 (표 안 내용까지 보존됨)."""
    from hwp5.hwp5html import main as hwp5html_main

    with tempfile.TemporaryDirectory() as tmp_dir:
        out_dir = str(Path(tmp_dir) / "out")
        old_argv = sys.argv
        try:
            sys.argv = ["hwp5html", "--output", out_dir, file_path]
            try:
                hwp5html_main()
            except SystemExit:
                pass
        finally:
            sys.argv = old_argv

        index_path = Path(out_dir) / "index.xhtml"
        if not index_path.exists():
            raise RuntimeError("HWP 변환에 실패했습니다 (index.xhtml 생성 안 됨)")
        raw_html = index_path.read_text(encoding="utf-8")

    # <script>/<style> 블록 제거 후 태그 제거, 엔티티 unescape
    raw_html = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw_html, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", "\n", raw_html)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def _extract_hwpx(file_path: str) -> str:
    """HWPX(zip+xml) 포맷에서 본문 섹션의 텍스트 런(<hp:t>)을 순서대로 읽는다."""
    with zipfile.ZipFile(file_path) as z:
        section_names = sorted(
            n for n in z.namelist() if re.match(r"Contents/section\d+\.xml$", n)
        )
        if not section_names:
            raise RuntimeError("HWPX에서 본문 섹션을 찾을 수 없습니다")

        parts = []
        for name in section_names:
            xml = z.read(name).decode("utf-8", errors="ignore")
            for run_text in re.findall(r"<hp:t[^>]*>(.*?)</hp:t>", xml, re.DOTALL):
                clean = re.sub(r"<[^>]+>", "", run_text)
                clean = html.unescape(clean).strip()
                if clean:
                    parts.append(clean)
        return "\n".join(parts)
