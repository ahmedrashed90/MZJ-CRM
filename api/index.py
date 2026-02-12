from fastapi import FastAPI
import os
from urllib.parse import urlparse
from sqlalchemy import create_engine, text

app = FastAPI()


@app.get("/")
def read_root():
    return {"status": "CRM API Running"}


@app.get("/test-db")
def test_db():
    raw = os.getenv("DATABASE_URL", "")

    if not raw:
        return {"ok": False, "error": "DATABASE_URL not set"}

    # تنظيف الرابط من psql أو quotes
    db_url = raw.strip().strip('"').strip("'")

    if db_url.startswith("psql"):
        db_url = db_url.replace("psql", "").strip()

    # تحويل scheme للـ psycopg3
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
    elif db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)

    # إزالة channel_binding لو موجود
    db_url = db_url.replace("&channel_binding=require", "")
    db_url = db_url.replace("?channel_binding=require", "")

    # تأكد من وجود sslmode=require
    if "sslmode=" not in db_url:
        joiner = "&" if "?" in db_url else "?"
        db_url = db_url + f"{joiner}sslmode=require"

    try:
        engine = create_engine(db_url, pool_pre_ping=True)

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))

        return {"ok": True, "db_status": "connected"}

    except Exception as e:
        return {
            "ok": False,
            "error": str(e)
        }
