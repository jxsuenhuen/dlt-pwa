"""Audit the historical DLT archive without changing production data."""
import json
import re
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "history.json"
REPORT = ROOT / "research" / "history-audit.json"


def audit(rows):
    issues = Counter()
    invalid = []
    missing_dates = []
    missing_sources = []
    year_counts = Counter()
    dates_out_of_order = []
    previous_date = None

    for index, row in enumerate(rows):
        issue = str(row.get("issue", ""))
        if not re.fullmatch(r"\d{5}", issue):
            invalid.append({"index": index, "issue": issue, "reason": "期号格式错误"})
            continue
        issues[issue] += 1
        year_counts[issue[:2]] += 1

        front, back = row.get("front"), row.get("back")
        if (not isinstance(front, list) or len(front) != 5
                or len(set(front)) != 5
                or any(type(n) is not int or not 1 <= n <= 35 for n in front)):
            invalid.append({"issue": issue, "reason": "前区号码无效"})
        if (not isinstance(back, list) or len(back) != 2
                or len(set(back)) != 2
                or any(type(n) is not int or not 1 <= n <= 12 for n in back)):
            invalid.append({"issue": issue, "reason": "后区号码无效"})

        raw_date = row.get("date")
        if not raw_date:
            missing_dates.append(issue)
        else:
            try:
                parsed = date.fromisoformat(raw_date)
                expected_year = 2000 + int(issue[:2])
                if parsed.year != expected_year:
                    invalid.append({"issue": issue, "reason": "开奖日期年份与期号年份不一致"})
                if previous_date and parsed > previous_date:
                    dates_out_of_order.append(issue)
                previous_date = parsed
            except (TypeError, ValueError):
                invalid.append({"issue": issue, "reason": "开奖日期格式无效"})

        if not row.get("source"):
            missing_sources.append(issue)

    duplicates = sorted(issue for issue, count in issues.items() if count > 1)
    # Annual issue numbering restarts; assess sequence gaps only within each two-digit year.
    ordered = sorted(issues)
    gaps = []
    for left, right in zip(ordered, ordered[1:]):
        if left[:2] == right[:2] and int(right[2:]) - int(left[2:]) > 1:
            gaps.append({"from": left, "to": right,
                         "missing_issue_count": int(right[2:]) - int(left[2:]) - 1})

    return {
        "record_count": len(rows),
        "unique_issue_count": len(issues),
        "duplicate_issues": duplicates,
        "invalid_records": invalid,
        "missing_date_count": len(missing_dates),
        "missing_date_issues": missing_dates,
        "missing_source_count": len(missing_sources),
        "missing_source_issues": missing_sources,
        "same_year_sequence_gaps": gaps,
        "dates_out_of_order": dates_out_of_order,
        "records_by_issue_year": dict(sorted(year_counts.items())),
        "training_policy": (
            "Do not silently infer missing dates or provenance. "
            "Only source-verified records should be eligible for date-based model training."
        ),
    }


def main():
    rows = json.loads(SOURCE.read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise ValueError("history.json must contain a list")
    report = audit(rows)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                      encoding="utf-8")
    print(json.dumps({key: report[key] for key in (
        "record_count", "unique_issue_count", "duplicate_issues",
        "missing_date_count", "missing_source_count",
        "same_year_sequence_gaps", "invalid_records"
    )}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
