#!/usr/bin/env python3
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

required = ("ECOWITT_APPLICATION_KEY", "ECOWITT_API_KEY", "ECOWITT_LOCAL_ARCHIVE_TOKEN")
if any(not os.environ.get(name) for name in required):
    print("Local Ecowitt archive skipped: required secret configuration is incomplete.", file=sys.stderr)
    sys.exit(2)

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = build_opener(NoRedirect)
request = Request(
    "http://127.0.0.1:8787/api/weather/archive",
    data=b"",
    headers={"Authorization": "Bearer " + os.environ["ECOWITT_LOCAL_ARCHIVE_TOKEN"]},
    method="POST",
)
for attempt in range(8):
    try:
        with opener.open(request, timeout=260) as response:
            response.read()
            if response.status == 200:
                print("Local Ecowitt archive completed.")
                sys.exit(0)
            print(f"Local Ecowitt archive returned HTTP {response.status}.", file=sys.stderr)
            sys.exit(1)
    except HTTPError as error:
        if error.code in (429, 500, 502, 503, 504) and attempt < 7:
            time.sleep(min(60, 2 ** (attempt + 1)))
            continue
        print(f"Local Ecowitt archive returned HTTP {error.code}.", file=sys.stderr)
        sys.exit(1)
    except (URLError, TimeoutError) as error:
        if attempt == 7:
            reason = getattr(error, "reason", None)
            reason_type = type(reason).__name__ if reason is not None else "unknown"
            print(
                f"Local Ecowitt archive request failed "
                f"({type(error).__name__}; reason type={reason_type}).",
                file=sys.stderr,
            )
            sys.exit(1)
        time.sleep(2 ** attempt)
