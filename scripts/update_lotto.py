import json
import re
import urllib.request
from pathlib import Path
from datetime import datetime


URL = "https://www.js-lottery.com/wfzq/dlt"


def get_lotto():

    headers = {
        "User-Agent": "Mozilla/5.0"
    }

    req = urllib.request.Request(
        URL,
        headers=headers
    )

    html = urllib.request.urlopen(req).read().decode(
        "utf-8",
        errors="ignore"
    )


    # 获取期号
    issue_match = re.search(
        r'(\d{5})',
        html
    )

    issue = (
        issue_match.group(1)
        if issue_match
        else "未知"
    )


    # 获取号码
    nums = re.findall(
        r'>\s*(\d{1,2})\s*<',
        html
    )

    nums = [
        int(x)
        for x in nums
    ]


    if len(nums) < 7:
        raise Exception(
            "号码获取失败"
        )


    "issue":
    datetime.now().strftime("%y%m%d"),


data = get_lotto()


Path(
    "data/latest.json"
).write_text(

    json.dumps(
        data,
        ensure_ascii=False,
        indent=2
    ),

    encoding="utf-8"

)


print(data)
