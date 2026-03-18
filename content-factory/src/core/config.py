from pydantic_settings import BaseSettings
from passlib.context import CryptContext
import warnings

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://ipuser:ippassword@localhost:5432/influence_platform"
    REDIS_URL: str = "redis://localhost:6379"
    CLAUDE_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = "default_key_override_in_env_file"
    CLAUDE_MODEL: str = "claude-3-haiku-20240307"
    DALLE_API_KEY: str = ""
    OPENAI_API_KEY: str = "default_key_override_in_env_file"
    JWT_SECRET: str = "changeme"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440  # 24h
    ENVIRONMENT: str = "development"
    CONTENT_QUEUE_NAME: str = "content:ready"
    
    # Admin credentials - MUST be set in production
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin"
    
    # Enable/disable admin fallback (disable in production)
    ADMIN_FALLBACK_ENABLED: bool = True
    
    # CORS — comma-separated list of allowed origins
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    class Config:
        env_file = ".env"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._validate_security()

    def _validate_security(self):
        """Validate security settings and warn about insecure defaults."""
        insecure_defaults = []
        missing_required = []
        
        # Check for default JWT secret
        if self.JWT_SECRET == "changeme" or len(self.JWT_SECRET) < 32:
            insecure_defaults.append("JWT_SECRET must be at least 32 characters")
        
        # Check for default admin credentials
        if self.ADMIN_PASSWORD == "admin":
            insecure_defaults.append("ADMIN_PASSWORD is using default 'admin'")
        
        # Validate ADMIN_PASSWORD minimum length
        if len(self.ADMIN_PASSWORD) < 8:
            insecure_defaults.append("ADMIN_PASSWORD must be at least 8 characters")
        
        # Check required API keys for production
        if self.ENVIRONMENT == "production":
            if not self.CLAUDE_API_KEY or self.CLAUDE_API_KEY.startswith("sk-"):
                missing_required.append("CLAUDE_API_KEY must be set")
            
            if not self.ALLOWED_ORIGINS or self.ALLOWED_ORIGINS == "http://localhost:3000":
                missing_required.append("ALLOWED_ORIGINS must be configured for production")
        
        if self.ENVIRONMENT == "production":
            if insecure_defaults:
                raise ValueError(f"Production security violations: {', '.join(insecure_defaults)}")
            if missing_required:
                raise ValueError(f"Production required fields: {', '.join(missing_required)}")
            if not self.ADMIN_FALLBACK_ENABLED:
                raise ValueError("ADMIN_FALLBACK_ENABLED must be True in production for initial setup")
        elif insecure_defaults:
            warnings.warn(f"Insecure configuration detected: {', '.join(insecure_defaults)}")


settings = Settings()

# Pre-compute the bcrypt hash once at startup for login verification
# bcrypt has a 72-byte limit — safely truncate bytes
safe_pwd = settings.ADMIN_PASSWORD.encode("utf-8", "ignore")[:72].decode("utf-8", "ignore")
ADMIN_PASSWORD_HASH = _pwd_context.hash(safe_pwd)
