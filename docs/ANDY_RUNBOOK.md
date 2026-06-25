# Kế hoạch hành động cuối — Tối ưu quy trình build (bản đã qua 2 senior phản biện)
### Repo: `ielts-speaking-coach` (averlearning.com) · Cho chủ dự án không chuyên · Audit-only, file này chỉ hướng dẫn

---

## ⚠️ Đọc trước: 2 reviewer đã lật ngược 2 lời khuyên ban đầu của mình

Mình cho 2 senior phản biện trực diện mọi thứ đã gửi. Họ đúng ở 2 điểm lớn, nên bản này **sửa lại**, không phải lặp lại:

| Lời khuyên CŨ (sai/quá tay) | Sửa thành |
|---|---|
| "Bỏ AI thứ hai, chỉ dùng 1 CLI" | **GIỮ AI thứ hai làm người soi độc lập.** Nếu AI vừa làm vừa tự giải thích thì không có "máy báo cháy" — nó sai vẫn nói trôi chảy bằng tiếng Việt và bạn không có tín hiệu nào để biết. |
| "Đọc git diff để hiểu mọi thay đổi" | **Bạn kiểm SOÁT HẬU QUẢ, không đọc-hiểu từng dòng code.** Người không chuyên đọc diff chỉ thấy "đã nhìn" chứ không đánh giá được đúng/sai. Đổi sang: chạy thử app + backup + staging + CI chặn merge. |
| "Stop hook chạy cả 224 test mỗi lượt" | **Bỏ.** Quá chậm → bạn sẽ tắt nó → mất luôn guardrail, lại đốt token. Dùng `/test` gõ tay hoặc hook **pre-push** (1 lần/commit). CI vẫn là cổng 224 test thật. |
| "Dùng GitHub spec-kit, TDD viết test trước" | **Bỏ.** Bạn đã có văn hóa spec (PHASE_PLAN) + test sẵn. Thêm framework = thêm rối, không thêm kiểm soát. |
| "output-style explanatory = hiểu hơn" | **Nói rõ:** nó chỉ làm AI *nói nhiều hơn*, không *đúng hơn*. Lời giải thích mượt của một thay đổi sai còn nguy hiểm hơn vì làm bạn mất cảnh giác. |

**Sự thật nền tảng (4 điều, nhớ kỹ):**
1. **Chỉ HOOK và CI là chắc chắn 100%.** `CLAUDE.md` và lời dặn chỉ được tuân ~80%. Việc gì quan trọng phải nằm ở hook/CI, không chỉ ở lời dặn.
2. **"Test xanh" ≠ "đúng/an toàn".** AI viết tính năng *và* viết luôn test → nó có thể viết test khớp với chính cái bug của nó. Đặc biệt: chất lượng *feedback AI có trung thực không* (mục tiêu số 1 của app bạn) **unit test gần như không bắt được** — phải tự bấm thử.
3. **Bạn kiểm soát bằng HẬU QUẢ:** revert được, có backup, có staging, CI chặn merge, biết việc nào "nhạy cảm" — chứ không phải bằng việc hiểu code.
4. **Giữ một AI thứ hai** làm người soi cho việc nhạy cảm. Đừng để một model vừa làm vừa tự chấm.

---

## PHẦN 1 — 5 THÓI QUEN HẰNG NGÀY (bản rút gọn, làm được vào một ngày mệt)

Đây thay cho "7 bước" trước đó. Năm việc, lặp lại được:

**1. Một CLI để LÀM, một AI để SOI.**
- `cd ~/code/ielts-speaking-coach` → `claude` (nó tự đọc CLAUDE.md, nhìn code thật, code thẳng — không copy-paste tay).
- **Cách tốt nhất (không copy-paste):** bật AI thứ hai **tự soi mọi PR** — Claude làm → bạn push → **Codex tự đọc diff và comment vào PR**. Cài 1 lần theo **Phần 3D**.
- *Cách thủ công (khi chưa bật 3D hoặc muốn soi nhanh tại chỗ):* dán *kế hoạch* hoặc `git diff` sang một model khác và hỏi: *"Thay đổi này có thể sai/hỏng ở đâu? Đụng gì ngoài yêu cầu? Chấm rủi ro 1–5."*
- Hai AI bất đồng = chuông báo cho bạn dừng lại. Đây là tầng phát hiện lỗi *duy nhất* của bạn — đừng bỏ.

