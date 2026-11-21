# UI state matrix

UI impact: N/A — không trạng thái giao diện nào đổi: mọi trang admin giữ URL, markup, stylesheet và thứ tự cascade; chỉ thư mục route group và layout chứa `AuthedShell` đổi. Bằng chứng "không đổi" là danh sách `<link rel="stylesheet">` trước/sau (Scenario 5), ảnh chụp mốc TESTPOLICY-0057 của 4 dự án (sáng/tối, desktop/điện thoại) và ảnh sau điều hướng client bằng sidebar (Scenario 2, 3). Trạng thái tải, rỗng, lỗi, quyền của từng trang do component trang sở hữu và không bị chạm.
