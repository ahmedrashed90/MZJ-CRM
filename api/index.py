from fastapi import FastAPI
import os

app = FastAPI()

@app.get("/")
def read_root():
    return {"status": "CRM API Running"}

# نخلي اختبار DB endpoint اختياري ومش بيكسر الصفحة الرئيسية
@app.get("/test-db")
def test_db():
    from sqlalchemy import create_engine, text  # import داخل الدالة
    DATABASE_URL = os.getenv("DATABASE_URL")
    if not DATABASE_URL:
        return {"db_status": "missing DATABASE_URL"}

    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"db_status": "connected"}