**2. Plan Mode — hỏi RỦI RO, không chỉ các bước.**
- `Shift+Tab` ×2 trước mọi việc không tầm thường. Yêu cầu kế hoạch nêu rõ:
  > "Nói bằng tiếng Việt dễ hiểu: thay đổi này người dùng sẽ thấy gì? Đụng vào file/khu vực nào? Nếu tôi sai thì hỏng cái gì? Có chạm auth / mã truy cập / dữ liệu người dùng / database không?"
- Bạn duyệt **mức rủi ro**, không duyệt code (bạn duyệt được "à cái này đụng login → cẩn thận").

**3. Kiểm bằng HÀNH VI, không bằng đọc code (bước thiêng — không bỏ).**
- Chạy thử thật:
  ```bash
  cd backend && uvicorn main:app --reload --port 8000      # cửa sổ 1
  cd frontend && python3 -m http.server                    # cửa sổ 2, rồi mở trình duyệt
  ```
- Bấm theo `SMOKE_TEST_CHECKLIST.md`. **Quan trọng nhất:** kiểm cả tính năng **CŨ** còn chạy không (lỗi hay nằm ở chỗ "tiện tay sửa luôn").

**4. CI phải XANH mới merge — lưới an toàn thật.**
- Không bao giờ merge PR đỏ. Không "tắt check cho qua". Bạn đã có sẵn 3 luồng CI (pytest + node --test + Playwright) — đây là guardrail chắc chắn mà **không cần đọc code**. Đề cao quy tắc này hơn mọi thứ.

**5. Mỗi feature: một spec 3 dòng + commit nhỏ.**
- Trước khi làm, tự viết (đây là thứ bạn đủ sức tự viết) vào `docs/specs/<tên>.md`:
  > • Điều gì PHẢI xảy ra · • Điều gì KHÔNG được đổi · • Làm sao biết nó chạy đúng
- Commit nhỏ sau mỗi phần xanh → lỡ sai thì `Esc Esc` (/rewind) hoặc `git revert` tức thì. **Khả năng vứt bỏ thay đổi trong 60 giây = kiểm soát thật cho người không chuyên.**

> Cắt bỏ khỏi thói quen hằng ngày: đọc-hiểu diff, TDD, lo chọn model, dọn nhánh. Năm việc trên là đủ.

---

## PHẦN 2 — DANH SÁCH "ĐỪNG ĐỘNG NẾU KHÔNG CÓ NGƯỜI/AI HỖ TRỢ"

**"Người / AI hỗ trợ" cụ thể là ai?**
- **AI hỗ trợ** = một model **KHÁC** model đang code (để soi độc lập): **Codex tự soi PR** (đã bật ở Phần 3D), hoặc tự tay dán `git diff`/kế hoạch sang **ChatGPT** hay **một cửa sổ Claude khác** rồi hỏi rủi ro. Đây là cái bạn **luôn có sẵn** — dùng cho mọi việc trong danh sách.
- **Người hỗ trợ** = một người **rành code hơn bạn**: bạn bè làm dev, hoặc **freelancer thuê theo buổi** (Upwork / Fiverr / cộng đồng dev Việt) review một lần — đặc biệt **đáng tiền cho auth và thanh toán**. Không bắt buộc, nhưng nên có cho 1–2 vùng rủi ro nhất.
- **Chưa có người?** Tối thiểu phải đủ 4 thứ: **2 AI khác nhau cùng đồng ý** + **có backup** + **test trên staging** + **ngủ một đêm** rồi mới merge.

Việc trong danh sách này → **bắt buộc** có ít nhất "AI hỗ trợ" soi (thói quen 1) + **ngủ một đêm** trước khi merge + **chắc chắn có backup**:

- **Đăng nhập / xác thực (auth)**
- **Quyền sở hữu mã truy cập** — `access_codes.is_used`, `used_by`, `used_at` (CLAUDE.md ghi rõ: *bất biến sau khi kích hoạt, không bao giờ xóa*)
- **Thanh toán / commission**
- **Database migration** (thêm/sửa/xóa bảng, cột)
- **Bất cứ thao tác XÓA dữ liệu người dùng**
- **Logic chấm điểm / feedback** (vì "trung thực, không gây hiểu lầm" là chất lượng AI, test không bắt được → phải tự đọc kết quả thật)

Mọi thứ ngoài danh sách → cứ làm nhanh.

---

## PHẦN 3 — THIẾT LẬP MỘT LẦN (3 việc, đã sửa theo phản biện)

Có thể nhờ chính Claude Code làm hộ từng cái (mở Plan Mode rồi dán yêu cầu).

