from functools import wraps
from fastapi import HTTPException, status, Depends
from typing import List, Callable

# Role hierarchy: higher roles inherit permissions of lower roles
ROLE_HIERARCHY = {
    "admin": ["admin", "operator", "viewer"],
    "operator": ["operator", "viewer"],
    "viewer": ["viewer"],
}

# Permission definitions
PERMISSIONS = {
    # User management
    "users:read": ["admin", "operator"],
    "users:write": ["admin"],
    "users:delete": ["admin"],
    
    # Account management
    "accounts:read": ["admin", "operator", "viewer"],
    "accounts:write": ["admin", "operator"],
    "accounts:delete": ["admin"],
    "accounts:add": ["admin", "operator"],
    
    # Content management
    "content:read": ["admin", "operator", "viewer"],
    "content:write": ["admin", "operator"],
    "content:delete": ["admin"],
    "content:generate": ["admin", "operator"],
    
    # Templates
    "templates:read": ["admin", "operator", "viewer"],
    "templates:write": ["admin", "operator"],
    "templates:delete": ["admin"],
    
    # Publishing
    "publishing:read": ["admin", "operator", "viewer"],
    "publishing:write": ["admin", "operator"],
    
    # Analytics
    "analytics:read": ["admin", "operator", "viewer"],
    "analytics:export": ["admin"],
    
    # Alerts
    "alerts:read": ["admin", "operator"],
    "alerts:write": ["admin"],
    "alerts:delete": ["admin"],
    
    # Settings
    "settings:read": ["admin"],
    "settings:write": ["admin"],
    
    # System
    "system:health": ["admin", "operator", "viewer"],
    "system:logs": ["admin"],
}


def get_role_permissions(role: str) -> List[str]:
    """Get all permissions for a role based on hierarchy."""
    allowed_roles = ROLE_HIERARCHY.get(role, [])
    permissions = set()
    for r in allowed_roles:
        for perm, roles in PERMISSIONS.items():
            if r in roles:
                permissions.add(perm)
    return list(permissions)


def has_permission(role: str, permission: str) -> bool:
    """Check if a role has a specific permission."""
    return permission in get_role_permissions(role)


def require_permission(permission: str):
    """Decorator to require a specific permission."""
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Get current user from kwargs or context
            current_user = kwargs.get('current_user')
            if not current_user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication required"
                )
            
            user_role = current_user.get('role', 'viewer')
            
            if not has_permission(user_role, permission):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Permission denied: {permission} required"
                )
            
            return await func(*args, **kwargs)
        return wrapper
    return decorator


def require_roles(*allowed_roles: str):
    """Decorator to require specific roles."""
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            current_user = kwargs.get('current_user')
            if not current_user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication required"
                )
            
            user_role = current_user.get('role', 'viewer')
            
            if user_role not in allowed_roles:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Role '{user_role}' not authorized for this action"
                )
            
            return await func(*args, **kwargs)
        return wrapper
    return decorator


class AccessControl:
    """Main access control class for checking permissions."""
    
    @staticmethod
    def can(user_role: str, permission: str) -> bool:
        return has_permission(user_role, permission)
    
    @staticmethod
    def get_permissions(user_role: str) -> List[str]:
        return get_role_permissions(user_role)
    
    @staticmethod
    def is_admin(user_role: str) -> bool:
        return user_role == "admin"
    
    @staticmethod
    def is_operator(user_role: str) -> bool:
        return user_role in ["admin", "operator"]
    
    @staticmethod
    def get_role_hierarchy() -> dict:
        return ROLE_HIERARCHY
    
    @staticmethod
    def get_all_permissions() -> dict:
        return PERMISSIONS
