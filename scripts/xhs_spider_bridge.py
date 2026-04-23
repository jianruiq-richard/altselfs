#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path


def _error(message: str):
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    sys.exit(0)


def _get(item, *keys):
    for key in keys:
        if isinstance(item, dict) and key in item and item[key] is not None:
            return item[key]
    return None


def _as_text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def normalize_note(item):
    note_id = _as_text(_get(item, "note_id", "id"))
    title = _as_text(_get(item, "display_title", "title", "name"))
    user = _get(item, "user") if isinstance(item, dict) else None
    user_name = _as_text(_get(user, "nickname", "name")) if isinstance(user, dict) else ""
    liked = _as_text(_get(item, "liked_count", "likedCount", "like_count"))
    comment = _as_text(_get(item, "comment_count", "commentCount"))
    share = _as_text(_get(item, "share_count", "shareCount"))
    desc = _as_text(_get(item, "desc", "description", "content"))
    xsec_token = _as_text(_get(item, "xsec_token"))
    if note_id:
        url = f"https://www.xiaohongshu.com/explore/{note_id}"
        if xsec_token:
            url = f"{url}?xsec_source=pc_search&xsec_token={xsec_token}"
    else:
        url = ""

    return {
        "noteId": note_id,
        "title": title,
        "author": user_name,
        "likedCount": liked,
        "commentCount": comment,
        "shareCount": share,
        "desc": desc[:300],
        "url": url,
    }


def normalize_note_detail(payload):
    data = payload.get("data") if isinstance(payload, dict) else None
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list) or len(items) == 0:
        return {}
    item = items[0]
    card = _get(item, "note_card") if isinstance(item, dict) else {}
    user = _get(card, "user") if isinstance(card, dict) else {}
    interact = _get(card, "interact_info") if isinstance(card, dict) else {}
    note_id = _as_text(_get(item, "id", "note_id"))
    title = _as_text(_get(card, "title", "display_title"))
    desc = _as_text(_get(card, "desc"))

    return {
        "noteId": note_id,
        "title": title,
        "desc": desc,
        "author": _as_text(_get(user, "nickname")),
        "likedCount": _as_text(_get(interact, "liked_count")),
        "collectedCount": _as_text(_get(interact, "collected_count")),
        "commentCount": _as_text(_get(interact, "comment_count")),
        "shareCount": _as_text(_get(interact, "share_count")),
    }


def main():
    if len(sys.argv) < 2:
        _error("missing payload")

    try:
        payload = json.loads(sys.argv[1])
    except Exception as exc:
        _error(f"invalid payload: {exc}")

    root = payload.get("spiderRoot")
    if not isinstance(root, str) or not root:
        _error("missing spiderRoot")
    root_path = Path(root).resolve()
    if not root_path.exists():
        _error(f"spiderRoot not found: {root_path}")

    if str(root_path) not in sys.path:
        sys.path.insert(0, str(root_path))

    try:
        from apis.xhs_pc_apis import XHS_Apis  # type: ignore
    except Exception as exc:
        _error(f"import Spider_XHS failed: {exc}")

    action = _as_text(payload.get("action"))
    args = payload.get("args") if isinstance(payload.get("args"), dict) else {}
    cookies = _as_text(payload.get("cookies"))
    if not cookies:
        _error("missing cookies")

    api = XHS_Apis()

    try:
        if action == "search_notes":
            query = _as_text(args.get("query"))
            limit = int(args.get("limit") or 10)
            limit = max(1, min(20, limit))
            success, msg, notes = api.search_some_note(query, limit, cookies)
            notes = notes if isinstance(notes, list) else []
            result = {
                "ok": bool(success),
                "message": _as_text(msg),
                "action": action,
                "items": [normalize_note(item) for item in notes[:limit]],
            }
            print(json.dumps(result, ensure_ascii=False))
            return

        if action == "get_note_detail":
            note_url = _as_text(args.get("noteUrl"))
            success, msg, payload_data = api.get_note_info(note_url, cookies)
            result = {
                "ok": bool(success),
                "message": _as_text(msg),
                "action": action,
                "item": normalize_note_detail(payload_data if isinstance(payload_data, dict) else {}),
            }
            print(json.dumps(result, ensure_ascii=False))
            return

        if action == "get_user_notes":
            user_url = _as_text(args.get("userUrl"))
            limit = int(args.get("limit") or 10)
            limit = max(1, min(30, limit))
            success, msg, notes = api.get_user_all_notes(user_url, cookies)
            notes = notes if isinstance(notes, list) else []
            result = {
                "ok": bool(success),
                "message": _as_text(msg),
                "action": action,
                "items": [normalize_note(item) for item in notes[:limit]],
            }
            print(json.dumps(result, ensure_ascii=False))
            return

        _error(f"unsupported action: {action}")
    except Exception as exc:
        _error(str(exc))


if __name__ == "__main__":
    main()