### 3A. Thêm "Definition of Done" vào `CLAUDE.md` (versioned, lâu dài)
```markdown
## Definition of Done (trước khi báo "xong")
- Chạy backend: `cd backend && python -m pytest tests/ -q --ignore=tests/test_d1_e2e.py`
- Chạy frontend: `node --test` cho các test liên quan trong frontend/tests/
- KHÔNG sửa/skip/xfail/--ignore test để ép xanh. Test đỏ → sửa CODE.
- Trong Plan Mode: nêu thay đổi người-dùng-thấy bằng tiếng Việt TRƯỚC, rồi mới tới phần kỹ thuật.
```
> Vì sao: chuyển cổng test bạn-đã-có chạy **sớm (local)** để CI chỉ còn là *xác nhận*, đỡ tốn vòng chờ. **Lưu ý thật:** đây là lời dặn ~80% — nên phải có thêm 3B (cái chắc chắn).

### 3B. Guardrail CHẮC CHẮN (cái thực sự enforce)
**(i) `.claude/settings.local.json` — cho phép việc an toàn, chặn việc nguy hiểm:**
```json
{
  "permissions": {
    "allow": [
      "Bash(python -m pytest:*)",
      "Bash(node --test:*)",
      "Bash(git diff:*)", "Bash(git status:*)", "Bash(git add:*)",
      "Bash(npm run build:css:*)"
    ],
    "deny": [
      "Bash(rm -rf:*)",
      "Bash(git push --force:*)",
      "Read(./backend/.env)", "Write(./backend/.env)"
    ]
  }
}
```
> KHÔNG cho phép sẵn `uvicorn` (server chạy nền sẽ treo phiên). Deny-list là **chống tai nạn**, *không phải tường lửa bảo mật* — đừng ỷ lại.

**(ii) Một cách chạy test mà KHÔNG đốt thời gian:** thay vì Stop-hook-mỗi-lượt (đã bỏ), tạo slash command `/test` để bạn gõ khi muốn, hoặc một **git pre-push hook** chạy test 1 lần trước khi push. CI vẫn giữ cổng 224-test.

### 3C. ⭐ Đưa repo RA KHỎI thư mục đồng bộ + bật backup/staging (reviewer coi đây là thiếu sót lớn nhất)
**Vì sao gấp:** repo nằm trong `~/Documents` mà iCloud đang đồng bộ → sinh file trùng " 2" và có thể **làm hỏng `.git`**. Sửa tận gốc = đưa repo ra thư mục **không đồng bộ**.

#### (1) Di chuyển repo ra khỏi iCloud (Mac) — làm ĐÚNG THỨ TỰ, đừng bỏ bước
1. **Đẩy mọi thứ lên GitHub trước (lưới an toàn):**
   ```bash
   cd ~/Documents/ielts-speaking-coach
   git add -A && git commit -m "chore: snapshot truoc khi di chuyen repo"   # bỏ qua nếu git báo "nothing to commit"
   git push
   ```
2. **Tải hết file iCloud về máy** (tránh mất file chỉ-ở-mây): Finder → mở thư mục `ielts-speaking-coach` → chuột phải → **"Download Now"**. Đợi mọi biểu tượng ☁️ biến mất.
3. **Đóng các app đang mở repo:** Obsidian, Claude Code (gõ `/exit`), VS Code/editor.
4. **Tạo thư mục mới (không đồng bộ) và di chuyển:**
   ```bash
   mkdir -p ~/code
   mv ~/Documents/ielts-speaking-coach ~/code/
   ```
   > `~/code` nằm thẳng trong thư mục nhà → iCloud **không** đụng tới. `mv` di chuyển nguyên vẹn, **giữ toàn bộ lịch sử git**.
5. **Kiểm tra còn nguyên:**
   ```bash
   cd ~/code/ielts-speaking-coach && git status && git log -1 --oneline
   ```
   Thấy lịch sử git bình thường = xong.
6. **Kết nối lại nơi cũ:** Claude Code → `cd ~/code/ielts-speaking-coach && claude`; App Claude/Cowork → chọn lại (mount) thư mục ở `~/code/ielts-speaking-coach`; Obsidian → mở lại vault từ vị trí mới.
7. **Dọn rác cũ:** xóa 2 file `... 2.md/.yaml` trong `docs/clusters/18_x/` (đã hết bị sinh lại).

