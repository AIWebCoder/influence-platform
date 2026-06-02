from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text
from sqlalchemy.orm import DeclarativeBase
from src.core.config import settings
import logging
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)


engine = create_async_engine(
    settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://"),
    echo=settings.ENVIRONMENT == "development",
    pool_size=10,
    max_overflow=5,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


# Import models so they are registered with Base metadata
from src.models.content import Niche, Template, ContentPacket
from src.models.generation_job import GenerationJob, GenerationStep, GenerationScene
from src.models.alert import Alert
from src.models.user import User


async def verify_migrations():
    """Verify that all required tables exist in the database."""
    required_tables = [
        'niches', 'templates', 'content_packets',
        'generation_jobs', 'generation_steps', 'generation_scenes',
        'accounts', 'proxies', 'publications',
        'alerts', 'users', 'analytics_events'
    ]
    
    async with engine.connect() as conn:
        # Get list of existing tables
        result = await conn.execute(text("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        """))
        existing_tables = {row[0] for row in result.fetchall()}
        
        missing_tables = [t for t in required_tables if t not in existing_tables]
        
        if missing_tables:
            logger.warning(f"Missing tables detected: {missing_tables}")
            logger.warning("Run migrations or ensure init.sql was executed")
            
            # In production, this should fail the startup
            if settings.ENVIRONMENT == "production":
                raise RuntimeError(
                    f"Database migration error: missing tables: {', '.join(missing_tables)}"
                )
        
        logger.info(f"Database tables verified: {len(existing_tables)} tables found")


async def init_db():
    async with engine.begin() as conn:
        from src.core.content_schema import ensure_content_schema

        await ensure_content_schema(conn)
        # Verify migrations/tables exist
        await verify_migrations()
    await seed_first_admin()
    logger.info("✅ Database initialized and verified")


async def ensure_default_organization(session) -> None:
    """Ensure the default organization row exists (matches infra/V028)."""
    from sqlalchemy import text

    slug = (settings.DEFAULT_ORGANIZATION_SLUG or "influence").strip()
    await session.execute(
        text(
            """
            INSERT INTO organizations (id, name, slug, plan, status, is_active, max_accounts, max_users)
            VALUES (
                '00000000-0000-4000-8000-000000000001'::uuid,
                'Influence Platform',
                :slug,
                'scale',
                'active',
                true,
                500,
                50
            )
            ON CONFLICT (slug) DO NOTHING
            """
        ),
        {"slug": slug},
    )


async def seed_first_admin():
    """Insert a single bootstrap admin into `users` if no admin row exists.

    Uses ``ADMIN_EMAIL`` + ``ADMIN_PASSWORD`` from settings. Runs once at startup so the
    operator workflow can remove the legacy env-var login fallback without locking us out.
    """
    from sqlalchemy import select, func
    from src.core.access_scope import DEFAULT_ORGANIZATION_ID
    from src.models.user import User
    from src.core.security import hash_password

    async with AsyncSessionLocal() as session:
        await ensure_default_organization(session)
        admin_count = await session.execute(
            select(func.count(User.id)).where(User.role == "admin")
        )
        if (admin_count.scalar() or 0) > 0:
            return

        email = (settings.ADMIN_EMAIL or "").strip().lower()
        if not email:
            # Fall back to ADMIN_USERNAME when it already looks like an email; otherwise synthesize one
            legacy = (settings.ADMIN_USERNAME or "admin").strip().lower()
            email = legacy if "@" in legacy else f"{legacy}@influence.local"
        password = settings.ADMIN_PASSWORD or ""
        if not email or not password:
            logger.warning("Skipping admin seed: ADMIN_EMAIL/ADMIN_USERNAME or ADMIN_PASSWORD is empty.")
            return

        # bcrypt's 72-byte limit — match the historical hash policy
        safe_pwd = password.encode("utf-8", "ignore")[:72].decode("utf-8", "ignore")

        existing = await session.execute(select(User).where(User.email == email))
        existing_user = existing.scalar_one_or_none()
        if existing_user:
            changed = False
            if existing_user.role != "admin":
                existing_user.role = "admin"
                changed = True
            if not existing_user.is_active:
                existing_user.is_active = True
                changed = True
            if existing_user.organization_id is None:
                existing_user.organization_id = DEFAULT_ORGANIZATION_ID
                changed = True
            if changed:
                await session.commit()
                logger.warning("Updated bootstrap user '%s' during startup.", email)
            return

        admin = User(
            email=email,
            hashed_password=hash_password(safe_pwd),
            role="admin",
            is_active=True,
            organization_id=DEFAULT_ORGANIZATION_ID,
        )
        session.add(admin)
        await session.commit()
        logger.warning(
            "Seeded bootstrap admin '%s'. Change this password immediately via the dashboard.",
            email,
        )


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
