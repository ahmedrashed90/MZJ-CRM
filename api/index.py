from fastapi import FastAPI
import os

app = FastAPI()

@app.get("/")
def read_root():
    return {"status": "CRM API Running"}

@app.get("/test-db")
def test_db():
    try:
        from sqlalchemy import create_engine, text

        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            return {"ok": False, "error": "missing DATABASE_URL"}

        # 1) Neon غالبًا بيدي postgresql:// ... ومع psycopg3 الأفضل نخليه postgresql+psycopg://
        if db_url.startswith("postgresql://"):
            db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
        elif db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)

        # 2) تأكد إن sslmode=require موجود (Neon يحتاج SSL)
        if "sslmode=" not in db_url:
            joiner = "&" if "?" in db_url else "?"
            db_url = db_url + f"{joiner}sslmode=require"

        engine = create_engine(db_url, pool_pre_ping=True)

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))

        return {"ok": True, "db_status": "connected"}

    except Exception as e:
        return {"ok": False, "error": str(e)}