> Không cần tắt iCloud cho cả máy — chỉ cần **đừng để repo code trong `~/Documents` hay `~/Desktop`** khi iCloud bật. (Muốn tắt hẳn: System Settings → [tên bạn] → iCloud → iCloud Drive → Options → bỏ "Desktop & Documents Folders" — nhưng ảnh hưởng mọi tài liệu, nên di chuyển repo là đủ và an toàn hơn.)

#### (2) Bật backup database Supabase
- **Tối thiểu (dễ):** đảm bảo project ở **gói Pro** → Supabase tự **backup hằng ngày**. Kiểm tra: Dashboard → project → **Database → Backups** (thấy lịch sử backup).
- **Mạnh hơn (tùy chọn, tốn thêm phí):** bật **Point-in-Time Recovery (PITR)** để khôi phục tới *từng giây*: Dashboard → **Settings → Add-ons** → bật PITR (cần Small compute add-on; tính phí theo giờ; giữ 7 ngày, tăng tới 28). Lưu ý: bật PITR thì daily backup tự ngừng (PITR mịn hơn).
- **Trước mỗi thay đổi nhạy cảm:** tạo nhanh một bản backup tay (Database → Backups), hoặc nhờ Claude chạy `pg_dump`/export.

#### (3) Có "staging" — KHÔNG test trên dữ liệu thật
Nguyên tắc: **không bao giờ dogfood trên database production.** Tối thiểu:
- **Tạo một Supabase project riêng** tên `…-staging` (gói free cũng được) làm DB thử nghiệm.
- Chạy backend ở máy (`uvicorn`) trỏ vào DB staging qua `backend/.env` (đổi `SUPABASE_URL`/key sang project staging). Hỏng cũng không đụng dữ liệu user thật.
- **Frontend:** Vercel tự tạo **Preview Deployment** cho mỗi nhánh/PR → bản staging miễn phí. Bấm thử trên link preview trước khi merge.
- *(Nâng cao)* tạo thêm environment `staging` trên Railway cho backend nếu muốn staging chạy online.

#### (4) Lưu kế hoạch này vào repo
Lưu file `KE-HOACH-HANH-DONG-CUOI.md` thành `docs/ANDY_RUNBOOK.md` trong repo (versioned) — vì hook/settings trong `.claude/` **không lên git** (chỉ ở máy bạn).

### 3D. ⭐ Bật "AI thứ hai" TỰ SOI mọi PR (Cách A — không copy-paste) — từng bước

**Mục tiêu:** Claude Code làm → bạn push lên PR → **Codex (GPT) tự đọc diff và comment thẳng vào PR**. Bạn chỉ đọc nhận xét, **không dán gì**. Build bằng Claude + soi bằng Codex = hai model khác nhau → đúng "ý kiến độc lập". Bạn đã có sẵn Codex và `AGENTS.md` nên đây là lựa chọn khớp nhất.

**Bước thiết lập (làm 1 lần, ~10 phút):**
1. Đăng nhập **Codex** bằng tài khoản ChatGPT và **kết nối Codex cloud với repo GitHub** `ielts-speaking-coach` (cấp quyền GitHub cho repo). → https://developers.openai.com/codex/cloud
2. Mở trang **Codex settings → Code review:** https://chatgpt.com/codex/settings/code-review
3. **Bật "Code review"** cho repo của bạn.
4. **Bật "Automatic reviews"** → Codex tự review **mỗi PR mới**, không cần gõ lệnh gì.

**Dạy Codex soi đúng chỗ nhạy cảm** (thêm vào cuối `AGENTS.md` — file bạn đã có; Codex tự đọc mục này):
```markdown
## Review guidelines
- Mọi route phải có middleware xác thực bao quanh — cảnh báo nếu thiếu.
- access_codes.is_used / used_by / used_at BẤT BIẾN sau kích hoạt — cảnh báo nếu bị set/clear.
- Không log dữ liệu cá nhân (PII), không lộ key/token.
- Logic chấm điểm/feedback: cảnh báo nếu có thể tạo phản hồi sai hoặc gây hiểu lầm.
- Lỗi schema/migration đụng dữ liệu người dùng: coi là P1.
```

**Dùng hằng ngày (sau khi đã bật):**
1. Claude Code làm xong → commit nhỏ → `git push` nhánh.
2. Tạo PR: lên GitHub bấm **"Compare & pull request"** (hoặc `gh pr create` nếu có GitHub CLI).
3. **Đợi Codex tự comment** (nó thả 👀 rồi đăng review; chỉ gắn cờ **P0/P1** = lỗi nặng, nên ít nhiễu).
4. Muốn nó **sửa luôn**: comment trong PR `@codex fix lỗi P1` → Codex đẩy bản sửa lên nhánh.
5. Muốn soi lại/tập trung: gõ `@codex review` hoặc `@codex review for security regressions` trong PR.
6. **Chỉ merge khi:** CI xanh **+** Codex hết cờ P0/P1 **+** bạn đã bấm thử app thật.

