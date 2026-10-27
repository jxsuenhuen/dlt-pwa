"""Fetch structured draw records; never scrape unrelated HTML numbers."""
import json
import re
import time
import urllib.request
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
API = ('https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry'
       '?gameNo=85&provinceId=0&pageSize=100&isVerify=1&pageNo={}')


def validate(row, require_date=False):
    if not isinstance(row, dict):
        raise ValueError('Draw must be an object')
    issue = str(row.get('issue', ''))
    today = datetime.now(ZoneInfo('Asia/Shanghai')).date()
    if not re.fullmatch(r'\d{5}', issue):
        raise ValueError(f'Invalid issue: {issue}')
    year, sequence = 2000 + int(issue[:2]), int(issue[2:])
    if not 2007 <= year <= today.year or not 1 <= sequence <= 200:
        raise ValueError(f'Implausible issue: {issue}')
    result = {'issue': issue, 'date': row.get('date', '')}
    for key, count, maximum in [('front', 5, 35), ('back', 2, 12)]:
        numbers = row.get(key)
        if (not isinstance(numbers, list) or len(numbers) != count
                or len(set(numbers)) != count
                or any(type(n) is not int or not 1 <= n <= maximum for n in numbers)):
            raise ValueError(f'Invalid {key}: {issue}')
        result[key] = sorted(numbers)
    if result['date']:
        drawn = date.fromisoformat(result['date'])
        if drawn > today or drawn.year != year:
            raise ValueError(f'Invalid draw date: {issue}')
    elif require_date:
        raise ValueError(f'Missing draw date: {issue}')
    if row.get('source'):
        result['source'] = str(row['source'])
    return result


def fetch_page(page):
    for attempt in range(3):
        try:
            request = urllib.request.Request(API.format(page), headers={
                'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json',
                'Referer': 'https://www.sporttery.cn/'})
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
            value = payload.get('value')
            rows = value.get('list') if isinstance(value, dict) else None
            if not isinstance(rows, list) or not rows:
                raise ValueError('Official API returned no draw list')
            parsed = []
            for row in rows:
                issue = str(row['lotteryDrawNum'])
                if re.fullmatch(r'20\d{5}', issue):
                    issue = issue[2:]
                raw_date = str(row['lotteryDrawTime'])
                if not re.match(r'^\d{4}-\d{2}-\d{2}(?:$|[ T])', raw_date):
                    raise ValueError('Unexpected API date format')
                tokens = str(row['lotteryDrawResult']).split()
                if len(tokens) != 7 or any(not token.isdigit() for token in tokens):
                    raise ValueError('Unexpected API number format')
                numbers = list(map(int, tokens))
                parsed.append(validate({'issue': issue, 'date': raw_date[:10],
                                        'front': numbers[:5], 'back': numbers[5:],
                                        'source': '中国体彩接口'}, True))
            if len({r['issue'] for r in parsed}) != len(parsed):
                raise ValueError('Duplicate API issues')
            return sorted(parsed, key=lambda r: r['issue'], reverse=True)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


# Public third-party mirrors are independent publishers, not official sources.
MIRRORS = (
    'https://raw.githubusercontent.com/yangxb919/lottery-data/main/data/dlt.json',
    'https://raw.githubusercontent.com/gudaoxuri/lottery_history/main/data/dlt.json',
)


def fallback_records(baseline):
    datasets = []
    for index, url in enumerate(MIRRORS):
        request = urllib.request.Request(url, headers={'User-Agent': 'dlt-pwa-update/1.0', 'Accept': 'application/json'})
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = json.load(response)
        if not isinstance(raw, list) or not raw:
            raise ValueError('Third-party mirror returned no records')
        records = {}
        for item in raw:
            if index == 0:
                record = {'issue': str(item['issue']), 'date': item['date'],
                          'front': list(map(int, item['front'])), 'back': list(map(int, item['back']))}
            else:
                record = {'issue': str(item['issueNumber']), 'date': item['drawDate'],
                          'front': list(map(int, item['frontBalls'])), 'back': list(map(int, item['backBalls']))}
            row = validate(record, True)
            if row['issue'] in records:
                raise ValueError('Duplicate mirror issue')
            records[row['issue']] = row
        datasets.append(records)
    left, right = datasets
    # Both sources must agree on the newest issue and every new issue.
    if max(left) != max(right) or baseline not in left or baseline not in right:
        raise ValueError('Third-party mirrors are out of sync or lack baseline')
    agreed = {}
    for issue in sorted(set(left) | set(right)):
        if issue < baseline:
            continue
        if issue not in left or issue not in right or left[issue] != right[issue]:
            raise ValueError(f'Third-party mirrors disagree on issue {issue}')
        agreed[issue] = {**left[issue], 'source': '第三方数据交叉核对（非官方）'}
    if not agreed:
        raise ValueError('No mutually verified records')
    return agreed


def main():
    history_path = ROOT / 'history.json'
    history = json.loads(history_path.read_text(encoding='utf-8'))
    if not isinstance(history, list) or not history:
        raise ValueError('Nonempty history baseline required')
    existing = [validate(row) for row in history]
    merged = {row['issue']: row for row in existing}
    if len(merged) != len(existing):
        raise ValueError('Duplicate baseline issues')
    baseline = max(merged)
    received = {}
    try:
        for page in range(1, 101):
            rows = fetch_page(page)
            for row in rows:
                previous = received.get(row['issue'])
                if previous is not None and previous != row:
                    raise ValueError('API changed during pagination; retry later')
                received[row['issue']] = row
            if baseline in received:
                break
            if rows[-1]['issue'] < baseline:
                raise ValueError('API does not overlap baseline; refusing gaps or rollback')
        else:
            raise ValueError('Pagination limit reached without baseline')
        if max(received) < baseline:
            raise ValueError('Refusing stale upstream response')
    except Exception as exc:
        print(f'Official API unavailable or invalid: {exc}; checking two third-party mirrors')
        received = fallback_records(baseline)
    # Preserve archived records; official API replaces matching issues, including dates.
    merged.update(received)
    ordered = sorted(merged.values(), key=lambda row: row['issue'], reverse=True)
    latest = ordered[0]
    validate(latest, True)
    outputs = {'history.json': ordered, 'data/latest.json': latest, 'latest.json': latest}
    # All validation completes before any destination is replaced. Git commits all three.
    for name, value in outputs.items():
        target = ROOT / name
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(target)
    print(f'Validated {len(received)} API draws; latest={latest["issue"]} {latest["date"]}')


if __name__ == '__main__':
    main()
