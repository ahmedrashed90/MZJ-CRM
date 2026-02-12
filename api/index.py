from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext
from jose import jwt
import os
from datetime import datetime, timedelta

app = FastAPI()

# =========================
# DB URL CLEANER
# =========================
def clean_db_url(raw: str) -> str:
    if not raw:
        raise ValueError("DATABASE_URL not set")

    db_url = raw.strip()

    if db_url.lower().startswith("psql"):
        db_url = db_url[4:].strip()

    db_url = db_url.strip("'").strip('"')

    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

    db_url = db_url.replace("&channel_binding=require", "")

    if "sslmode=" not in db_url:
        joiner = "&" if "?" in db_url else "?"
        db_url += f"{joiner}sslmode=require"

    return db_url


def get_engine():
    db_url = clean_db_url(os.getenv("DATABASE_URL"))
    return create_engine(db_url, pool_pre_ping=True)


def get_db():
    engine = get_engine()
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# =========================
# AUTH
# =========================
SECRET_KEY = os.getenv("JWT_SECRET", "CHANGE_ME")
ALGORITHM = "HS256"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


# =========================
# ROOT
# =========================
@app.get("/")
def root():
    return {"ok": True, "msg": "Hello from Vercel FastAPI"}


# =========================
# TEST DB
# =========================
@app.get("/test-db")
def test_db():
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"ok": True, "db": "connected"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# =========================
# LOGIN JSON (أسهل من form)
# =========================
@app.post("/login-json")
def login_json(data: dict):
    username = data.get("username")
    password = data.get("password")

    if username != os.getenv("ADMIN_USERNAME"):
        raise HTTPException(status_code=401, detail="Invalid username")

    if password != os.getenv("ADMIN_PASSWORD"):
        raise HTTPException(status_code=401, detail="Invalid password")

    expire = datetime.utcnow() + timedelta(hours=24)
    token = jwt.encode(
        {"sub": username, "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )

    return {"access_token": token, "token_type": "bearer"}


# =========================
# PROTECTED ROUTE
# =========================
@app.get("/me")
def me(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return {"user": payload["sub"]}
    except:
        raise HTTPException(status_code=401, detail="Invalid token")