**Phương án dự phòng** (không muốn dùng Codex): cài **CodeRabbit** hoặc **Gemini Code Assist** như một GitHub App — cũng tự review mọi PR, có bản miễn phí, cài 1 lần không cần cấu hình.

> Nhắc lại: review bot là tầng phát hiện lỗi *thêm*, **không phải bảo chứng**. Vẫn cần: test xanh + bấm thử thật + (việc nhạy cảm) có backup & ngủ một đêm trước khi merge.

---

## PHẦN 4 — DỌN MỘT LẦN RỒI QUÊN (ưu tiên thấp, làm khi rảnh)

Không phải việc đáng dành cả buổi. Nhờ Claude làm một lượt:
```bash
# Xóa các nhánh đã merge (an toàn — chỉ đụng nhánh đã gộp vào main)
git branch --merged main | grep -v '\*\|main' | xargs -n 1 git branch -d
```
- Xóa 2 file trùng `... 2.md / ... 2.yaml` trong `docs/clusters/18_x/` (sẽ tự hết sau khi làm 3C).

---

## PHẦN 5 — MODEL & CONTEXT (đừng lo nhiều)

- **Cứ để Sonnet** cho gần như mọi việc. Đừng dùng Haiku cho việc "có vẻ dễ" — dễ phải làm lại còn tốn hơn. Chỉ cân nhắc đổi khi `/usage` (giới hạn gói) làm bạn bất ngờ. (`/usage` = giới hạn gói; `/cost` = chỉ ước lượng tiền phiên.)
- **Context:** `/context` xem %, `/compact` khi ~60–70%, `/clear` khi đổi việc, `Esc Esc` (`/rewind`) để lùi. Chống mất trí nhớ thật sự = **ghi spec/kế hoạch ra file** (Phần 1.5).

---

## PHẦN 6 — NHỮNG ĐIỀU MÌNH NÓI THẬT (caveats mình từng nói chưa đủ rõ)

1. **AI vừa làm vừa tự giải thích KHÔNG phải là kiểm chứng độc lập.** Giữ AI thứ hai cho việc nhạy cảm.
2. **CLAUDE.md / Definition of Done chỉ được tuân phần lớn — không phải lệnh cứng.** Chỉ **hook + CI** mới chắc chắn.
3. **"Tất cả test xanh" ≠ an toàn.** Vẫn phải bấm thử thật, nhất là chất lượng feedback AI.
4. **Plan Mode có thể sai mà nghe vẫn rất hợp lý** → đừng gật bừa, luôn hỏi rủi ro/blast-radius.
5. **`/output-style explanatory` = nói nhiều hơn, không đúng hơn.** Đừng để lời giải thích mượt làm mất cảnh giác.
6. **Backup + staging quan trọng hơn mọi việc đọc diff.** Đây là thứ quyết định bạn sống sót sau một thay đổi sai.

---

## ✅ TÓM TẮT — LÀM 3 VIỆC TUẦN NÀY

1. **Phần 3C** — chuyển repo ra khỏi thư mục đồng bộ + bật backup Supabase + staging. *(An toàn nền tảng, quan trọng nhất.)*
2. **Phần 3A + 3B** — thêm Definition of Done vào CLAUDE.md + điền `settings.local.json` allow/deny. *(Cổng test sớm + chống tai nạn.)*
3. **Đổi sang 5 thói quen Phần 1** — đặc biệt 3 cái: **giữ AI thứ hai soi việc nhạy cảm**, **CI xanh mới merge**, **bấm thử app thật (cả tính năng cũ)**.

> Bạn đã có một "cỗ máy" tốt hơn phần lớn team có vốn. Việc cần không phải là *thêm công cụ*, mà là: chạy đúng cổng đã có trước khi báo "xong", bỏ copy-paste tay, và chuyển từ *hiểu code* sang *kiểm soát hậu quả*.

---
---

# PHỤ LỤC — SỔ TAY TƯƠNG TÁC VỚI CLAUDE CODE (tham khảo nhanh, bám repo của bạn)

> Mục này để bạn tra cứu: lúc mở dự án nên làm gì, phím tắt, slash command, dòng lệnh, và cách "nói chuyện" với Claude Code cho từng loại việc. Tất cả lệnh đã kiểm chứng (giữa 2026).

