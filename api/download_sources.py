"""Where a model the open workflow is missing can be downloaded from, for Model Check's
"Download" (api/model_download.py fetches it).

Only sources that name one exact file count: Civitai by the file's hash (the workflow's
fingerprint), a Civitai model version or file link, or a direct file link on Hugging Face
(or its mirror) or GitHub, as a shared workflow carries them (AMB's model links, ComfyUI's own
`properties.models`). A file name alone is never a source. Each answer says the file's size
and SHA-256 when the site gives them, so the download can be checked.
"""

import json
import re
import urllib.error
import urllib.parse
import urllib.request

try:
    from ..civitai_client import USER_AGENT, _load_api_key
except ImportError:  # loaded outside the package (tests)
    from civitai_client import USER_AGENT, _load_api_key

CIVITAI_HOSTS = ("civitai.com", "civitai.red")
HF_HOSTS = ("huggingface.co", "hf-mirror.com")
HF_MIRROR = "hf-mirror.com"  # Hugging Face's mirror for mainland China (it sends other networks back)
OTHER_HOSTS = ("github.com",)
TIMEOUT = 15
SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")


class SourceUnreachable(Exception):
    """The site did not answer (network, timeout, server error)."""


def host_of(url):
    try:
        parsed = urllib.parse.urlsplit(str(url).strip())
    except ValueError:
        return ""
    return (parsed.hostname or "").lower() if parsed.scheme == "https" else ""


def _site(host, sites):
    return any(host == site or host.endswith("." + site) for site in sites)


def allowed_download_url(url):
    """Whether `url` is an https link on a site downloads may start from."""
    host = host_of(url)
    return bool(host) and _site(host, CIVITAI_HOSTS + HF_HOSTS + OTHER_HOSTS)


def is_civitai(url):
    return _site(host_of(url), CIVITAI_HOSTS)


def civitai_headers():
    headers = {"User-Agent": USER_AGENT}
    key = _load_api_key()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _get_json(url, headers):
    """The JSON at `url`; None on 404; SourceUnreachable when it could not be asked."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code in (400, 404):
            return None
        raise SourceUnreachable(f"HTTP {error.code}") from error
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise SourceUnreachable(str(error)) from error


def _civitai_page(version):
    domain = "civitai.red" if (version.get("model") or {}).get("nsfw") or (version.get("nsfwLevel") or 1) > 1 else "civitai.com"
    model_id = version.get("modelId")
    return f"https://{domain}/models/{model_id}?modelVersionId={version.get('id')}" if model_id else ""


def _pick_civitai_file(files, file_hash="", name=""):
    """The version's file with this hash (SHA-256 or a prefix such as AutoV2), else this name; None if neither."""
    files = [item for item in files or [] if isinstance(item, dict) and item.get("downloadUrl")]
    wanted = str(file_hash or "").upper()
    if wanted:
        for item in files:
            hashes = {str(value).upper() for value in (item.get("hashes") or {}).values()}
            sha = str((item.get("hashes") or {}).get("SHA256") or "").upper()
            if wanted in hashes or (len(wanted) >= 10 and sha.startswith(wanted)):
                return item
        return None
    if name:
        for item in files:
            if str(item.get("name", "")).lower() == name.lower():
                return item
    return None


def _from_civitai_version(version, file_hash="", name=""):
    picked = _pick_civitai_file(version.get("files"), file_hash, name)
    if not picked:
        return None
    sha = str((picked.get("hashes") or {}).get("SHA256") or "")
    return {
        "found": True,
        "source": "civitai",
        "download_url": picked["downloadUrl"],
        "file_name": picked.get("name") or "",
        "size": int(float(picked.get("sizeKB") or 0) * 1024),
        "sha256": sha.lower() if SHA256.match(sha) else "",
        "format": ((picked.get("metadata") or {}).get("format") or ""),
        "base_model": version.get("baseModel") or "",
        "model_name": (version.get("model") or {}).get("name") or "",
        "version_name": version.get("name") or "",
        "page": _civitai_page(version),
    }


def civitai_by_hash(file_hash):
    version = _get_json(f"https://civitai.com/api/v1/model-versions/by-hash/{urllib.parse.quote(file_hash)}", civitai_headers())
    return _from_civitai_version(version, file_hash) if version else None


def _civitai_version_id(url):
    parsed = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qs(parsed.query)
    if query.get("modelVersionId"):
        return query["modelVersionId"][0]
    match = re.search(r"/api/download/models/(\d+)", parsed.path) or re.search(r"/model-versions/(\d+)", parsed.path)
    return match.group(1) if match else ""


