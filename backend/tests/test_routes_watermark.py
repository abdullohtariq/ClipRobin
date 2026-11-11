import io
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app
from app.routes.watermark import get_watermarks_dir

client = TestClient(app)


def test_watermark_endpoints(tmp_path, monkeypatch):
    # Ensure clean watermarks test dir
    monkeypatch.setattr("app.routes.watermark.get_watermarks_dir", lambda: tmp_path)

    # 1. Initially no custom watermark
    res = client.get("/api/watermark")
    assert res.status_code == 200
    data = res.json()
    assert data["has_custom_watermark"] is False

    # 2. Upload invalid extension
    bad_upload = client.post(
        "/api/watermark/upload",
        files={"file": ("test.exe", b"fake binary", "application/octet-stream")},
    )
    assert bad_upload.status_code == 400

    # 3. Upload valid PNG image
    from io import BytesIO
    from PIL import Image

    buf = BytesIO()
    Image.new("RGBA", (16, 16), (255, 0, 0, 255)).save(buf, format="PNG")
    fake_png = buf.getvalue()
    upload_res = client.post(
        "/api/watermark/upload",
        files={"file": ("my_brand.png", fake_png, "image/png")},
    )
    assert upload_res.status_code == 200
    up_data = upload_res.json()
    assert up_data["status"] == "success"
    assert up_data["filename"] == "custom_watermark.png"

    # 4. Check status shows custom watermark
    status_res = client.get("/api/watermark")
    assert status_res.status_code == 200
    assert status_res.json()["has_custom_watermark"] is True

    # 5. Get watermark image
    img_res = client.get("/api/watermark/image")
    assert img_res.status_code == 200
    assert img_res.content == fake_png

    # 6. Delete watermark
    del_res = client.delete("/api/watermark")
    assert del_res.status_code == 200
    assert del_res.json()["deleted"] is True

    # 7. Check status is false again
    status_res2 = client.get("/api/watermark")
    assert status_res2.json()["has_custom_watermark"] is False