## PL-0. Lúc mới bắt đầu (làm khi mở dự án / máy mới)

| Bước | Gõ gì | Để làm gì |
|---|---|---|
| 1 | `cd ~/code/ielts-speaking-coach` → `claude` | Mở Claude Code ngay trong repo (nó tự đọc `CLAUDE.md` + 4 skill của bạn) |
| 2 | `/status` | Xem đang đăng nhập tài khoản nào, model nào, gói gì |
| 3 | `/model` → chọn **Sonnet** | Đặt model mặc định cho việc hằng ngày |
| 4 | `/agents` | Kiểm tra Claude có nhận 4 skill `/review /api-route /db-migrate /new-feature` không |
| 5 | `/permissions` | Xem danh sách cho phép/chặn (allow/deny) hiện tại |
| 6 | `/context` | Xem trí nhớ còn trống bao nhiêu trước khi bắt đầu |

> ⚠️ **Đừng gõ `/init`** — lệnh này tạo lại `CLAUDE.md` và sẽ **ghi đè** file 10KB bạn đã dày công có. Muốn sửa luật thì dùng `/memory` (mở `CLAUDE.md` ra sửa).

## PL-1. Phím tắt & ký hiệu phải nhớ

| Phím / ký hiệu | Làm gì | Khi nào dùng |
|---|---|---|
| **`Shift`+`Tab`** | Đổi chế độ: *thường* → *tự-duyệt-sửa* → **Plan Mode** (chỉ đọc, lập kế hoạch) | Nhấn 2 lần để vào Plan Mode **trước mọi việc** |
| **`Esc`** | Dừng Claude đang chạy | Khi nó làm sai/lan man, muốn ngắt |
| **`Esc` `Esc`** | Lùi lại (rewind) về tin nhắn trước, bỏ phần sau | Khi đi nhầm hướng nhưng muốn giữ context đầu |
| **`@`** | Gõ `@` + tên file → trỏ file cho Claude đọc, vd `@backend/routers/grading.py` | Cho nó đọc đúng file, **khỏi copy nội dung** |
| **`!`** | Gõ `!` + lệnh → chạy thẳng lệnh shell, vd `!git status` | Chạy lệnh terminal nhanh không qua AI |
| **`#`** | Gõ `#` + một câu → ghi câu đó vào `CLAUDE.md` | Khi muốn nhớ một luật lâu dài |
| **`Ctrl`+`V`** | Dán ảnh chụp màn hình (Mac dùng `Ctrl`, **không** `Cmd`) | Đưa ảnh lỗi UI / mockup cho nó xem |
| **`/`** | Mở danh sách slash command | Khi quên tên lệnh |

## PL-2. Slash command thiết yếu

**Dùng 90% thời gian:** `/clear` · `/compact` · `/model` · `/review` · (Plan Mode qua `Shift+Tab`)

| Lệnh | Làm gì | Khi nào |
|---|---|---|
| `/clear` | Xóa sạch trí nhớ phiên | Bắt đầu **việc mới không liên quan** |
| `/compact` | Nén bớt trí nhớ, giữ tiến độ | Khi context ~60–70% mà việc chưa xong |
| `/context` | Xem % trí nhớ đã dùng | Kiểm tra trước khi nó "quên" |
| `/rewind` | Lùi về điểm trước (cũng là `Esc Esc`) | Khi đi sai hướng |
| `/memory` | Mở `CLAUDE.md` để sửa luật | Khi muốn thêm/sửa quy tắc lâu dài |
| `/model` | Đổi model (Sonnet/Opus/Haiku) | Việc khó → Opus; thường → Sonnet |
| `/effort` | Chỉnh mức "suy nghĩ" | Việc cần nghĩ sâu (tùy model) |
| `/cost` | Xem tiền ước lượng phiên này | Theo dõi chi phí |
| `/usage` | Xem mức dùng so với **giới hạn gói** | Khi lo chạm trần gói |
| `/review` | **(của bạn)** soi bảo mật/schema/lỗi hay gặp | **Trước khi commit** |
| `/api-route` | **(của bạn)** tạo API route backend đúng convention | Khi thêm endpoint |
| `/db-migrate` | **(của bạn)** tạo migration Supabase | Khi đụng bảng/cột/index |
| `/new-feature` | **(của bạn)** build feature trọn gói DB→API→UI | Khi làm module mới |
| `/agents` | Xem/quản skill & subagent | Lúc đầu / khi thêm skill |
| `/permissions` | Xem/sửa allow-deny | Khi muốn chỉnh rào chắn |
| `/output-style` | Đổi giọng (vd explanatory) | Tùy chọn — *nhớ: nói nhiều ≠ đúng hơn* |
| `/resume` · `/status` · `/help` | Mở lại phiên cũ · xem trạng thái · trợ giúp | Khi cần |