def civitai_by_link(url, name, file_hash=""):
    """A Civitai link that names a model version: its file of this hash or name."""
    version_id = _civitai_version_id(url)
    if not version_id.isdigit():
        return None
    version = _get_json(f"https://civitai.com/api/v1/model-versions/{version_id}", civitai_headers())
    return _from_civitai_version(version, file_hash, name) if version else None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def _hf_file_url(url, host=""):
    """https://<hf>/<repo>/resolve/<rev>/<path> for a blob or resolve link to a file, else '';
    on `host` (Hugging Face or its mirror) when given."""
    parsed = urllib.parse.urlsplit(url)
    parts = [part for part in parsed.path.split("/") if part]
    for marker in ("resolve", "blob"):
        if marker in parts:
            at = parts.index(marker)
            if at >= 2 and len(parts) > at + 2:
                parts[at] = "resolve"
                return urllib.parse.urlunsplit(("https", host or parsed.netloc, "/" + "/".join(parts), "", ""))
    return ""


def _head(url):
    """(headers, redirected) of a HEAD request that does not follow redirects; None on 404,
    "gated" on 401/403."""
    opener = urllib.request.build_opener(_NoRedirect)
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        return opener.open(request, timeout=TIMEOUT).headers, False
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            return "gated"
        if error.code == 404:
            return None
        if error.code not in (301, 302, 303, 307, 308):
            raise SourceUnreachable(f"HTTP {error.code}") from error
        return error.headers, True
    except (urllib.error.URLError, OSError) as error:
        raise SourceUnreachable(str(error)) from error


def hugging_face_file(url, host=""):
    """A Hugging Face file link, fetched from `host` (huggingface.co or the mirror; the link's
    own when empty): its size and SHA-256 from the site's headers."""
    file_url = _hf_file_url(url, host)
    if not file_url:
        return None
    answer = _head(file_url)
    if isinstance(answer, tuple) and answer[1] and not answer[0].get("x-linked-size"):
        # Sent on to the other Hugging Face host (the mirror does that outside China): ask there.
        location = urllib.parse.urljoin(file_url, answer[0].get("Location") or "")
        if _site(host_of(location), HF_HOSTS) and host_of(location) != host_of(file_url):
            answer = _head(location)
    if answer is None:
        return None
    if answer == "gated":
        return {"found": False, "reason": "gated", "page": url}
    headers, redirected = answer
    etag = str(headers.get("x-linked-etag") or headers.get("etag") or "").strip('"').replace("W/", "").strip('"')
    # A redirect's own length is not the file's: without x-linked-size (small files kept
    # outside large-file storage) the size is unknown.
    size = headers.get("x-linked-size") or (0 if redirected else headers.get("content-length")) or 0
    return {
        "found": True,
        "source": "huggingface",
        "mirror": host_of(file_url) == HF_MIRROR,
        "download_url": file_url,
        "file_name": urllib.parse.unquote(file_url.rsplit("/", 1)[-1]),
        "size": int(size) if str(size).isdigit() else 0,
        "sha256": etag.lower() if SHA256.match(etag) else "",
        "format": "",
        "base_model": "",
        "model_name": "",
        "version_name": "",
        "page": url,
    }


def plain_link(url):
    """A direct file link elsewhere (a GitHub release asset): no size or hash to check against."""
    path = urllib.parse.urlsplit(url).path
    if "/releases/download/" not in path:
        return None
    return {
        "found": True, "source": "link", "download_url": url,
        "file_name": urllib.parse.unquote(path.rsplit("/", 1)[-1]), "size": 0, "sha256": "",
        "format": "", "base_model": "", "model_name": "", "version_name": "", "page": url,
    }


def find_source(file_hash="", url="", name="", hf_mirror=False):
    """Where one missing model can come from: {found, source, download_url, file_name, size,
    sha256, base_model, model_name, version_name, page}, or {found: False, reason}. With
    `hf_mirror`, Hugging Face files come from its mirror (and without, never from it)."""
    looked = False
    try:
        if file_hash:
            looked = True
            found = civitai_by_hash(file_hash)
            if found:
                return found
        if url and host_of(url):
            looked = True
            host = host_of(url)
            if _site(host, CIVITAI_HOSTS):
                found = civitai_by_link(url, name, file_hash)
            elif _site(host, HF_HOSTS):
                found = hugging_face_file(url, HF_MIRROR if hf_mirror else "huggingface.co")
            elif _site(host, OTHER_HOSTS):
                found = plain_link(url)
            else:
                found = None
            if found:
                return found
    except SourceUnreachable as error:
        return {"found": False, "reason": "network", "error": str(error)}
    return {"found": False, "reason": "not_found" if looked else "no_source"}
