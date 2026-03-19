from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from src.models.organization import Organization
from src.models.billing import Subscription
import logging

logger = logging.getLogger(__name__)


class SaaSMetrics:
    """Track and calculate SaaS business metrics."""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def calculate_mrr(self) -> dict:
        """Calculate Monthly Recurring Revenue."""
        result = await self.db.execute(
            select(
                Organization.plan,
                func.count(Organization.id).label('count')
            ).where(
                Organization.status == 'active',
                Organization.plan.in_(['starter', 'growth', 'scale'])
            ).group_by(Organization.plan)
        )
        
        plan_prices = {
            'starter': 4900,
            'growth': 14900,
            'scale': 49900,
        }
        
        total_mrr = 0
        by_plan = {}
        
        for row in result:
            plan = row.plan
            count = row.count
            price = plan_prices.get(plan, 0)
            plan_mrr = (price * count) / 100
            by_plan[plan] = {
                'count': count,
                'price_cents': price,
                'mrr': plan_mrr
            }
            total_mrr += plan_mrr
        
        return {
            'total_mrr': total_mrr,
            'by_plan': by_plan,
            'currency': 'USD',
            'calculated_at': datetime.utcnow().isoformat()
        }
    
    async def calculate_arr(self) -> dict:
        """Calculate Annual Recurring Revenue."""
        mrr_data = await self.calculate_mrr()
        return {
            'total_arr': mrr_data['total_mrr'] * 12,
            'currency': 'USD',
            'calculated_at': datetime.utcnow().isoformat()
        }
    
    async def get_active_subscribers(self) -> int:
        """Get count of active subscribers (non-free plans)."""
        result = await self.db.execute(
            select(func.count(Organization.id)).where(
                Organization.status == 'active',
                Organization.plan != 'free'
            )
        )
        return result.scalar() or 0
    
    async def get_trial_count(self) -> int:
        """Get count of users on trial."""
        result = await self.db.execute(
            select(func.count(Organization.id)).where(
                Organization.status == 'trial',
                Organization.trial_ends_at > datetime.utcnow()
            )
        )
        return result.scalar() or 0
    
    async def get_churn_rate(self, days: int = 30) -> float:
        """Calculate churn rate for the given period."""
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        
        cancelled_result = await self.db.execute(
            select(func.count(Organization.id)).where(
                Organization.status == 'cancelled',
                Organization.updated_at >= cutoff_date
            )
        )
        cancelled = cancelled_result.scalar() or 0
        
        total_result = await self.db.execute(
            select(func.count(Organization.id)).where(
                Organization.created_at < cutoff_date
            )
        )
        total = total_result.scalar() or 1
        
        return round((cancelled / total) * 100, 2)
    
    async def get_usage_stats(self) -> dict:
        """Get platform-wide usage statistics."""
        from src.models.billing import UsageRecord
        
        now = datetime.utcnow()
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        
        result = await self.db.execute(
            select(
                UsageRecord.resource_type,
                func.sum(UsageRecord.count).label('total')
            ).where(
                UsageRecord.period_start >= period_start
            ).group_by(UsageRecord.resource_type)
        )
        
        usage = {}
        for row in result:
            usage[row.resource_type] = row.total or 0
        
        return {
            'total_posts_this_month': usage.get('post', 0),
            'total_accounts': usage.get('account', 0),
            'period_start': period_start.isoformat(),
            'calculated_at': now.isoformat()
        }
    
    async def get_dashboard_summary(self) -> dict:
        """Get complete dashboard summary."""
        return {
            'mrr': await self.calculate_mrr(),
            'arr': await self.calculate_arr(),
            'active_subscribers': await self.get_active_subscribers(),
            'trials': await self.get_trial_count(),
            'churn_rate_30d': await self.get_churn_rate(),
            'usage': await self.get_usage_stats(),
        }