## PL-3. Dòng lệnh terminal (CLI)

| Lệnh | Làm gì |
|---|---|
| `claude` | Mở phiên mới trong thư mục hiện tại |
| `claude "yêu cầu của mình"` | Mở kèm yêu cầu luôn |
| `claude -c` (`--continue`) | Tiếp tục **phiên gần nhất** ở thư mục này |
| `claude -r` (`--resume`) | Chọn lại **một phiên cũ** (hiện danh sách) |
| `claude --model sonnet` | Mở với model chỉ định (`opus`/`sonnet`/`haiku`) |
| `claude --permission-mode plan` | Mở **thẳng vào Plan Mode** (chỉ đọc, an toàn) |
| `claude --add-dir ../khac` | Cho Claude thấy thêm thư mục khác |
| `claude update` | Cập nhật Claude Code lên bản mới |
| `claude mcp` | Quản lý MCP server |

> ❌ Tránh `claude --dangerously-skip-permissions` (bỏ hết rào chắn) trừ môi trường cô lập.

## PL-4. THEO TỪNG LOẠI TÁC VỤ — tương tác sao cho hiệu quả

Mỗi việc: **Chế độ/lệnh** → **Mẫu câu** → **Xong khi**.

### A) Lên kế hoạch tính năng mới (dài hơi)
- **Chế độ:** `Shift+Tab`×2 (Plan Mode). Việc khó: thêm chữ *"think hard"* trong câu.
- **Mẫu:** *"Bật Plan Mode. Mình muốn [mô tả tính năng]. Đọc các file liên quan trước. Cho kế hoạch từng bước bằng tiếng Việt: người dùng thấy gì, đụng file/khu vực nào, nếu sai thì hỏng gì, có chạm auth/mã code/DB/dữ liệu người dùng không. CHƯA viết code. Lưu kế hoạch vào `docs/specs/[tên].md`."*
- **Xong khi:** bạn đọc kế hoạch, hiểu rủi ro, và đã có file spec.

### B) Build tính năng trọn gói (DB + API + UI)
- **Lệnh:** `/new-feature` (skill của bạn — tự đi đúng thứ tự migration → router → service → frontend).
- **Mẫu:** `/new-feature [mô tả tính năng + màn hình người dùng]`
- **Xong khi:** test xanh + bấm thử thật (PL Phần 1.3).

### C) Thêm 1 API route backend
- **Lệnh:** `/api-route` (tự theo auth pattern + Supabase, mount vào `main.py`).
- **Mẫu:** `/api-route [method + đường dẫn + làm gì + bảng dữ liệu]`
- **Xong khi:** `cd backend && python -m pytest tests/ -q --ignore=tests/test_d1_e2e.py` xanh.

### D) Thêm/sửa database (bảng, cột, index)
- **Lệnh:** `/db-migrate` (tự đánh số migration, theo convention SQL).
- **Mẫu:** `/db-migrate [thêm cột X vào bảng Y / tạo bảng Z ...]`
- **Xong khi:** migration chạy được. ⚠️ **Việc nhạy cảm** → xem mục J.

### E) Sửa bug
- **Chế độ:** Plan Mode trước (hiểu nguyên nhân rồi mới sửa). Bug UI → kèm ảnh (mục F).
- **Mẫu:** *"Bug: [hiện tượng]. Tái hiện: [các bước]. Tìm NGUYÊN NHÂN gốc trước, giải thích bằng tiếng Việt, đề xuất cách sửa nhỏ nhất. CHƯA sửa cho tới khi mình duyệt."*
- **Xong khi:** có test che lại bug đó + bấm thử hết lỗi.

### F) Sửa giao diện / UI
- **Cách:** chụp màn hình lỗi → `Ctrl+V` dán vào, hoặc trỏ `@dogfood/screenshots/loi.png`.
- **Mẫu:** *"Ảnh này là [trang gì]. Chỗ [mô tả] bị [vấn đề]. Sửa cho giống [mong muốn]. Nhớ chạy `npm run build:css` nếu đổi class Tailwind."*
- **Xong khi:** mở trình duyệt xem đúng + `node --test` test liên quan xanh.

