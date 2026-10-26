"""Images via the magic·art OpenAI-compatible API (agent3.shyfai.cn): text-to-image, image-to-image with
references and an optional mask, batches, and recovery of a task by request ID. Downloads results at once.

  t2i    python3 -I qingming/tools/shyfai_image.py OUT_PREFIX --prompt "..."       # or --prompt-file p.txt
  size   ... OUT_PREFIX --prompt-file p.txt --size 1536x864 --n 2         # or --size 16:9 --resolution 2k
  i2i    ... OUT_PREFIX --prompt "put the man in image 1 on the street in image 2" --ref man.png street.png
  mask   ... OUT_PREFIX --prompt "a tea stall in the masked area" --ref street.png --mask hole.png
  batch  ... --batch jobs.jsonl --jobs 3
  fetch  ... OUT_PREFIX --fetch REQUEST_ID       # download a finished task again, or recover after a timeout
  other  ... --list-models      add --dry-run to any run to print the request bodies without calling the API

Each job writes OUT_PREFIX_<i>.<ext> and OUT_PREFIX.json (request_id, status, timing, usage, prompt, refs).
Put outputs under qingming/gen/.

Batch file: one JSON object per line; blank lines and '#' lines are skipped. Keys are the flag names, with
"out" for OUT_PREFIX. Command-line flags set the defaults for every line:
  {"out": "qingming/gen/v2/a", "prompt": "...", "size": "1536x864"}
  {"out": "qingming/gen/v2/b", "prompt_file": "p.txt", "ref": ["street.png"], "model": "gpt-image-2"}
Paths are relative to the current directory. A failed job doesn't stop the others; the exit code is 1 if any
job failed.

Notes (docs at https://shyfai.cn/, which is not the API host; tests 2026-10-08):
- Models: gpt-image-2.5 (default), gpt-image-2, gpt-image-2.5-flare, gpt-image-2.5-sunburst.
- One 1024x1024 image takes about 32-34 s with gpt-image-2 and 2.5. The call waits for the result.
- --size: WIDTHxHEIGHT (lowercase x), 'auto', or a ratio such as 16:9 together with --resolution 1k/2k/4k.
  Max edge 4096. Common: 1:1 1024x1024 / 2048x2048, 16:9 1536x864 / 2048x1152, 9:16 864x1536,
  3:4 896x1152, 3:2 1536x1024. Ratio presets are approximate; give pixels when the exact size matters.
- Boardwalk defaults (2026-10-26): gpt-image-2.5, 3840x2560 (the 4K 3:2 preset, exactly 2.5x the 1536x1024 stage),
  quality high. Anything for the real site uses these; pass a smaller --size or --quality only for throwaway tests.
  A 4K high edit took 46 s and gave an 11.8 MB PNG.
- --n 1-12 (a model may allow fewer). --format png / jpeg / webp.
- --ref switches to /v1/images/edits: up to 16 images, local files (sent inline as base64) or http(s) URLs.
  Refer to them in the prompt by order ("image 1", "image 2"). Very large local files can hit HTTP 413.
- --mask: one image, used with --ref; what its transparent area means depends on the model.
- --extra KEY=VALUE passes model-specific fields (background, moderation, input_fidelity); the model decides
  whether they do anything.
- Every job sends an Idempotency-Key, so retries after timeouts, 429, 488 (concurrency limit) or 5xx reuse
  the same task instead of paying for a new one. 400 (bad input, content_policy_violation), 401 and 499 are
  not retried. On repeated 488 in a batch, lower --jobs.
- Result URLs need no key and expire, so the script downloads them right away.
- Not used here: streaming (SSE), callback/async mode, chat-completions format, CDN delivery.
"""
import argparse, base64, concurrent.futures, json, mimetypes, os, sys, time, urllib.error, urllib.request, uuid

API = "https://agent3.shyfai.cn/v1"
def _key():
    """The API key: $SHYFAI_API_KEY, else the first line of ~/.shyfai_key (kept out of the project)."""
    k = os.environ.get("SHYFAI_API_KEY", "").strip()
    if not k and os.path.exists(os.path.expanduser("~/.shyfai_key")):
        with open(os.path.expanduser("~/.shyfai_key")) as f:
            k = f.readline().strip()
    if not k:
        sys.exit("no shyfai key: set SHYFAI_API_KEY or put it on the first line of ~/.shyfai_key")
    return k


KEY = _key()
RETRY = {408, 429, 466, 488, 500, 502, 503, 504}
EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
DONE = ("completed", "failed", "cancelled")


