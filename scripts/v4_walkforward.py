"""Reproducible walk-forward benchmark for personal DLT V4 research.

This is an experiment, not a claim of predictive advantage. It uses issue order
because most legacy records have no verified date. All predictions for a draw
use strictly earlier records. Strategies and windows are fixed in advance.
"""
import argparse
import json
import random
from collections import Counter
from pathlib import Path

FRONT_MAX, BACK_MAX = 35, 12
FRONT_PICK, BACK_PICK = 5, 2
WINDOWS = (30, 60, 120, 300)
RANDOM_RUNS = 300
SEED = 20261128


def weighted_sample_without_replacement(weights, count, rng):
    pool = list(range(1, len(weights)))
    selected = []
    for _ in range(count):
        total = sum(weights[n] for n in pool)
        needle = rng.random() * total
        cumulative = 0.0
        chosen = pool[-1]
        for n in pool:
            cumulative += weights[n]
            if cumulative >= needle:
                chosen = n
                break
        selected.append(chosen)
        pool.remove(chosen)
    return sorted(selected)


def score(draws, window, field, max_number, count, rng):
    recent = draws[-window:]
    frequencies = Counter(n for draw in recent for n in draw[field])
    # Laplace smoothing prevents unseen numbers receiving zero probability.
    weights = [0.0] + [1.0 + frequencies[n] for n in range(1, max_number + 1)]
    return weighted_sample_without_replacement(weights, count, rng)


def evaluate(predictions, actuals):
    front_hits = []
    back_hits = []
    zero_both = 0
    any_hit = 0
    for (pf, pb), actual in zip(predictions, actuals):
        fh = len(set(pf) & set(actual["front"]))
        bh = len(set(pb) & set(actual["back"]))
        front_hits.append(fh)
        back_hits.append(bh)
        zero_both += (fh == 0 and bh == 0)
        any_hit += (fh + bh > 0)
    n = len(actuals)
    return {
        "draws": n,
        "front_mean_hits_per_line": round(sum(front_hits) / n, 6),
        "back_mean_hits_per_line": round(sum(back_hits) / n, 6),
        "zero_hit_draws": zero_both,
        "zero_hit_rate": round(zero_both / n, 6),
        "at_least_one_hit_draws": any_hit,
        "at_least_one_hit_rate": round(any_hit / n, 6),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="history.json")
    parser.add_argument("--output", default="research/v4-baseline-report.json")
    parser.add_argument("--random-runs", type=int, default=RANDOM_RUNS)
    args = parser.parse_args()
    if args.random_runs < 1:
        parser.error("--random-runs must be at least 1")

    rows = json.loads(Path(args.input).read_text(encoding="utf-8"))
    # Issue number ordering is used only as chronology. No missing dates are inferred.
    rows = sorted(rows, key=lambda row: str(row["issue"]))
    if len({str(row["issue"]) for row in rows}) != len(rows):
        raise ValueError("Duplicate issue numbers: stop before modelling")
    for row in rows:
        if (len(row.get("front", [])) != FRONT_PICK
                or len(set(row["front"])) != FRONT_PICK
                or any(type(n) is not int or not 1 <= n <= FRONT_MAX for n in row["front"])
                or len(row.get("back", [])) != BACK_PICK
                or len(set(row["back"])) != BACK_PICK
                or any(type(n) is not int or not 1 <= n <= BACK_MAX for n in row["back"])):
            raise ValueError(f"Invalid draw record: {row.get('issue')}")

    results = {}
    # Warm-up window is fixed at the largest candidate window.
    warmup = max(WINDOWS)
    test_rows = rows[warmup:]
    if not test_rows:
        raise ValueError("Not enough history for walk-forward evaluation")

    for window in WINDOWS:
        rng = random.Random(SEED + window)
        predictions = []
        for index in range(warmup, len(rows)):
            prior = rows[:index]
            predictions.append((
                score(prior, window, "front", FRONT_MAX, FRONT_PICK, rng),
                score(prior, window, "back", BACK_MAX, BACK_PICK, rng),
            ))
        results[f"frequency_weighted_{window}"] = evaluate(predictions, test_rows)

    # Uniform random benchmark, same target draws, one line per draw.
    rng = random.Random(SEED)
    random_metrics = []
    for run in range(args.random_runs):
        predictions = []
        for _ in test_rows:
            predictions.append((
                sorted(rng.sample(range(1, FRONT_MAX + 1), FRONT_PICK)),
                sorted(rng.sample(range(1, BACK_MAX + 1), BACK_PICK)),
            ))
        random_metrics.append(evaluate(predictions, test_rows))

    keys = ("front_mean_hits_per_line", "back_mean_hits_per_line",
            "zero_hit_rate", "at_least_one_hit_rate")
    random_summary = {
        key: round(sum(item[key] for item in random_metrics) / len(random_metrics), 6)
        for key in keys
    }
    report = {
        "model": "V4 pre-registered frequency-weighted baselines",
        "generated_seed": SEED,
        "history_records": len(rows),
        "first_test_issue": test_rows[0]["issue"],
        "last_test_issue": test_rows[-1]["issue"],
        "warmup_draws": warmup,
        "test_draws": len(test_rows),
        "windows": list(WINDOWS),
        "strategies": results,
        "uniform_random_monte_carlo_runs": args.random_runs,
        "uniform_random_mean": random_summary,
        "limitations": [
            "Historical issue order is used because 2,926 legacy records lack verified dates and provenance.",
            "This is a diagnostic baseline only; it does not establish future predictive power.",
            "Frequency-weighted strategies are fixed in advance; no best-window selection is made from the test results.",
            "A final assessment requires future predictions timestamped before public draws."
        ]
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in (
        "first_test_issue", "last_test_issue", "test_draws",
        "strategies", "uniform_random_mean"
    )}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
