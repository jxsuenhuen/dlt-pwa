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
    issue = re.search(
        r'期号.*?(\d{5})',
        html
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

    return {

        "issue":
            issue.group(1)
            if issue else "未知",

        "front":
            nums[:5],

        "back":
            nums[5:7],

        "date":
            datetime.now()
            .strftime("%Y-%m-%d"),

        "source":
            "江苏体彩"

    }


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