class JobError(Exception):
    pass


def http(method, path, body=None, headers=None, timeout=60):
    """Returns (status, parsed JSON). HTTP errors are returned too; network errors raise OSError."""
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
                                          **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"error": {"message": raw[:500]}}


def poll(request_id, deadline_s=900):
    end = time.time() + deadline_s
    while time.time() < end:
        try:
            code, t = http("GET", f"/images/tasks/{request_id}", timeout=30)
        except OSError:
            code, t = 0, {}
        if code == 200 and t.get("status") in DONE:
            return t
        if code not in (0, 200) and code not in RETRY:
            raise JobError(f"task {request_id}: HTTP {code} {t.get('error')}")
        time.sleep(3)
    raise JobError(f"task {request_id} not finished after {deadline_s}s; try --fetch {request_id} later")


def submit(path, body, timeout, attempts=4):
    """POST with one Idempotency-Key across retries. Returns (task, idempotency_key, attempts_used)."""
    key, code, err = str(uuid.uuid4()), 0, {}
    for i in range(attempts):
        try:
            code, t = http("POST", path, body, {"Idempotency-Key": key}, timeout)
        except OSError as e:
            code, t = 0, {"error": {"message": f"network: {e}"}}
        err = t.get("error") or {}
        rid = t.get("request_id") or err.get("request_id")
        if code == 200 and t.get("status") in DONE:
            return t, key, i + 1
        if rid and (code in (200, 202, 408, 504) or err.get("code") == "task_still_running_query_by_request_id"):
            return poll(rid), key, i + 1
        if code and code not in RETRY:
            raise JobError(f"HTTP {code}: {json.dumps(err, ensure_ascii=False)}")
        if i + 1 < attempts:
            time.sleep(5 * 2 ** i)
    raise JobError(f"gave up after {attempts} attempts: HTTP {code} {json.dumps(err, ensure_ascii=False)}")


def image_ref(src):
    if src.startswith(("http://", "https://", "data:")):
        return src
    mime = mimetypes.guess_type(src)[0] or "image/png"
    return f"data:{mime};base64," + base64.b64encode(open(src, "rb").read()).decode()


def short(o):
    """Request body for printing, with inline base64 shortened."""
    if isinstance(o, dict): return {k: short(v) for k, v in o.items()}
    if isinstance(o, list): return [short(v) for v in o]
    if isinstance(o, str) and len(o) > 200: return o[:40] + f"...<{len(o)} chars>"
    return o


def save(out, t, rec):
    """Downloads the task's images and always writes OUT.json. Raises JobError if the task didn't complete."""
    rec.update(request_id=t.get("request_id") or rec.get("request_id"), status=t.get("status"),
               usage=t.get("usage"), error=t.get("error"),
               image_urls=[d.get("url") for d in t.get("data") or []], files=[])
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    try:
        if t.get("status") != "completed":
            raise JobError(f"{t.get('status')}: {t.get('error')}")
        for n, url in enumerate(rec["image_urls"]):
            with urllib.request.urlopen(url, timeout=120) as r:
                data, ext = r.read(), EXT.get(r.headers.get_content_type(), rec.get("format", "png"))
            path = f"{out}_{n}.{ext}"
            open(path, "wb").write(data)
            rec["files"].append(path)
    finally:
        json.dump(rec, open(out + ".json", "w"), ensure_ascii=False, indent=1)


