from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Boolean, ForeignKey, func, text
from sqlalchemy.orm import sessionmaker, declarative_base, Session, relationship
from sqlalchemy.exc import IntegrityError
import os
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

import hashlib
import hmac
import secrets
import base64
import jwt  # PyJWT


app = FastAPI()


# ====== DB URL CLEANER ======
def clean_db_url(raw: str) -> str:
    db_url = (raw or "").strip()
    if not db_url:
        raise ValueError("DATABASE_URL not set")

    # remove 'psql' prefix if pasted
    if db_url.lower().startswith("psql"):
        db_url = db_url[4:].strip()

    # strip surrounding quotes repeatedly
    while db_url and db_url[0] in ["'", '"']:
        db_url = db_url[1:]
    while db_url and db_url[-1] in ["'", '"']:
        db_url = db_url[:-1]
    db_url = db_url.strip()

    # psycopg3 scheme
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
    elif db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)

    # remove channel_binding
    db_url = db_url.replace("&channel_binding=require", "")
    db_url = db_url.replace("?channel_binding=require", "")

    # ensure sslmode=require
    if "sslmode=" not in db_url:
        joiner = "&" if "?" in db_url else "?"
        db_url = db_url + (joiner + "sslmode=require")

    return db_url


DATABASE_URL = clean_db_url(os.getenv("DATABASE_URL", ""))

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ====== JWT Auth ======
SECRET_KEY = os.getenv("JWT_SECRET", "CHANGE_ME_NOW")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24h

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ====== Password Hash (PBKDF2, pure python) ======
# format: pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64>
def hash_password(password: str, iterations: int = 200_000) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "pbkdf2_sha256$%d$%s$%s" % (
        iterations,
        base64.urlsafe_b64encode(salt).decode("utf-8").rstrip("="),
        base64.urlsafe_b64encode(dk).decode("utf-8").rstrip("="),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_b64, hash_b64 = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iterations = int(iters)

        salt = base64.urlsafe_b64decode(salt_b64 + "==")
        expected = base64.urlsafe_b64decode(hash_b64 + "==")

        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = dict(data)
    expire = datetime.utcnow() + (expires_delta if expires_delta else timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Dict[str, Any]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ====== Models ======
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, index=True, nullable=False)
    full_name = Column(String(128), nullable=True)
    role = Column(String(32), nullable=False, default="agent")  # admin/manager/agent
    password_hash = Column(String(512), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Lead(Base):
    __tablename__ = "leads"
    id = Column(Integer, primary_key=True, index=True)
    phone_digits = Column(String(32), unique=True, index=True, nullable=False)
    phone_e164 = Column(String(32), nullable=False)
    name = Column(String(128), nullable=True)
    source = Column(String(64), default="Calculator")
    stage = Column(String(64), default="Lead جديد")
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    last_activity_at = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    owner = relationship("User")
    snapshots = relationship("CalculatorSnapshot", back_populates="lead")


class CalculatorSnapshot(Base):
    __tablename__ = "calculator_snapshots"
    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False)

    ts = Column(String(64), nullable=True)
    salary = Column(Integer, nullable=True)
    age = Column(Integer, nullable=True)
    commitments = Column(Integer, nullable=True)
    sector = Column(String(64), nullable=True)
    nationality = Column(String(64), nullable=True)

    car_name = Column(String(255), nullable=True)
    car_price = Column(Integer, nullable=True)
    term_years = Column(Integer, nullable=True)
    down_payment = Column(Integer, nullable=True)
    final_payment = Column(Integer, nullable=True)

    total_finance = Column(Integer, nullable=True)
    total_profit = Column(Integer, nullable=True)
    total_insurance = Column(Integer, nullable=True)
    admin_fees = Column(Integer, nullable=True)

    monthly_installment = Column(Integer, nullable=True)
    max_deduction = Column(Integer, nullable=True)
    installment_plus_commitments = Column(Integer, nullable=True)

    approved_bool = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="snapshots")


# ====== Auth helpers ======
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    payload = decode_token(token)
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user = db.query(User).filter(User.username == username).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def require_role(*roles):
    def _guard(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
    return _guard


def seed_admin_if_empty(db: Session) -> None:
    if db.query(User).count() > 0:
        return

    admin_username = (os.getenv("ADMIN_USERNAME") or "admin").strip().lower()
    admin_password = os.getenv("ADMIN_PASSWORD") or ""
    if not admin_password:
        return

    admin = User(
        username=admin_username,
        full_name="System Admin",
        role="admin",
        password_hash=hash_password(admin_password),
        is_active=True,
    )
    db.add(admin)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()


# ====== Startup ======
@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_admin_if_empty(db)
    finally:
        db.close()


# ====== Routes ======
@app.get("/")
def root():
    return {"status": "CRM API Running"}


@app.get("/test-db")
def test_db():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"ok": True, "db_status": "connected"}


@app.get("/__debug")
def __debug():
    return {
        "ok": True,
        "has_db": bool(os.getenv("DATABASE_URL")),
        "has_jwt_secret": bool(os.getenv("JWT_SECRET")),
        "has_admin_user": bool(os.getenv("ADMIN_USERNAME")),
        "has_admin_pass": bool(os.getenv("ADMIN_PASSWORD")),
    }


@app.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    username = (form_data.username or "").strip().lower()
    password = form_data.password or ""

    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect username or password")

    token = create_access_token({"sub": user.username, "role": user.role})
    return {"access_token": token, "token_type": "bearer", "role": user.role, "username": user.username}


@app.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "username": user.username, "full_name": user.full_name, "role": user.role}


@app.get("/leads")
def list_leads(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(Lead)
    if user.role == "agent":
        q = q.filter(Lead.owner_id == user.id)

    leads = q.order_by(Lead.last_activity_at.desc()).limit(200).all()
    return [{
        "id": l.id,
        "phone": l.phone_e164,
        "name": l.name,
        "stage": l.stage,
        "owner_id": l.owner_id,
        "last_activity_at": l.last_activity_at,
        "created_at": l.created_at
    } for l in leads]


@app.post("/admin/users")
def admin_create_user(
    username: str,
    password: str,
    full_name: Optional[str] = None,
    role: str = "agent",
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    if role not in ["admin", "manager", "agent"]:
        raise HTTPException(status_code=400, detail="Invalid role")

    u = User(
        username=username.strip().lower(),
        full_name=full_name,
        role=role,
        password_hash=hash_password(password),
    )
    db.add(u)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already exists")

    return {"ok": True, "user_id": u.id, "username": u.username, "role": u.role}
