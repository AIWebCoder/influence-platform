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
from src.models.alert import Alert
from src.models.user import User


async def verify_migrations():
    """Verify that all required tables exist in the database."""
    required_tables = [
        'niches', 'templates', 'content_packets',
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
        # Verify migrations/tables exist
        await verify_migrations()
    logger.info("✅ Database initialized and verified")


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
