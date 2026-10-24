"""Bounded Cam19 editorial repair. Build from a captured bundle; never alter keys.

The caller owns environment selection and guarded persistence. This module has
no network access and does not change attempts, snapshots, audio or visibility.
"""
from copy import deepcopy
import re


def repair(baseline):
    data = deepcopy(baseline)

    def bundle(skill, number):
        return data[f"MOCK0016-PROD-20261006-ILR-{skill}-CAM-B19-T{number}-REV01"]

    def rq(test, number):
        return next(q for q in bundle("RDG", test)["items"] if q["q_num"] == number)

    def rs(test, number, **fields):
        rq(test, number)["payload"]["solution"].update(fields)

    def child(skill, test, part):
        key = "passage_order" if skill == "RDG" else "section_num"
        return next(c for c in bundle(skill, test)["children"] if c[key] == part)

    def ex(test, number):
        return next(e for e in bundle("LIS", test)["items"]
                    if any(q["q_num"] == number for q in e["payload"]["questions"]))["payload"]

    def lq(test, number):
        return next(q for q in ex(test, number)["questions"] if q["q_num"] == number)

    def ls(test, number, **fields):
        ex(test, number)["solutions"].setdefault(str(number), {}).update(fields)

    def replace(obj, field, old, new):
        assert old in obj[field], (field, old)
        obj[field] = obj[field].replace(old, new)

    def quote(skill, test, part, start, end):
        source = child(skill, test, part).get("body_markdown", child(skill, test, part).get("transcript"))
        source = re.sub(r"\(\s*/\s*\d+\s*\)\s*", "", source)
        a = source.index(start)
        b = source.index(end, a) + len(end)
        return source[a:b]

    # R-01: repair unambiguous sentence/paragraph boundaries, without claiming
    # that these editorial paragraphs reproduce the printed Cambridge edition.
    p = child("RDG", 1, 1)
    replace(p, "body_markdown", "underestimated The modification", "underestimated.\n\nThe modification")
    replace(p, "body_markdown", "Take the US professional", "\n\nTake the US professional")
    replace(p, "body_markdown", "At one time, all tennis rackets", "\n\nAt one time, all tennis rackets")
    p = child("RDG", 1, 3)
    for old, new in [
        ("* Misinformation -", "*\n\nMisinformation -"),
        ("only\n\nrecently", "only recently"),
        ("What about our second observation", "\n\nWhat about our second observation"),
        ("This leads us to our third observation", "\n\nThis leads us to our third observation"),
        ("countered Misinformation", "countered.\n\nMisinformation"),
    ]:
        replace(p, "body_markdown", old, new)
    rs(1, 11, steps='(1) Tìm cụm "natural gut made from the outer layer of sheep or cow intestines" trong bài. (2) "the ____ of animals" khớp với bộ phận nguồn gốc của dây tự nhiên. (3) ONE WORD ONLY: dùng intestines (dạng số nhiều như bài) hoặc gut (danh từ không đếm được trong ngữ cảnh này). Không đổi gut thành guts.')
    for n in (20, 21):
        rs(1, n, source_excerpt=quote("RDG", 1, 2, "While the Mediterranean region", "local coastline and sailing routes."),
           steps="(1) Đoạn B đối lập vùng màu mỡ với những nơi gồ ghề, đồi núi. (2) Cư dân những nơi đó phụ thuộc nhiều vào tài nguyên biển và có thuyền, kỹ năng đi biển. (3) Đây là cầu nối tới phương án về địa hình gây khó khăn cho canh tác; không chỉ dựa vào một chữ marine.")
    p = child("RDG", 2, 1)
    replace(p, "body_markdown", "agrarian*", "agrarian")
    replace(p, "body_markdown", '"Luddites\'', "'Luddites'")
    rs(2, 10, tips="Với một nhận định so sánh, tìm bằng chứng so sánh trực tiếp hoặc suy ra hợp lệ từ bài. Mô tả riêng hai hệ thống không đủ để kết luận hệ nào đáng tin cậy hơn.",
       trap_analysis="Bài nêu các nhà phát minh và thời gian phát triển hệ thống, nhưng không so sánh độ tin cậy của Morse với Cooke và Wheatstone. Thiếu chính quan hệ more reliable, nên NOT GIVEN.")
    rs(2, 15, source_excerpt=quote("RDG", 2, 2, "F But there are many ways", "practise coping with stress."))
    rs(2, 18, source_excerpt=quote("RDG", 2, 2, "Positive stress responses can be promoted", "rather than nerves."))
    rs(2, 17, steps="(1) Câu hỏi cần kết quả nghiên cứu về mối liên hệ phản ứng stress và thành tích. (2) Đoạn C nêu trực tiếp Research shows: challenge dẫn tới thành tích tốt, threat dẫn tới kém hơn. (3) Đoạn D dễ nhầm vì cũng bàn thành tích, nhưng tập trung cơ chế hormone và phản ứng sinh lý. Chọn C theo ý được hỏi.")
    rs(2, 34, trap_analysis="NOT GIVEN: bài kể các thất bại thời trẻ của Einstein nhưng không quy nguyên nhân cho thiếu tự tin. Không suy ra một nguyên nhân tâm lý chỉ từ việc ông từng thất bại.")
    rs(2, 36, trap_analysis="NOT GIVEN: lời Einstein phân biệt intellect và character không cho biết ông buồn bực về cách công chúng nhìn nhận công trình của mình. Thiếu phản ứng cảm xúc mà nhận định yêu cầu.")
    rs(2, 38, trap_analysis="C khớp curiosity và các thái độ học tập cần được phát triển. Bài không yêu cầu kỷ luật nghiêm khắc (A), trợ giúp của bạn học (B) hay phải hơn người khác (D).")
    rs(2, 39, trap_analysis="B khớp việc tài năng độc đáo bẩm sinh không nằm ở cốt lõi của thành tích chuyên gia. Không có kết luận học sinh giỏi không cần cải thiện trí nhớ (A); luyện thể chất (C) không phải kết quả chính; con số giờ luyện tập không bảo đảm tạo ra thiên tài (D).")
    rs(2, 40, trap_analysis="D: người lớn coi trọng và hỗ trợ giáo dục là điểm chung trong phỏng vấn. Người đó có thể thuộc gia đình hoặc cộng đồng; không nhất thiết hơn một phụ huynh (B). Chế độ ăn (A) và cơ sở được tài trợ tốt (C) không phải điều đoạn này nêu.")
    rs(3, 5, tips="No coincidence ở đây hỗ trợ nhận định có mối liên hệ. Cụm này tự nó không chứng minh một quan hệ nhân quả phổ quát.",
       trap_analysis="According to the researchers và no coincidence cho thấy các nhà nghiên cứu tin có liên hệ giữa những thay đổi cùng thời kỳ. Statement chỉ hỏi connection, nên TRUE; không cần diễn giải mạnh hơn thành chứng minh nguyên nhân.")
    rs(3, 13, trap_analysis="Spices được nêu trực tiếp trong historic trade in spices và khớp sale trong notes. Bằng chứng này xác định mặt hàng buôn bán; không chứng minh riêng một hoạt động sản xuất của nhóm người đó.")
    rs(3, 35, vocab=["substitute (n.) = thứ thay thế", "subtle (adj.) = tinh tế", "vital (adj.) = thiết yếu", "replace (v.) = thay thế"])
    for test, number in ((3, 29), (4, 28), (4, 36)):
        rq(test, number)["prompt"] = rq(test, number)["prompt"].replace("*", "")
    rs(4, 31, question_text="Contemporary hunter-gatherer societies tend to exhibit a high level of 31 ____ in all areas of life.")
    rs(4, 28, question_text="What point is made about Richard Dawkins' book The Selfish Gene?")
    p = child("RDG", 4, 1)
    p["body_markdown"] = p["body_markdown"].replace('"just right\'', "'just right'")
    p = child("RDG", 4, 2)
    replace(p, "body_markdown", '"de-watered\'', "'de-watered'")
    p = child("RDG", 4, 3)
    replace(p, "body_markdown", "'environment of evolutionary adaptedness.", "'environment of evolutionary adaptedness'.")
    rs(4, 11, source_excerpt=quote("RDG", 4, 1, "Many of Britain's single-generation", "population increases."))
    rs(4, 20, source_excerpt=quote("RDG", 4, 2, "B 'We're looking", "he argues."),
       steps="(1) Upton muốn khảo sát tiềm năng thuốc trước khi môi trường biển bị phá hủy. (2) Ông gọi đó là a better way of exploiting the economic potential, so với khai thác khoáng sản. (3) Better way chính là cầu nối tới more worthwhile trong câu hỏi; chọn B.")
    rs(4, 30, steps="(1) Knauft mô tả các xã hội săn bắt hái lượm có mức bình đẳng rất cao. (2) Tác giả dùng lối sống này để đối chiếu với xã hội cạnh tranh và ích kỷ xuất hiện sau đó. (3) Lập luận là ích kỷ không phải đặc tính cố định từ đầu mà phát triển tương đối gần đây; không có nghĩa chỉ cộng đồng cô lập mới có thể sống vị tha.")
    rs(4, 36, trap_analysis="NOT GIVEN: tác giả thuật lại niên đại mà nhiều nhà nhân học tin là thời điểm các xã hội như !Kung bắt đầu suy giảm. Bài không nói họ nhầm về niên đại đó; việc nhắc quan điểm của họ không tự tạo thành bất đồng.")
    rs(4, 39, trap_analysis="NOT GIVEN: bài mô tả một thay đổi trong lịch sử dẫn tới các đặc tính tiêu cực ở một số nhóm. Điều đó không so sánh mức độ biểu hiện của các đặc tính này giữa những nền văn hóa hiện đại.")

    # LT-01: annotation fragments are not spoken words. Remove only this
    # exact damaged annotation pattern in the four affected sections.
    for test, part in ((1, 3), (2, 2), (3, 2), (4, 2)):
        c = child("LIS", test, part)
        c["transcript"], count = re.subn(r"\(\s*/\s*\d+\s*\)\s*", "", c["transcript"])
        assert count > 0

    # UI-05: each address line is an authored form row.
    rows = ex(2, 3)["template"]["rows"]
    place = next(i for i, row in enumerate(rows) if row.get("label") == "Place")
    rows[place:place + 1] = [{"label": "Place", "q_num": 3, "prefix": "the"},
                            {"q_num": 4, "prefix": "", "suffix": "Street"},
                            {"text": "First floor, Room T347"}]
    # L1-02: keep negation and grammatical dependencies in one note.
    groups = ex(1, 31)["template"]["groups"]
    groups[0]["items"][0:2] = [{"q_num": 31, "prefix": "In the 1930s, a local teacher realised that stones beneath the bog surface were once", "suffix": ""}]
    groups[1]["items"][-2:] = [{"q_num": 38, "prefix": "The fields were probably used to restrict the grazing of animals — no evidence of structures to house them during", "suffix": ""}]
    lq(1, 31)["prompt"] = "Discovery: In the 1930s, a local teacher realised that stones beneath the bog surface were once ___"
    lq(1, 38)["prompt"] = "The fields were probably used to restrict grazing — no evidence of structures to house animals during ___"
    ls(1, 34, trap="A lack of trong đề tương ứng deficiency of oxygen trong transcript. Acidity là một nguyên nhân khác được nêu, không phải chữ đã in sẵn trong đề. Giữ oxygen cho chỗ trống.")
    ls(1, 9, trap="Ký hiệu £ đã có sẵn trong đề: chỉ nhập 4.95. Con số 30 là điều kiện về số trẻ, không phải chi phí mỗi trẻ.")
    s = ex(1, 28)["solutions"]["28"]
    replace(s, "script", "on ________ I bought", "on... I bought")
    ls(1, 25, trap="Không chọn G về quy định chặt hơn: quy định được nhắc ở chủ đề bao bì Q26. Ở Q25, Marie và Colin nói các cửa hàng cần chủ động khuyến khích dùng sản phẩm địa phương.")
    for n in (21, 22):
        ls(1, n, script=quote("LIS", 1, 3, "**Colin:** Yes. It's been hard work", "thrown away otherwise."))
    for n in (23, 24):
        ls(1, n, script=quote("LIS", 1, 3, "**Marie:** No, things like milk", "how many kilograms a joint of meat is, for example."))
    ls(1, 12, why_correct=ex(1, 12)["solutions"]["12"]["why_correct"].replace("cây bạch dương", "cây dương (poplar)"))
    s = ex(1, 12)["solutions"]["12"]
    s["vocab_focus"] = s["vocab_focus"].replace("cây bạch dương / cây dương", "cây dương (poplar)")
    s["translation_vi"] = s["translation_vi"].replace("cây bạch dương", "cây dương (poplar)")
    # Exact source excerpts for both slots of each accepted unordered pair.
    for n in (17, 18):
        ls(2, n, script=quote("LIS", 2, 2, "The training we get", "storm at night, for example."))
    for n in (19, 20):
        ls(2, n, script=quote("LIS", 2, 2, "Since I started, I've had", "huge difference to the outcome."))
    ls(2, 12, trap="B: người tài trợ là a generous member of the public who'd lived here all her life, một cư dân địa phương. Lifeboat Institution là tổ chức từ thiện nhận khoản quyên góp; charity không bị phủ định. Rather than government funding loại nguồn ngân sách chính phủ, không phủ định tư cách từ thiện của bên nhận.",
       trap_mechanisms="Phân biệt bên tài trợ (cư dân địa phương) với bên nhận (charity); government funding là phương án nguồn tiền bị loại.")
    ls(2, 15, trap="David phải kiểm tra thiết bị còn hoạt động và quyết định có an toàn để hạ thủy hay không. Sức chứa áo phao chỉ là chi tiết thiết bị, không phải một trách nhiệm riêng. C đúng; kiểm tra thiết bị không đồng nghĩa quyết định mang thiết bị gì (B), và chọn thành viên tổ lái (A) không được nêu.")
    ls(2, 16, why_correct='David says he speaks to youth groups and sailing clubs about problems at sea: A. Fundraising is attributed to volunteers, but is not stated as one of David\'s roles; recruitment is not mentioned.\n\nDavid nói anh trò chuyện với các nhóm thanh thiếu niên và câu lạc bộ thuyền về rủi ro trên biển: A. Transcript nêu tình nguyện viên gây quỹ, nhưng không nêu đây là vai trò của David. Không suy ra rằng anh chắc chắn không bao giờ gây quỹ.',
       trap="Loại B vì fundraising không được nêu là công việc của David, không phải vì transcript chứng minh anh không làm việc đó. C không được nhắc; A có bằng chứng trực tiếp.",
       trap_mechanisms="Đối chiếu đúng người với vai trò được nêu; không biến thông tin vắng mặt thành phủ định tuyệt đối.")
    ls(2, 21, why_correct='Don initially thinks there is not enough to say about the topic: limited in scope, A. He calls it interesting, so C does not fit. He does not state that research difficulty was his initial concern; wanting to research more does not prove research is easy.\n\nBan đầu Don lo không đủ điều để nói: phạm vi quá hẹp, A. Anh thấy chủ đề thú vị nên không khớp C. Anh không nêu khó nghiên cứu là lo ngại ban đầu; muốn nghiên cứu thêm không chứng minh việc nghiên cứu dễ.',
       trap="A có bằng chứng trực tiếp isn't enough to say about it. Quite interesting loại boring (C). B không được nêu là lo ngại ban đầu; không lấy keen to research more làm bằng chứng rằng nghiên cứu dễ.")
    ls(2, 22, why_correct='Don asks whether trainers look "a bit casual for school uniform" and says they are not right for it. Bella thinks some look quite smart on pupils. The disagreement concerns suitability for school, B. A is about popularity only; Don\'s hard-wearing comment is not evidence of Bella\'s agreement about durability.\n\nDon hỏi giày có "a bit casual for school uniform" không và nói không phù hợp; Bella cho rằng vài đôi trông khá lịch sự trên học sinh. Bất đồng là mức phù hợp với trường, B. A chỉ hỏi độ phổ biến; lời Don về độ bền không chứng minh Bella đồng ý về độ bền.',
       trap="Hai người công nhận độ phổ biến, không bất đồng ở A. Don nói a bit casual, Bella nói quite smart: đây là bất đồng về B. Không có tranh luận về tốc độ mòn ở C.",
       trap_mechanisms="Actually đánh dấu Bella đưa quan điểm đối lập về độ phù hợp với trường; không gộp độ phổ biến và độ bền vào phương án A.")
    ls(2, 24, why_correct='Bella says "That didn\'t surprise me" about increased sales. Don replies "No. But then..." and identifies the fall in recycled footwear from 11% to 6% as what does not make sense. This directly supports B.\n\nBella là người nói "That didn\'t surprise me" về doanh số tăng. Don đáp "No. But then..." rồi nêu lượng tái chế giảm từ 11% xuống 6% là điều vô lý. Đó là bằng chứng trực tiếp cho B.',
       trap="Không gán That didn't surprise me cho Don: câu đó của Bella. Don đồng tình bằng No, rồi chuyển bằng But then sang điều khiến anh khó hiểu: tỷ lệ tái chế giảm. C về lượng vứt bỏ không được nêu.",
       trap_mechanisms="Theo đúng lượt Bella → Don; But then và doesn't seem to make sense xác định thông tin gây khó hiểu.")
    ls(2, 32, trap="Short là tính từ bổ nghĩa round body; rounded đã khớp round in sẵn. Barrel cũng chỉ có một từ, nhưng thuộc phép so sánh a bit like a barrel, không phải tính chất cần điền. Loại barrel vì nghĩa và cấu trúc, không vì giới hạn từ.")
    s = ex(2, 33)["solutions"]["33"]
    replace(s, "trap", "what they **are** discs", "what they **have are** discs")
    ls(2, 29, why_correct='Bella states that buyers did not refuse the shoes because of germs; the pairs were not identical. This directly supports C. Don guesses at hygiene (A) and earlier expects that parts could be matched, but his predictions are not verified findings about the project.\n\nBella nêu người mua không từ chối vì vi trùng, mà vì hai chiếc trong một đôi không giống hệt nhau: C. Don đoán về vệ sinh (A) và trước đó nghĩ có thể ghép đủ bộ phận, nhưng dự đoán của anh không phải kết quả đã được xác nhận về dự án.',
       trap="Don dự đoán người mua lo vi trùng, không khẳng định nguyên nhân đã được xác nhận. Bella nêu people didn't refuse them for that reason và lý do các đôi giày không giống hệt nhau: C. Không biến suy đoán của Don thành kết quả điều tra.")
    ls(2, 30, why_correct='Bella proposes a very different approach and Don agrees with "Absolutely": a new angle, A. Images are not mentioned. The comment that the topic is not simple does not establish that their presentation will lack clarity; C is simply not the approach they agree on here.\n\nBella đề xuất a very different approach, Don đáp Absolutely: góc nhìn mới, A. Không nhắc hình ảnh. Chủ đề không đơn giản không đồng nghĩa cách trình bày thiếu rõ ràng; C không phải cách họ thống nhất ở đây.',
       trap="A khớp trực tiếp different approach. B không được nhắc. Không suy từ độ phức tạp của chủ đề sang độ đơn giản hay rõ ràng của cách trình bày để loại C.",
       trap_mechanisms="A new angle ↔ a very different approach; phân biệt đặc điểm chủ đề với cách trình bày.")

    # L3-01: the non-gap control-group step is explicitly supported by S3.
    p = ex(3, 26)
    p["template_kind"] = "flow_chart_completion"
    p["metadata"]["flow_direction"] = "top_to_bottom"
    p["template"] = {"heading": "Procedure for the experiment", "steps": [
        {"q_num": 26, "prefix": "Choose mice which are all the same", "suffix": ""},
        {"q_num": 27, "prefix": "Divide the mice into two groups, each with a different", "suffix": ""},
        {"text": "Put each group in a separate cage. Feed group A ordinary mouse food (dry pellets)."},
        {"q_num": 28, "prefix": "Feed group B the same, but also sugar contained in", "suffix": ""},
        {"text": "Weigh the mice once a week using an electronic balance."},
        {"q_num": 29, "prefix": "Place them in a weighing chamber to prevent", "suffix": ""},
        {"q_num": 30, "prefix": "Do all necessary", "suffix": ""},
    ]}
    for n in (17, 18):
        ls(3, n, script=quote("LIS", 3, 2, "It's basically the teenage diary", "black and white stick drawings of the boy with his friends and teachers."))
    for n in (19, 20):
        ls(3, n, script=quote("LIS", 3, 2, "If you don't have time for this", "Librarians should be able to help you with this."))
    lq(3, 2)["prompt"] = "Fish market: cross the ___; the market is then on the right"
    next(i for g in ex(3, 2)["template"]["groups"] for i in g["items"] if i.get("q_num") == 2)["suffix"] = "; the market is then on the right"
    ls(3, 2, why_correct='"Go over the bridge" matches "cross the ___", so the noun is bridge. "On the right" describes the market\'s position after crossing; it does not mean the instruction "turn right".\n\n"Go over the bridge" khớp "cross the ___", nên điền bridge. "On the right" nói vị trí chợ sau khi qua cầu, không đồng nghĩa chỉ dẫn rẽ phải.',
       trap="Cross the ↔ go over the là cặp diễn đạt tương đương ở đây. Phân biệt on the right (vị trí bên phải) với turn right (rẽ phải).")
    ls(3, 13, trap="Count on me nói về friendship và nhóm tuổi 13–14; không nói new relationships. Chi tiết nhóm tuổi hỗ trợ F trực tiếp. Không chỉ dựa vào chủ đề tình bạn để chọn phương án về loại quan hệ hay cảm xúc không được nêu.")
    ls(3, 21, trap="A không khớp đánh giá the results weren't too bad; câu này không cung cấp mốc trước để chứng minh có tiến bộ theo thời gian. B bị loại trực tiếp bởi I don't have discipline problems as such. No real engagement hỗ trợ C.")
    ls(3, 31, trap="Clothing và clothes đều là một từ, nên giới hạn ONE WORD không phân biệt chúng. Dùng clothing, danh từ không đếm được được nói trong synthetic clothing. Lời giải này không mở rộng hoặc thay đổi danh sách biến thể được chấm.")

    # L4-01: each recommendation is complete; nested examples remain attached
    # to the benefit they illustrate. The existing ten numbered slots stay put.
    ex(4, 31)["template"]["groups"] = [
        {"heading": "Reforestation projects should:", "items": [
            {"text": "include a range of tree species"},
            {"q_num": 31, "prefix": "not include invasive species because of possible", "suffix": "with native species"},
            {"q_num": 32, "prefix": "aim to capture carbon, protect the environment and provide sustainable sources of", "suffix": "for local people"},
            {"q_num": 33, "prefix": "use tree seeds with a high genetic diversity to increase resistance to", "suffix": "and climate change"},
            {"q_num": 34, "prefix": "plant trees on previously forested land which is in a bad condition, not select land which is being used for", "suffix": ""}]},
        {"heading": "Large-scale reforestation projects", "items": [
            {"q_num": 35, "prefix": "Base planning decisions on information from accurate", "suffix": ""},
            {"q_num": 36, "prefix": "Drones are useful for identifying areas in Brazil which are endangered by keeping", "suffix": "and illegal logging."}]},
        {"heading": "Lampang Province, Northern Thailand", "items": [
            {"text": "A forest was restored in an area damaged by mining."},
            {"text": "A variety of native fig trees were planted, which are important for:", "items": [
                {"text": "supporting many wildlife species"},
                {"q_num": 37, "prefix": "increasing the", "suffix": "of recovery by attracting animals and birds", "items": [
                    {"q_num": 38, "prefix": "e.g.,", "suffix": "were soon attracted to the area."}]}]}]},
        {"heading": "Involving local communities", "items": [
            {"q_num": 39, "prefix": "Destruction of mangrove forests in Madagascar made it difficult for people to make a living from", "suffix": ""}]},
        {"heading": "The mangrove reforestation project", "items": [
            {"text": "provided employment for local people"}, {"text": "restored a healthy ecosystem"},
            {"q_num": 40, "prefix": "protects against the higher risk of", "suffix": ""}]},
    ]
    prompts = {31: "Reforestation projects should not include invasive species because of possible ___ with native species",
               32: "Reforestation projects should provide sustainable sources of ___ for local people",
               33: "Use tree seeds with a high genetic diversity to increase resistance to ___ and climate change",
               36: "Drones identify areas in Brazil endangered by keeping ___ and illegal logging",
               39: "Destruction of mangrove forests made it difficult for local people to make a living from ___",
               40: "The mangrove reforestation project: protects against the higher risk of ___"}
    for n, prompt in prompts.items():
        lq(4, n)["prompt"] = prompt
    ls(4, 6, why_correct='The spoken number is oh-four-one-two double-six-five nine-oh-three: 0412 665 903. The accepted continuous form 0412665903 contains all ten digits, including the initial zero.\n\nSố được đọc là oh-four-one-two double-six-five nine-oh-three: 0412 665 903. Dạng liền 0412665903 được chấp nhận, giữ đủ mười chữ số và số 0 đầu. Không bỏ hoặc gộp chữ số khi giải mã double-six.')
    ls(4, 19, why_correct='Liz felt like giving up halfway through and says only the spectators\' support kept her going: C. She had not dreamed of running a marathon, so A does not fit. The transcript says her husband ran marathons; it does not state that he persuaded her, so B is unsupported.\n\nLiz muốn bỏ cuộc giữa chừng và chỉ tiếp tục nhờ khán giả: C. Cô chưa từng mơ mình sẽ chạy marathon nên không khớp A. Transcript chỉ nói chồng từng chạy marathon; không nêu ông thuyết phục cô, nên B thiếu bằng chứng.',
       trap="Không nêu husband persuaded her không đồng nghĩa chứng minh husband did not persuade her. Chọn C theo bằng chứng trực tiếp felt like giving up và support of the spectators.")
    ls(4, 20, why_correct='Liz recommends registering for a 5K after a few weeks of training: B. Her own 10K after six months was "not something I\'d necessarily recommend", a qualified reservation rather than an absolute ban. Signing up and the later race date are different; she allows at least a couple of months to prepare.\n\nLiz khuyên đăng ký 5K sau vài tuần tập: B. Cô nói về 10K sau sáu tháng là "not something I\'d necessarily recommend", một lời dè dặt chứ không cấm tuyệt đối. Đăng ký và ngày thi khác nhau; cô khuyên dành ít nhất vài tháng để chuẩn bị.')
    ls(4, 7, vocab_focus=ex(4, 7)["solutions"]["7"].get("vocab_focus", "") + "\n- sell-by date: mốc để cửa hàng bán hàng; không đồng nghĩa use-by date (hạn sử dụng).")
    s = ex(4, 16)["solutions"]["16"]
    if "translation_vi" in s:
        s["translation_vi"] = 'James từng rất ghét ý nghĩ chạy bộ, nhưng một người bạn khuyến khích anh đến một buổi thử. Từ đó anh tiếp tục gắn bó và tiến bộ. Anh không bỏ buổi tập nào dù công việc rất bận.'
    s["vocab_focus"] = s.get("vocab_focus", "") + "\n- hasn't looked back: từ đó tiếp tục gắn bó, tiến lên thuận lợi; không dịch theo nghĩa đen là không nhìn lại."
    p = ex(4, 15)
    if "You may use any letter more than once" not in p["instruction"]:
        p["instruction"] += " You may use any letter more than once."

    # Remove only Markdown wrappers from plain-text context fields and known
    # stray underscore wrappers. Leave authored rich explanation formatting.
    for test in range(1, 5):
        for e in bundle("LIS", test)["items"]:
            p = e["payload"]
            p["instruction"] = p["instruction"].replace("*", "")
            for q in p["questions"]:
                q["prompt"] = q["prompt"].replace("*", "")
            for solution in p["solutions"].values():
                for key, value in list(solution.items()):
                    if isinstance(value, str):
                        value = re.sub(r"_(harbou?r|fertilisers|fertilizers)_", r"\1", value)
                        if key == "trap":
                            value = re.sub(r"\s*Đánh vào\s+[^.\n]*\.?", "", value)
                        solution[key] = value

    # Non-negotiable preservation: the 320 key objects and exercise identities.
    for code, old in baseline.items():
        new = data[code]
        assert old["test"] == new["test"]
        assert [q["id"] for q in old["items"]] == [q["id"] for q in new["items"]]
        for a, b in zip(old["items"], new["items"]):
            if old["skill"] == "reading":
                assert a["answer"] == b["answer"]
                assert a["question_type"] == b["question_type"]
            else:
                assert a["payload"]["answers"] == b["payload"]["answers"]
                assert a["payload"].get("audio_windows") == b["payload"].get("audio_windows")
    return data
