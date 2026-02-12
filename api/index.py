from fastapi import FastAPI
import os
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

    db_url = raw.strip()

    # إزالة كلمة psql لو موجودة
    if db_url.lower().startswith("psql"):
        db_url = db_url[4:].strip()

    # إزالة أي اقتباسات في البداية أو النهاية
    while db_url and db_url[0] in ["'", '"']:
        db_url = db_url[1:]
    while db_url and db_url[-1] in ["'", '"']:
        db_url = db_url[:-1]

    db_url = db_url.strip()

    # تحويل للـ psycopg3
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
    elif db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)

    # إزالة channel_binding
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
            "error": str(e),
            "cleaned_url_preview": db_url[:80]
        }
