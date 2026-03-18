from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import datetime, timedelta
from io import BytesIO
import json

from src.core.database import get_db
from src.core.security import get_current_user

router = APIRouter()


@router.get("/weekly")
async def generate_weekly_report(
    format: str = "json",
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Generate a weekly report in JSON, PDF, or Excel format."""
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=7)

    # Fetch metrics
    publications_result = await db.execute(
        text("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'published') as published,
                COUNT(*) FILTER (WHERE status = 'failed') as failed
            FROM publications 
            WHERE created_at >= :start AND created_at < :end
        """),
        {"start": start_date, "end": end_date},
    )
    pub_row = publications_result.fetchone()

    content_result = await db.execute(
        text("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'approved') as approved,
                COUNT(*) FILTER (WHERE status = 'draft') as drafts
            FROM content_packets 
            WHERE created_at >= :start AND created_at < :end
        """),
        {"start": start_date, "end": end_date},
    )
    content_row = content_result.fetchone()

    accounts_result = await db.execute(
        text("SELECT COUNT(*) as total FROM accounts WHERE status = 'active'")
    )
    accounts_row = accounts_result.fetchone()

    report_data = {
        "period": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
        },
        "publications": {
            "total": pub_row.total if pub_row else 0,
            "published": pub_row.published if pub_row else 0,
            "failed": pub_row.failed if pub_row else 0,
        },
        "content": {
            "total": content_row.total if content_row else 0,
            "approved": content_row.approved if content_row else 0,
            "drafts": content_row.drafts if content_row else 0,
        },
        "accounts": {
            "active": accounts_row.total if accounts_row else 0,
        },
        "generated_at": datetime.utcnow().isoformat(),
    }

    if format == "json":
        return report_data

    if format == "pdf":
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
            from reportlab.lib.styles import getSampleStyleSheet
            from reportlab.lib import colors

            buffer = BytesIO()
            doc = SimpleDocTemplate(buffer, pagesize=A4)
            styles = getSampleStyleSheet()
            elements = []

            elements.append(Paragraph("Influence Platform — Weekly Report", styles["Title"]))
            elements.append(Spacer(1, 12))
            elements.append(Paragraph(f"Period: {start_date.strftime('%Y-%m-%d')} → {end_date.strftime('%Y-%m-%d')}", styles["Normal"]))
            elements.append(Spacer(1, 24))

            data = [
                ["Metric", "Value"],
                ["Publications — Total", str(report_data["publications"]["total"])],
                ["Publications — Published", str(report_data["publications"]["published"])],
                ["Publications — Failed", str(report_data["publications"]["failed"])],
                ["Content — Total", str(report_data["content"]["total"])],
                ["Content — Approved", str(report_data["content"]["approved"])],
                ["Content — Drafts", str(report_data["content"]["drafts"])],
                ["Active Accounts", str(report_data["accounts"]["active"])],
            ]

            table = Table(data)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#6366f1")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 1, colors.HexColor("#e5e7eb")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
            ]))
            elements.append(table)
            doc.build(elements)

            return Response(
                content=buffer.getvalue(),
                media_type="application/pdf",
                headers={"Content-Disposition": "attachment; filename=weekly_report.pdf"},
            )
        except ImportError:
            raise HTTPException(status_code=500, detail="reportlab not installed. Run: pip install reportlab")

    if format == "excel":
        try:
            from openpyxl import Workbook

            wb = Workbook()
            ws = wb.active
            ws.title = "Weekly Report"

            ws.append(["Influence Platform — Weekly Report"])
            ws.append([f"Period: {start_date.strftime('%Y-%m-%d')} → {end_date.strftime('%Y-%m-%d')}"])
            ws.append([])
            ws.append(["Metric", "Value"])
            ws.append(["Publications — Total", report_data["publications"]["total"]])
            ws.append(["Publications — Published", report_data["publications"]["published"]])
            ws.append(["Publications — Failed", report_data["publications"]["failed"]])
            ws.append(["Content — Total", report_data["content"]["total"]])
            ws.append(["Content — Approved", report_data["content"]["approved"]])
            ws.append(["Content — Drafts", report_data["content"]["drafts"]])
            ws.append(["Active Accounts", report_data["accounts"]["active"]])

            buffer = BytesIO()
            wb.save(buffer)

            return Response(
                content=buffer.getvalue(),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": "attachment; filename=weekly_report.xlsx"},
            )
        except ImportError:
            raise HTTPException(status_code=500, detail="openpyxl not installed. Run: pip install openpyxl")

    raise HTTPException(status_code=400, detail="Format must be json, pdf, or excel")
