"""추출된 원문 텍스트를 조항/항목 단위 청크로 분할한다.

- 지침 문서: "제n조" 조항 경계로 분할
- 사업계획서: "□"로 시작하는 항목 헤더로 분할
- 둘 다 안 맞으면 고정 길이(overlap 포함) 슬라이딩 청크로 폴백
"""

import re

# 실제 조항 헤더("제3조(정의)")만 경계로 인식한다. "「민법」 제777조의" 같은 본문 중
# 인용은 조 번호 뒤에 "(" 가 바로 오지 않으므로 걸러진다.
_JOSU_PATTERN = re.compile(r"(?=제\s*\d+\s*조\s*\()")
_BOX_PATTERN = re.compile(r"(?=^\s*□)", re.MULTILINE)

_CHUNK_SIZE = 900
_CHUNK_OVERLAP = 150
_MAX_SECTION_CHARS = 2500  # 조/항목 분할 결과가 과도하게 크면 추가로 잘게 쪼갠다


def _first_line(text: str, max_len: int = 40) -> str:
    """의미있는 첫 줄을 라벨로 뽑는다. "□"처럼 기호만 있는 줄은 건너뛰고
    다음 줄과 합쳐 제목을 구성한다 (hwp 표 헤더가 기호/텍스트로 줄바꿈되는 경우 대응)."""
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    label_parts = []
    total_len = 0
    for line in lines:
        stripped = re.sub(r"[□○·\-\s]+", "", line)
        if stripped or label_parts:
            label_parts.append(line)
            total_len += len(line)
        if total_len >= 4 and stripped:
            break
        if len(label_parts) >= 3:
            break
    label = " ".join(label_parts) if label_parts else (lines[0] if lines else "")
    return label[:max_len]


def _cap_large_sections(items: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """분할된 조/항목이 너무 크면 추가로 잘게 쪼갠다 (검색 정확도를 위해)."""
    result = []
    for label, content in items:
        if len(content) <= _MAX_SECTION_CHARS:
            result.append((label, content))
            continue
        sub_chunks = _sliding_chunks(content)
        for i, (_, sub_content) in enumerate(sub_chunks, start=1):
            result.append((f"{label} ({i}/{len(sub_chunks)})", sub_content))
    return result


def split_guideline_sections(text: str) -> list[tuple[str, str]]:
    """지침 문서를 "제n조(...)" 단위로 분할. 실패 시 고정 길이 청크로 폴백."""
    parts = [p.strip() for p in _JOSU_PATTERN.split(text) if p.strip()]
    if len(parts) >= 3:
        return _cap_large_sections([(_first_line(p, 60), p) for p in parts])
    return _sliding_chunks(text)


def split_plan_sections(text: str) -> list[tuple[str, str]]:
    """사업계획서를 "□" 항목 단위로 분할. 실패 시 고정 길이 청크로 폴백."""
    parts = [p.strip() for p in _BOX_PATTERN.split(text) if p.strip()]
    if len(parts) >= 2:
        return _cap_large_sections([(_first_line(p, 60), p) for p in parts])
    return _sliding_chunks(text)


def _sliding_chunks(text: str) -> list[tuple[str, str]]:
    text = text.strip()
    if not text:
        return []
    chunks = []
    step = _CHUNK_SIZE - _CHUNK_OVERLAP
    for start in range(0, len(text), step):
        chunk = text[start : start + _CHUNK_SIZE].strip()
        if chunk:
            chunks.append((_first_line(chunk, 60), chunk))
        if start + _CHUNK_SIZE >= len(text):
            break
    return chunks
