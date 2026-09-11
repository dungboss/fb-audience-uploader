# Gộp audience DE theo nhóm họ trùng nghĩa

**Ngày:** 2026-08-27 · **Nguồn:** `Tệp - DE.csv` (499 audience) · **Trạng thái:** báo cáo, chưa thay đổi gì

## Tóm tắt

- 19 nhóm họ đề xuất → **14 nhóm thực sự gộp được**, gồm **32 audience** (~378.800 người) → còn 14, giảm 18.
- 5 nhóm không cần làm gì: chỉ tồn tại một cách viết.
- **Chặn lớn nhất:** 11/14 nhóm nằm rải trên 2–4 ad account thuộc cả 3 BM khác nhau.

## Phát hiện quyết định: email là dữ liệu SINH, không phải thu thập

`/Users/macbook/Documents/DE mail/generate-de-email-list.py` sinh email từ `LASTS`
(63 họ) × first names × công thức, mỗi họ ghi ra `output/<họ>.txt`.

Hai hệ quả:

1. **File `.txt` xoá rồi vẫn regenerate được** — không mất dữ liệu, up lại luôn khả thi.
2. `meyer@…` và `meier@…` là **hai chuỗi khác nhau**, không phải một người viết sai
   chính tả. Gộp = gom nhóm họ cho gọn khi chạy ads, **không** khử trùng người thật.
   Tổng số người sau gộp = tổng các phần, không giảm.

## 14 nhóm gộp được

| Nhóm | Ý nghĩa | Số audience | Các biến thể | Số ad account | Ước người |
|---|---|---|---|---|---|
| **Meyer** | Người quản lý trang trại / Thị trưởng | 4 | meyer, meier, maier, mayer | 4 | ~74,400 |
| **Schmidt** | Thợ rèn | 3 | schmidt, schmitt, schmid | 3 | ~71,150 |
| **Schulz** | Thị trưởng / Tộc trưởng | 3 | schulz, schulze, schultz | 1 | ~40,150 |
| **Hofmann** | Gia nhân / Quản gia | 2 | hofmann, hoffmann | 2 | ~29,100 |
| **Kraus** | Tóc xoăn | 2 | kraus, krause | 2 | ~22,000 |
| **Weiss** | Trắng / Tóc bạc | 2 | weiss, weis | 2 | ~21,050 |
| **Jansen** | Con của Jan/Johannes | 2 | jansen, janssen | 2 | ~24,150 |
| **Behrens** | Con của Bernhard | 2 | behrens, behrendt | 1 | ~6,350 |
| **Walter** | Tên riêng / Họ | 2 | walter, walther | 1 | ~26,750 |
| **Pfeiffer** | Nhạc công | 2 | pfeiffer, pfeifer | 2 | ~10,500 |
| **Herrmann** | Chiến binh | 2 | herrmann, hermann | 2 | ~17,300 |
| **Ullrich** | Tên riêng / Họ | 2 | ullrich, ulrich | 2 | ~9,650 |
| **Baier** | Người xứ Bavaria | 2 | baier, bayer | 2 | ~9,850 |
| **Kremer** | Thương nhân | 2 | kremer, kramer | 2 | ~16,400 |

Chi tiết từng audience (kèm Audience ID để thao tác):
`/Users/macbook/Documents/gop-ho-trung-DE-260827.csv`

### Chỉ 3 nhóm nằm gọn trong một ad account

`Schulz` (3), `Behrens` (2), `Walter` (2). 11 nhóm còn lại nằm chéo ad account/BM.

## 5 nhóm không cần xử lý

| Nhóm | Đang có | Không tồn tại |
|---|---|---|
| Müller | mueller | müller |
| Schäfer | schaefer | schäfer |
| Krüger | krueger | krüger |
| Schröder | schroeder | schröder |
| Schneider | schneider | schnider |

Bản có dấu chưa từng được sinh — generator chỉ dùng ASCII.

## Giải pháp

**Meta không có API gộp custom audience.** Không có đường tắt.

### ① Sửa từ gốc (rẻ, chặn tái diễn)

Đổi `LASTS` từ danh sách phẳng sang có nhóm; `write_one_last` gom mọi cách viết
trong nhóm vào **một** file đặt theo tên chuẩn. Sửa ~15 dòng Python. Từ đợt sau:
một nhóm họ = một file = một audience.

### ② Xử lý 32 audience đã lên Meta

| Cách | Chi phí | Vướng |
|---|---|---|
| Target nhiều audience trong cùng ad set (= hợp, Meta tự khử trùng người) | 0 | **Chỉ dùng được cho 3/14 nhóm.** Ad set chỉ target được audience thuộc chính ad account đó; muốn hơn phải share audience giữa ad account, mà đây chéo 3 BM |
| Regenerate file đã gộp → tạo 14 audience mới → xoá 32 cái cũ | Thời gian upload bằng đúng khối lượng cũ | Không có; file sinh lại được |

**Khuyến nghị:** làm ① trước. ② quyết sau, tuỳ 32 audience đó còn đang chạy ads hay không.

## Vấn đề khác phát hiện được

`voss` **trùng tên thật** — hai audience cùng tên trên Miho 4 (Suijin) và Miho 5
(Văn Đẩu), tức hai BM khác nhau. Khác bản chất với nhóm biến thể chính tả; cần xác
nhận đây là cố ý hay tạo nhầm.

## Câu hỏi chưa có lời đáp

- ~~32 audience này có đang được dùng trong ad set nào không?~~ **Đã kiểm tra 27/08:
  KHÔNG.** Cả 15 ad account đều có 0 campaign / 0 ad set / 0 ads; cả 3 token đều có
  `ads_read` + `ads_management` nên số 0 là thật, không phải bị chặn quyền. Xoá audience
  cũ không làm gãy gì.
- `voss` trùng trên 2 BM là cố ý hay lỗi?
- Có muốn áp cùng cách gộp cho đợt FR đang chạy không? Chưa rà nhóm họ trùng bên FR.
