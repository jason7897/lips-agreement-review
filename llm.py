"""Groq LLM을 이용한 사업계획서 항목별 지침 부합 여부 판정."""

import json
import os

from groq import Groq

import db
import sections

MODEL = os.environ.get("REVIEW_MODEL", "llama-3.3-70b-versatile")
MAX_ITEM_CHARS = 3500

_SYSTEM_PROMPT = """당신은 중소벤처기업부 LIPS(혁신 소상공인 투자연계지원) 사업의 주관기관 협약 담당자입니다.
아래 제공되는 [운영지침 근거 조항]을 근거로 [사업계획서 항목] 내용이 지침에 부합하는지 검토합니다.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 출력하지 마세요.
{
  "verdict": "적합" 또는 "수정필요" 또는 "불가",
  "reason": "판정 이유를 한국어로 구체적으로 서술",
  "guideline_ref": "근거로 삼은 지침 조항 라벨 (해당 없으면 빈 문자열)",
  "suggestion": "수정필요/불가인 경우 구체적인 수정 방향 제안 (적합인 경우 빈 문자열)"
}

판정 기준:
- "적합": 제공된 지침 조항과 명백히 배치되지 않음
- "수정필요": 지침에 부합하려면 문구/금액/항목 등을 조정해야 함
- "불가": 지침상 명백히 허용되지 않는 항목이거나 금지 규정에 해당
- 관련 지침 조항이 제공되지 않았다면 판단 근거 부족을 reason에 명시하고 verdict는 "적합"으로 처리 (근거 없이 불가 판정 금지)
"""


def _client() -> Groq:
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY가 설정되지 않았습니다 (.env 확인)")
    return Groq(api_key=api_key)


def _expand_large_items(items: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """LLM 프롬프트가 너무 길어지지 않도록 큰 항목은 추가로 잘게 쪼갠다."""
    expanded = []
    for label, content in items:
        if len(content) <= MAX_ITEM_CHARS:
            expanded.append((label, content))
            continue
        sub_chunks = sections._sliding_chunks(content)
        for i, (_, sub_content) in enumerate(sub_chunks, start=1):
            expanded.append((f"{label} ({i}/{len(sub_chunks)})", sub_content))
    return expanded


def review_business_plan(plan_text: str) -> list[dict]:
    """사업계획서 원문을 항목 단위로 분할하고, 각 항목을 지침과 대조하여 판정한다."""
    if db.count_guideline_chunks() == 0:
        raise RuntimeError("업로드된 지침이 없습니다. 먼저 지침 문서를 업로드해 학습시켜 주세요.")

    raw_items = sections.split_plan_sections(plan_text)
    items = _expand_large_items(raw_items)

    client = _client()
    results = []
    for label, content in items:
        relevant = db.find_relevant_guidelines(content, top_k=5)
        guideline_block = "\n\n".join(
            f"[{g['label']}]\n{g['content'][:1500]}" for g in relevant
        ) or "(관련 지침 조항을 찾지 못했습니다)"

        user_prompt = f"""[운영지침 근거 조항]
{guideline_block}

[사업계획서 항목: {label}]
{content}
"""
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                temperature=0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            )
            parsed = json.loads(resp.choices[0].message.content)
        except Exception as e:
            parsed = {
                "verdict": "확인필요",
                "reason": f"자동 판정 중 오류 발생: {e}",
                "guideline_ref": "",
                "suggestion": "",
            }

        results.append(
            {
                "item_label": label,
                "item_content": content,
                "verdict": parsed.get("verdict", "확인필요"),
                "reason": parsed.get("reason", ""),
                "guideline_ref": parsed.get("guideline_ref", ""),
                "suggestion": parsed.get("suggestion", ""),
            }
        )
    return results
