"""LIPS 협약 사업계획서 검토 도구 - FastAPI 백엔드."""

import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import db
import extract
import llm
import sections

load_dotenv()

app = FastAPI(title="LIPS 협약 사업계획서 검토 도구")

db.init_db()

ALLOWED_EXT = {".pdf", ".hwp", ".hwpx"}


def _save_upload_to_temp(upload: UploadFile) -> Path:
    ext = Path(upload.filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"지원하지 않는 파일 형식입니다: {ext} (pdf/hwp/hwpx만 지원)")
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    tmp.write(upload.file.read())
    tmp.close()
    return Path(tmp.name)


@app.post("/guidelines/upload")
async def upload_guideline(file: UploadFile = File(...)):
    tmp_path = _save_upload_to_temp(file)
    try:
        text = extract.extract_text(str(tmp_path))
        chunks = sections.split_guideline_sections(text)
        if not chunks:
            raise HTTPException(400, "문서에서 텍스트를 추출하지 못했습니다.")
        db.add_guideline_chunks(file.filename, chunks)
        return {"filename": file.filename, "chunks_added": len(chunks)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"지침 처리 중 오류: {e}")
    finally:
        tmp_path.unlink(missing_ok=True)


@app.get("/guidelines")
async def get_guidelines():
    return {
        "total_chunks": db.count_guideline_chunks(),
        "sources": db.list_guideline_sources(),
    }


@app.delete("/guidelines")
async def delete_guidelines():
    db.clear_guidelines()
    return {"status": "cleared"}


@app.post("/review")
async def review_plan(file: UploadFile = File(...)):
    tmp_path = _save_upload_to_temp(file)
    try:
        text = extract.extract_text(str(tmp_path))
        if not text.strip():
            raise HTTPException(400, "문서에서 텍스트를 추출하지 못했습니다.")
        results = llm.review_business_plan(text)

        session_id = db.create_review_session(file.filename)
        for item in results:
            db.add_review_item(session_id, item)

        return {"session_id": session_id, "filename": file.filename, "items": results}
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"검토 처리 중 오류: {e}")
    finally:
        tmp_path.unlink(missing_ok=True)


@app.get("/review/sessions")
async def get_sessions():
    return db.list_review_sessions()


@app.get("/review/sessions/{session_id}")
async def get_session(session_id: int):
    result = db.get_review_session(session_id)
    if not result["session"]:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")
    return result


app.mount("/", StaticFiles(directory="static", html=True), name="static")