### G) Viết / chạy test
- **Mẫu:** *"Viết test cho [hành vi]. Backend dùng pytest trong `backend/tests/`, frontend dùng `node --test` (.mjs) trong `frontend/tests/`. Chạy lại cho mình, đỏ thì sửa CODE — không sửa/skip test."*
- **Xong khi:** xanh thật (không phải skip).

### H) Review trước khi commit
- **Lệnh:** `/review` (skill của bạn). Việc nhạy cảm → thêm AI thứ hai (mục J).
- **Mẫu:** `/review` (tự đọc `git diff HEAD`) — hoặc `/review [dán đoạn cần soi]`
- **Xong khi:** không còn cảnh báo bảo mật/schema.

### I) Dogfood & ship (đưa lên)
- **Cách:** chạy thật rồi đẩy lên.
  ```bash
  cd backend && uvicorn main:app --reload --port 8000   # cửa sổ 1
  cd frontend && python3 -m http.server                 # cửa sổ 2 → mở trình duyệt
  ```
- Bấm theo `SMOKE_TEST_CHECKLIST.md` (kiểm cả tính năng **cũ**). Rồi: `git add` → commit nhỏ → push → tạo PR → **đợi CI xanh** → merge → (deploy theo `DEPLOY_CHECKLIST.md`).
- **Mẫu bàn giao:** *"Tóm tắt: vừa đổi gì, mình cần bấm thử màn nào, tính năng cũ nào có thể bị ảnh hưởng, bước tiếp theo (commit/PR/deploy)?"*

### J) ⭐ Việc NHẠY CẢM (auth, mã truy cập `is_used/used_by`, payment, migration, xóa dữ liệu, logic chấm điểm)
- **Cách:** Plan Mode → đọc kế hoạch → **dán kế hoạch/`git diff` sang một AI khác** hỏi rủi ro → **có backup** → ngủ một đêm → mới merge.
- **Mẫu (AI thứ hai):** *"Đây là kế hoạch/diff một thay đổi đụng [auth/payment/...]. Nó có thể sai/hỏng ở đâu? Đụng gì ngoài yêu cầu? Chấm rủi ro 1–5 và giải thích."*

### K) Hiểu codebase / "cái này chạy ra sao"
- **Cách:** chỉ hỏi, trỏ `@file` (không cần Plan Mode vì chỉ đọc).
- **Mẫu:** *"Đọc `@frontend/pages/practice.html` và `@backend/routers/grading.py`, giải thích luồng chấm điểm bằng tiếng Việt như nói với người không rành code."*

### L) Khi context gần đầy / đổi việc
- Cùng một việc, dài: `/compact`. Việc **mới khác hẳn**: `/clear`.

### M) Khi nó đi nhầm hướng
- `Esc` để dừng, `Esc Esc` để lùi về trước. Đừng để nó "cố sửa cho xong" theo hướng sai.

## PL-5. Mẫu câu (prompt) copy-paste nhanh

- **Lập kế hoạch:** *"Bật Plan Mode. Mình muốn [X]. Đọc file liên quan trước. Kế hoạch từng bước bằng tiếng Việt: người dùng thấy gì · đụng file/khu vực nào · nếu sai hỏng gì · có chạm auth/mã code/DB/dữ liệu người dùng không. CHƯA viết code."*
- **Soi rủi ro (AI thứ hai):** *"Đây là diff/kế hoạch của thay đổi '[X]'. Có thể sai/hỏng ở đâu? Đụng gì ngoài yêu cầu? Rủi ro 1–5, giải thích."*
- **Chạy kiểm tra:** *"Chạy `cd backend && python -m pytest tests/ -q --ignore=tests/test_d1_e2e.py` và `node --test` test liên quan. Đỏ thì sửa CODE (không sửa test). Báo kết quả."*
- **Giải thích cho người không chuyên:** *"Giải thích thay đổi này như nói với người không biết code. Có rủi ro gì không?"*
- **Bàn giao cuối:** *"Tóm tắt: vừa đổi gì · mình cần bấm thử màn nào · tính năng cũ nào có thể ảnh hưởng · bước tiếp theo (commit/PR/deploy)?"*

> **Quy tắc xương sống:** Việc thường → làm nhanh, Sonnet, để nó tự chạy. Việc **nhạy cảm (mục J)** → Plan Mode + AI thứ hai + backup. "Xong" = **test xanh + bấm thử thật + CI xanh**, không phải khi Claude *nói* xong.
