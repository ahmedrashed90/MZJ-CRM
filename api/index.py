from fastapi import FastAPI
import os
from urllib.parse import urlparse

app = FastAPI()

@app.get("/")
def read_root():
    return {"status": "CRM API Running"}

@app.get("/test-db")
def test_db():
    raw = os.getenv("DATABASE_URL", "")

    # نخفي الباسورد قبل العرض
    safe = raw
    if "@" in raw and "://" in raw:
        try:
            p = urlparse(raw)
            if p.username:
                safe = raw.replace(f":{p.password}@", ":***@")
        except Exception:
            pass

    # معلومات تشخيصية بدون حساسية
    info = {
        "has_value": bool(raw),
        "starts_with": raw[:20],
        "contains_space": (" " in raw),
        "contains_quote": ('"' in raw or "'" in raw),
        "contains_newline": ("\n" in raw or "\r" in raw),
        "safe_preview": safe[:120]
    }

    try:
        from sqlalchemy import create_engine, text

        db_url = raw.strip().strip('"').strip("'")  # نشيل مسافات واقتباسات

        # تحويل الـscheme للـpsycopg3
        if db_url.startswith("postgresql://"):
            db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
        elif db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)

        # إضافة sslmode=require لو ناقص
        if "sslmode=" not in db_url:
            joiner = "&" if "?" in db_url else "?"
            db_url = db_url + f"{joiner}sslmode=require"

        engine = create_engine(db_url, pool_pre_ping=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))

        return {"ok": True, "db_status": "connected", "info": info}

    except Exception as e:
        return {"ok": False, "error": str(e), "info": info}
