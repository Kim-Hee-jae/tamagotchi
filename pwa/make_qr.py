import sys
import qrcode
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

def add_query(url: str, **kwargs) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query))
    for k, v in kwargs.items():
        query[k] = str(v)
    return urlunparse(parsed._replace(query=urlencode(query)))

if len(sys.argv) < 2:
    print('사용법: python make_qr.py "https://your-site-url.netlify.app"')
    sys.exit(1)

base_url = sys.argv[1].strip().rstrip("/")
items = [
    ("qr_2hall_normal.png", base_url),
    ("qr_2hall_start_push.png", add_query(base_url, startPush=1)),
    ("qr_5hall_stop_after_30s.png", add_query(base_url, stopAfter=30)),
    ("qr_5hall_rupture_now.png", add_query(base_url, mode="rupture")),
    ("qr_rehearsal_reset.png", add_query(base_url, reset=1)),
]

for filename, url in items:
    qrcode.make(url).save(filename)
    print(f"{filename} 저장 완료: {url}")
