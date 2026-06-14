# Import all models here so SQLAlchemy Base knows about them
from app.models.user import (  # noqa: F401
    User,
    Portfolio,
    Position,
    AssetClassification,
    PriceCache,
    HoldingsCache,
    RefreshJob,
)