def run(job, dry=False):
    out = job["out"]
    if job.get("fetch"):
        if dry: return f"would fetch task {job['fetch']}"
        save(out, poll(job["fetch"]), {"request_id": job["fetch"], "fetched": True})
        return f"fetched {job['fetch']}"
    prompt = job.get("prompt") or open(job["prompt_file"], encoding="utf-8").read().strip()
    fmt = "jpeg" if job["format"] == "jpg" else job["format"]
    body = {"model": job["model"], "prompt": prompt, "n": job["n"], "size": job["size"], "quality": job["quality"],
            "response_format": "url", "output_format": fmt, "client_reference": os.path.basename(out)}
    if job.get("resolution"): body["resolution"] = job["resolution"]
    body.update(job.get("extra") or {})
    refs = [job["ref"]] if isinstance(job.get("ref"), str) else job.get("ref") or []
    path = "/images/generations"
    if refs:
        if len(refs) > 16: raise JobError("at most 16 reference images")
        path = "/images/edits"
        body["images"] = [{"image_url": image_ref(r)} for r in refs]
        if job.get("mask"):
            m = image_ref(job["mask"])
            body["mask"] = {"b64_json": m.split(",", 1)[1]} if m.startswith("data:") else m
    elif job.get("mask"):
        raise JobError("--mask needs --ref")
    if dry:
        return f"POST {path} " + json.dumps(short(body), ensure_ascii=False)

    t0 = time.time()
    t, idem, tries = submit(path, body, job["timeout"])
    gen_s = round(time.time() - t0, 1)
    save(out, t, {"model": job["model"], "endpoint": path, "prompt": prompt, "refs": refs, "mask": job.get("mask"),
                  "params": {k: v for k, v in body.items() if k not in ("model", "prompt", "images", "mask")},
                  "format": fmt, "generation_s": gen_s, "attempts": tries, "idempotency_key": idem})
    return f"{job['model']} {gen_s}s, {len(t.get('data') or [])} images"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out_prefix", nargs="?", help="e.g. qingming/gen/v2/street_C")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--prompt", help="prompt text")
    src.add_argument("--prompt-file", help="UTF-8 text file holding the prompt")
    src.add_argument("--fetch", metavar="REQUEST_ID", help="download the results of an existing task")
    src.add_argument("--batch", metavar="JOBS_JSONL", help="run many jobs; see the batch file format above")
    ap.add_argument("--model", default="gpt-image-2.5")
    ap.add_argument("--size", default="3840x2560", help="WIDTHxHEIGHT, auto, or a ratio like 16:9")
    ap.add_argument("--resolution", help="1k / 2k / 4k, with a ratio in --size")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--n", type=int, default=1, help="images per job, 1-12")
    ap.add_argument("--format", default="png", choices=["png", "jpeg", "jpg", "webp"])
    ap.add_argument("--ref", nargs="+", metavar="IMAGE", help="reference images or URLs -> image-to-image")
    ap.add_argument("--mask", metavar="IMAGE", help="edit mask, used with --ref")
    ap.add_argument("--extra", action="append", default=[], metavar="KEY=VALUE",
                    help="extra model field, repeatable; VALUE is parsed as JSON when it can be")
    ap.add_argument("--jobs", type=int, default=3, help="parallel jobs for --batch")
    ap.add_argument("--timeout", type=int, default=420, help="seconds to wait for each request")
    ap.add_argument("--dry-run", action="store_true", help="print the requests without calling the API")
    ap.add_argument("--list-models", action="store_true", help="print the models this key can use and exit")
    a = ap.parse_args()

    if a.list_models:
        code, t = http("GET", "/models")
        if code != 200: raise SystemExit(f"HTTP {code}: {t.get('error')}")
        print("\n".join(m["id"] for m in t["data"]))
        return

    extra = {}
    for kv in a.extra:
        k, _, v = kv.partition("=")
        try: extra[k] = json.loads(v)
        except ValueError: extra[k] = v
    defaults = {"model": a.model, "size": a.size, "resolution": a.resolution, "quality": a.quality, "n": a.n,
                "format": a.format, "ref": a.ref, "mask": a.mask, "extra": extra, "timeout": a.timeout}

    if a.batch:
        jobs = []
        for ln, line in enumerate(open(a.batch, encoding="utf-8"), 1):
            line = line.strip()
            if not line or line.startswith("#"): continue
            j = {**defaults, **json.loads(line)}
            if "out" not in j or not (j.get("prompt") or j.get("prompt_file") or j.get("fetch")):
                ap.error(f"{a.batch}:{ln}: each line needs out and prompt, prompt_file or fetch")
            jobs.append(j)
    else:
        if not a.out_prefix or not (a.prompt or a.prompt_file or a.fetch):
            ap.error("need OUT_PREFIX and one of --prompt, --prompt-file, --fetch (or use --batch / --list-models)")
        jobs = [{**defaults, "out": a.out_prefix, "prompt": a.prompt, "prompt_file": a.prompt_file, "fetch": a.fetch}]

    def one(j):
        try:
            return True, f"ok   {j['out']}: {run(j, a.dry_run)}"
        except (JobError, OSError, KeyError, ValueError) as e:
            return False, f"FAIL {j['out']}: {e}"

    failed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, a.jobs)) as pool:
        for ok, msg in pool.map(one, jobs):
            print(msg, flush=True)
            failed += not ok
    if len(jobs) > 1:
        print(f"{len(jobs) - failed}/{len(jobs)} jobs ok")
    sys.exit(1 if failed else 0)


main()
