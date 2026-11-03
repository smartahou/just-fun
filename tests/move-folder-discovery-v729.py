#!/usr/bin/env python3
"""Empty and document-only nested folders remain valid move targets.

Uses a disposable library. Never reads or mutates the user's actual library.
"""
import hashlib, json, pathlib, subprocess, tempfile, time
import urllib.error, urllib.request
from isolated import ROOT, launch, stop

checks = 0
def check(label, condition, detail=""):
    global checks
    if not condition:
        raise AssertionError(label + ": " + str(detail))
    checks += 1
    print("PASS", label, flush=True)

def get_data(port):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/data", timeout=8) as response:
        return json.load(response)

def post(port, route, body):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}" + route,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type":"application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)

def wait_for(port, predicate, description):
    last = None
    for _ in range(70):
        last = get_data(port)
        if predicate(last):
            return last
        time.sleep(0.2)
    raise AssertionError(description + " " + str(last)[:260])

def paths(data):
    return {folder.get("relativeDir") for folder in data.get("folders", [])}

def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

with tempfile.TemporaryDirectory(prefix="jf-architecture-test-move-folders-v729-") as temp:
    base = pathlib.Path(temp)
    library = base / "media"
    library.mkdir()
    empty = library / "空目录"
    empty.mkdir()
    docs = library / "仅文档"
    docs.mkdir()
    document = docs / "课程计划.docx"
    document.write_bytes(b"private document untouched")
    deep = library / "课程" / "2026"
    deep.mkdir(parents=True)
    used = library / "曾有视频"
    used.mkdir()
    video = used / "原始视频.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "color=c=green:s=64x64:r=5:d=1",
                    "-c:v", "mpeg4", str(video)], check=True, timeout=25)
    video_sha = digest(video)
    (library / ".git").mkdir()
    (library / "node_modules").mkdir()
    proc = log = None
    try:
        proc, port, log = launch(ROOT / "dist/douyin.js", library, base / "home",
                                 flags=("--hash",))
        expected = {"source", "source/空目录", "source/仅文档",
                    "source/课程", "source/课程/2026", "source/曾有视频"}
        data = wait_for(port, lambda d: expected <= paths(d)
                        and any(x.get("originalName") == video.name for x in d["items"]),
                        "Required subfolders missing from folder index")
        check("Empty folders appear in destination index", "source/空目录" in paths(data))
        check("Document-only folders appear in destination index", "source/仅文档" in paths(data))
        check("Deep empty folders and ancestors appear", {"source/课程","source/课程/2026"} <= paths(data))
        check("Previously media-bearing folder is indexed", "source/曾有视频" in paths(data))
        check("Hidden and dependency folders excluded",
              not any(p.startswith(("source/.git","source/node_modules")) for p in paths(data)))
        item = next(x for x in data["items"] if x.get("originalName") == video.name)
        key = item["key"]
        original_managed = used / item["managedName"]
        check("Existing nested video remains hashed", len(item["managedName"]) == 32
              and original_managed.exists() and digest(original_managed) == video_sha)
        check("Documents unchanged", digest(document) ==
              hashlib.sha256(b"private document untouched").hexdigest())

        status, reply = post(port, "/api/media-move", {"keys":[key],"target":"data"})
        check("Move media away from its original folder", status == 200 and reply.get("moved") == 1, reply)
        data = wait_for(port, lambda d: "source/曾有视频" in paths(d)
                        and any(x["key"] == key and x.get("relativeDir") == "data" for x in d["items"]),
                        "Empty former folder vanished after moving its only media")
        check("Former media folder remains in move destinations", "source/曾有视频" in paths(data))
        check("Former folder still exists on disk", used.is_dir())

        status, reply = post(port, "/api/media-move", {"keys":[key],"target":"source/空目录"})
        check("Can select empty physical subfolder as move target", status == 200 and reply.get("moved") == 1, reply)
        data = wait_for(port, lambda d: any(x["key"] == key
                        and x.get("relativeDir") == "source/空目录" for x in d["items"]),
                        "Moved media not indexed in empty folder")
        item = next(x for x in data["items"] if x["key"] == key)
        check("Moved media keeps same ID and bytes", len(item["managedName"]) == 32
              and digest(empty / item["managedName"]) == video_sha)

        status, reply = post(port, "/api/media-move", {"keys":[key],"target":"source/仅文档"})
        check("Can select document-only subfolder as move target", status == 200 and reply.get("moved") == 1, reply)
        data = wait_for(port, lambda d: any(x["key"] == key
                        and x.get("relativeDir") == "source/仅文档" for x in d["items"]),
                        "Moved media not indexed in document-only folder")
        item = next(x for x in data["items"] if x["key"] == key)
        check("Document untouched after moving media", document.read_bytes() == b"private document untouched")
        check("Hash media bytes intact after two more moves", digest(docs / item["managedName"]) == video_sha)

        status, reply = post(port, "/api/media-move", {"keys":[key],"target":"data"})
        check("Move back out of document-only folder", status == 200 and reply.get("moved") == 1, reply)
        data = wait_for(port, lambda d: "source/空目录" in paths(d)
                        and "source/仅文档" in paths(d)
                        and "source/曾有视频" in paths(d),
                        "Empty/document-only folder pruned after move")
        check("All original physical folders retained", all(x.is_dir() for x in [empty, docs, deep, used]))
    finally:
        stop(proc, log)

print(f"TOTAL {checks} PASS", flush=True)
