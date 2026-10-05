-- Freeze the policy and exact reference of compatible test-linked Dictation.
-- Additive only: no backfill, new starts, regrading or report mutation occurs.
-- NULL/NULL is the deployed whitespace policy, never inferred from time.
BEGIN;

ALTER TABLE public.dictation_attempts
    ADD COLUMN IF NOT EXISTS grading_version TEXT,
    ADD COLUMN IF NOT EXISTS reference_sha256 TEXT;
ALTER TABLE public.dictation_attempt_answers
    ADD COLUMN IF NOT EXISTS grading_version TEXT,
    ADD COLUMN IF NOT EXISTS reference_sha256 TEXT,
    ADD COLUMN IF NOT EXISTS sentence_reference_sha256 TEXT,
    ADD COLUMN IF NOT EXISTS grading_evidence JSONB;
ALTER TABLE public.dictation_sessions
    ADD COLUMN IF NOT EXISTS grading_version TEXT,
    ADD COLUMN IF NOT EXISTS reference_sha256 TEXT;

-- The lexical class is pinned Unicode15 L*/N*, identical to the Python policy.
-- POSIX alnum varies by locale: it rejects superscript/fraction numbers and may
-- accept combining marks. Range SHA-256: bcc920a2c9b9f7329585a1aa09fc8867dd252f24c1c75f9f6c90c3ebd5edec15
CREATE OR REPLACE FUNCTION public.fn_dictation_has_lexical_words(p_raw TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM regexp_split_to_table(p_raw, '') AS characters(value)
        WHERE ascii(value) <@ '{[48,58),[65,91),[97,123),[170,171),[178,180),[181,182),[185,187),[188,191),[192,215),[216,247),[248,706),[710,722),[736,741),[748,749),[750,751),[880,885),[886,888),[890,894),[895,896),[902,903),[904,907),[908,909),[910,930),[931,1014),[1015,1154),[1162,1328),[1329,1367),[1369,1370),[1376,1417),[1488,1515),[1519,1523),[1568,1611),[1632,1642),[1646,1648),[1649,1748),[1749,1750),[1765,1767),[1774,1789),[1791,1792),[1808,1809),[1810,1840),[1869,1958),[1969,1970),[1984,2027),[2036,2038),[2042,2043),[2048,2070),[2074,2075),[2084,2085),[2088,2089),[2112,2137),[2144,2155),[2160,2184),[2185,2191),[2208,2250),[2308,2362),[2365,2366),[2384,2385),[2392,2402),[2406,2416),[2417,2433),[2437,2445),[2447,2449),[2451,2473),[2474,2481),[2482,2483),[2486,2490),[2493,2494),[2510,2511),[2524,2526),[2527,2530),[2534,2546),[2548,2554),[2556,2557),[2565,2571),[2575,2577),[2579,2601),[2602,2609),[2610,2612),[2613,2615),[2616,2618),[2649,2653),[2654,2655),[2662,2672),[2674,2677),[2693,2702),[2703,2706),[2707,2729),[2730,2737),[2738,2740),[2741,2746),[2749,2750),[2768,2769),[2784,2786),[2790,2800),[2809,2810),[2821,2829),[2831,2833),[2835,2857),[2858,2865),[2866,2868),[2869,2874),[2877,2878),[2908,2910),[2911,2914),[2918,2928),[2929,2936),[2947,2948),[2949,2955),[2958,2961),[2962,2966),[2969,2971),[2972,2973),[2974,2976),[2979,2981),[2984,2987),[2990,3002),[3024,3025),[3046,3059),[3077,3085),[3086,3089),[3090,3113),[3114,3130),[3133,3134),[3160,3163),[3165,3166),[3168,3170),[3174,3184),[3192,3199),[3200,3201),[3205,3213),[3214,3217),[3218,3241),[3242,3252),[3253,3258),[3261,3262),[3293,3295),[3296,3298),[3302,3312),[3313,3315),[3332,3341),[3342,3345),[3346,3387),[3389,3390),[3406,3407),[3412,3415),[3416,3426),[3430,3449),[3450,3456),[3461,3479),[3482,3506),[3507,3516),[3517,3518),[3520,3527),[3558,3568),[3585,3633),[3634,3636),[3648,3655),[3664,3674),[3713,3715),[3716,3717),[3718,3723),[3724,3748),[3749,3750),[3751,3761),[3762,3764),[3773,3774),[3776,3781),[3782,3783),[3792,3802),[3804,3808),[3840,3841),[3872,3892),[3904,3912),[3913,3949),[3976,3981),[4096,4139),[4159,4170),[4176,4182),[4186,4190),[4193,4194),[4197,4199),[4206,4209),[4213,4226),[4238,4239),[4240,4250),[4256,4294),[4295,4296),[4301,4302),[4304,4347),[4348,4681),[4682,4686),[4688,4695),[4696,4697),[4698,4702),[4704,4745),[4746,4750),[4752,4785),[4786,4790),[4792,4799),[4800,4801),[4802,4806),[4808,4823),[4824,4881),[4882,4886),[4888,4955),[4969,4989),[4992,5008),[5024,5110),[5112,5118),[5121,5741),[5743,5760),[5761,5787),[5792,5867),[5870,5881),[5888,5906),[5919,5938),[5952,5970),[5984,5997),[5998,6001),[6016,6068),[6103,6104),[6108,6109),[6112,6122),[6128,6138),[6160,6170),[6176,6265),[6272,6277),[6279,6313),[6314,6315),[6320,6390),[6400,6431),[6470,6510),[6512,6517),[6528,6572),[6576,6602),[6608,6619),[6656,6679),[6688,6741),[6784,6794),[6800,6810),[6823,6824),[6917,6964),[6981,6989),[6992,7002),[7043,7073),[7086,7142),[7168,7204),[7232,7242),[7245,7294),[7296,7305),[7312,7355),[7357,7360),[7401,7405),[7406,7412),[7413,7415),[7418,7419),[7424,7616),[7680,7958),[7960,7966),[7968,8006),[8008,8014),[8016,8024),[8025,8026),[8027,8028),[8029,8030),[8031,8062),[8064,8117),[8118,8125),[8126,8127),[8130,8133),[8134,8141),[8144,8148),[8150,8156),[8160,8173),[8178,8181),[8182,8189),[8304,8306),[8308,8314),[8319,8330),[8336,8349),[8450,8451),[8455,8456),[8458,8468),[8469,8470),[8473,8478),[8484,8485),[8486,8487),[8488,8489),[8490,8494),[8495,8506),[8508,8512),[8517,8522),[8526,8527),[8528,8586),[9312,9372),[9450,9472),[10102,10132),[11264,11493),[11499,11503),[11506,11508),[11517,11518),[11520,11558),[11559,11560),[11565,11566),[11568,11624),[11631,11632),[11648,11671),[11680,11687),[11688,11695),[11696,11703),[11704,11711),[11712,11719),[11720,11727),[11728,11735),[11736,11743),[11823,11824),[12293,12296),[12321,12330),[12337,12342),[12344,12349),[12353,12439),[12445,12448),[12449,12539),[12540,12544),[12549,12592),[12593,12687),[12690,12694),[12704,12736),[12784,12800),[12832,12842),[12872,12880),[12881,12896),[12928,12938),[12977,12992),[13312,19904),[19968,42125),[42192,42238),[42240,42509),[42512,42540),[42560,42607),[42623,42654),[42656,42736),[42775,42784),[42786,42889),[42891,42955),[42960,42962),[42963,42964),[42965,42970),[42994,43010),[43011,43014),[43015,43019),[43020,43043),[43056,43062),[43072,43124),[43138,43188),[43216,43226),[43250,43256),[43259,43260),[43261,43263),[43264,43302),[43312,43335),[43360,43389),[43396,43443),[43471,43482),[43488,43493),[43494,43519),[43520,43561),[43584,43587),[43588,43596),[43600,43610),[43616,43639),[43642,43643),[43646,43696),[43697,43698),[43701,43703),[43705,43710),[43712,43713),[43714,43715),[43739,43742),[43744,43755),[43762,43765),[43777,43783),[43785,43791),[43793,43799),[43808,43815),[43816,43823),[43824,43867),[43868,43882),[43888,44003),[44016,44026),[44032,55204),[55216,55239),[55243,55292),[63744,64110),[64112,64218),[64256,64263),[64275,64280),[64285,64286),[64287,64297),[64298,64311),[64312,64317),[64318,64319),[64320,64322),[64323,64325),[64326,64434),[64467,64830),[64848,64912),[64914,64968),[65008,65020),[65136,65141),[65142,65277),[65296,65306),[65313,65339),[65345,65371),[65382,65471),[65474,65480),[65482,65488),[65490,65496),[65498,65501),[65536,65548),[65549,65575),[65576,65595),[65596,65598),[65599,65614),[65616,65630),[65664,65787),[65799,65844),[65856,65913),[65930,65932),[66176,66205),[66208,66257),[66273,66300),[66304,66340),[66349,66379),[66384,66422),[66432,66462),[66464,66500),[66504,66512),[66513,66518),[66560,66718),[66720,66730),[66736,66772),[66776,66812),[66816,66856),[66864,66916),[66928,66939),[66940,66955),[66956,66963),[66964,66966),[66967,66978),[66979,66994),[66995,67002),[67003,67005),[67072,67383),[67392,67414),[67424,67432),[67456,67462),[67463,67505),[67506,67515),[67584,67590),[67592,67593),[67594,67638),[67639,67641),[67644,67645),[67647,67670),[67672,67703),[67705,67743),[67751,67760),[67808,67827),[67828,67830),[67835,67868),[67872,67898),[67968,68024),[68028,68048),[68050,68097),[68112,68116),[68117,68120),[68121,68150),[68160,68169),[68192,68223),[68224,68256),[68288,68296),[68297,68325),[68331,68336),[68352,68406),[68416,68438),[68440,68467),[68472,68498),[68521,68528),[68608,68681),[68736,68787),[68800,68851),[68858,68900),[68912,68922),[69216,69247),[69248,69290),[69296,69298),[69376,69416),[69424,69446),[69457,69461),[69488,69506),[69552,69580),[69600,69623),[69635,69688),[69714,69744),[69745,69747),[69749,69750),[69763,69808),[69840,69865),[69872,69882),[69891,69927),[69942,69952),[69956,69957),[69959,69960),[69968,70003),[70006,70007),[70019,70067),[70081,70085),[70096,70107),[70108,70109),[70113,70133),[70144,70162),[70163,70188),[70207,70209),[70272,70279),[70280,70281),[70282,70286),[70287,70302),[70303,70313),[70320,70367),[70384,70394),[70405,70413),[70415,70417),[70419,70441),[70442,70449),[70450,70452),[70453,70458),[70461,70462),[70480,70481),[70493,70498),[70656,70709),[70727,70731),[70736,70746),[70751,70754),[70784,70832),[70852,70854),[70855,70856),[70864,70874),[71040,71087),[71128,71132),[71168,71216),[71236,71237),[71248,71258),[71296,71339),[71352,71353),[71360,71370),[71424,71451),[71472,71484),[71488,71495),[71680,71724),[71840,71923),[71935,71943),[71945,71946),[71948,71956),[71957,71959),[71960,71984),[71999,72000),[72001,72002),[72016,72026),[72096,72104),[72106,72145),[72161,72162),[72163,72164),[72192,72193),[72203,72243),[72250,72251),[72272,72273),[72284,72330),[72349,72350),[72368,72441),[72704,72713),[72714,72751),[72768,72769),[72784,72813),[72818,72848),[72960,72967),[72968,72970),[72971,73009),[73030,73031),[73040,73050),[73056,73062),[73063,73065),[73066,73098),[73112,73113),[73120,73130),[73440,73459),[73474,73475),[73476,73489),[73490,73524),[73552,73562),[73648,73649),[73664,73685),[73728,74650),[74752,74863),[74880,75076),[77712,77809),[77824,78896),[78913,78919),[82944,83527),[92160,92729),[92736,92767),[92768,92778),[92784,92863),[92864,92874),[92880,92910),[92928,92976),[92992,92996),[93008,93018),[93019,93026),[93027,93048),[93053,93072),[93760,93847),[93952,94027),[94032,94033),[94099,94112),[94176,94178),[94179,94180),[94208,100344),[100352,101590),[101632,101641),[110576,110580),[110581,110588),[110589,110591),[110592,110883),[110898,110899),[110928,110931),[110933,110934),[110948,110952),[110960,111356),[113664,113771),[113776,113789),[113792,113801),[113808,113818),[119488,119508),[119520,119540),[119648,119673),[119808,119893),[119894,119965),[119966,119968),[119970,119971),[119973,119975),[119977,119981),[119982,119994),[119995,119996),[119997,120004),[120005,120070),[120071,120075),[120077,120085),[120086,120093),[120094,120122),[120123,120127),[120128,120133),[120134,120135),[120138,120145),[120146,120486),[120488,120513),[120514,120539),[120540,120571),[120572,120597),[120598,120629),[120630,120655),[120656,120687),[120688,120713),[120714,120745),[120746,120771),[120772,120780),[120782,120832),[122624,122655),[122661,122667),[122928,122990),[123136,123181),[123191,123198),[123200,123210),[123214,123215),[123536,123566),[123584,123628),[123632,123642),[124112,124140),[124144,124154),[124896,124903),[124904,124908),[124909,124911),[124912,124927),[124928,125125),[125127,125136),[125184,125252),[125259,125260),[125264,125274),[126065,126124),[126125,126128),[126129,126133),[126209,126254),[126255,126270),[126464,126468),[126469,126496),[126497,126499),[126500,126501),[126503,126504),[126505,126515),[126516,126520),[126521,126522),[126523,126524),[126530,126531),[126535,126536),[126537,126538),[126539,126540),[126541,126544),[126545,126547),[126548,126549),[126551,126552),[126553,126554),[126555,126556),[126557,126558),[126559,126560),[126561,126563),[126564,126565),[126567,126571),[126572,126579),[126580,126584),[126585,126589),[126590,126591),[126592,126602),[126603,126620),[126625,126628),[126629,126634),[126635,126652),[127232,127245),[130032,130042),[131072,173792),[173824,177978),[177984,178206),[178208,183970),[183984,191457),[194560,195102),[196608,201547),[201552,205744)} '::int4multirange
    );
$$;

-- The built-in PostgreSQL SHA256 needs no extension. Fixed length digests
-- bind order and exact UTF-8 text, without making timing a grading input.
CREATE OR REPLACE FUNCTION public.fn_dictation_reference_sha256(p_units JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE item JSONB; joined TEXT := 'dictation-texts-v1' || chr(10);
BEGIN
    IF jsonb_typeof(p_units) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'dictation_reference_unavailable' USING ERRCODE = '55000';
    END IF;
    IF jsonb_array_length(p_units) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'dictation_reference_unavailable' USING ERRCODE = '55000';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_units) LOOP
        IF jsonb_typeof(item) IS DISTINCT FROM 'object'
           OR jsonb_typeof(item->'text') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'dictation_reference_unavailable' USING ERRCODE = '55000';
        END IF;
        joined := joined || encode(sha256(convert_to(item->>'text', 'UTF8')), 'hex');
    END LOOP;
    RETURN encode(sha256(convert_to(joined, 'UTF8')), 'hex');
END;
$$;

DO $$
DECLARE target TEXT;
BEGIN
    FOREACH target IN ARRAY ARRAY['dictation_attempts', 'dictation_attempt_answers', 'dictation_sessions'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conrelid = ('public.' || target)::regclass
                         AND conname = target || '_grading_policy_pair') THEN
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (COALESCE(
                (grading_version IS NULL AND reference_sha256 IS NULL)
                OR (grading_version = ''legacy-whitespace-v1'' AND
                    (reference_sha256 IS NULL OR reference_sha256 ~ ''^[0-9a-f]{64}$''))
                OR (grading_version = ''lexical-v2'' AND reference_sha256 ~ ''^[0-9a-f]{64}$''), FALSE))',
                target, target || '_grading_policy_pair');
        END IF;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_guard_dictation_frozen_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (
        NEW.grading_version IS DISTINCT FROM OLD.grading_version
        OR NEW.reference_sha256 IS DISTINCT FROM OLD.reference_sha256
        OR NEW.units_snapshot IS DISTINCT FROM OLD.units_snapshot
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.test_id IS DISTINCT FROM OLD.test_id
        OR NEW.section_num IS DISTINCT FROM OLD.section_num) THEN
        RAISE EXCEPTION 'dictation_frozen_policy_immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW.reference_sha256 IS NOT NULL
       AND NEW.reference_sha256 IS DISTINCT FROM public.fn_dictation_reference_sha256(NEW.units_snapshot) THEN
        RAISE EXCEPTION 'dictation_reference_mismatch' USING ERRCODE = '55000';
    END IF;
    IF NEW.grading_version = 'lexical-v2' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.units_snapshot) item
        WHERE NOT COALESCE(public.fn_dictation_has_lexical_words(item->>'text'), FALSE)) THEN
        RAISE EXCEPTION 'dictation_reference_without_words' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_dictation_frozen_policy ON public.dictation_attempts;
CREATE TRIGGER trg_guard_dictation_frozen_policy
    BEFORE INSERT OR UPDATE ON public.dictation_attempts
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_dictation_frozen_policy();

-- Validate exhaustive raw segments at the actual write boundary. Positions
-- use Unicode code points (PostgreSQL char_length), never UTF-16 code units.
CREATE OR REPLACE FUNCTION public.fn_dictation_segments_valid(p_raw TEXT, p_segments JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE segment JSONB; cursor_pos INTEGER := 0; end_pos INTEGER;
BEGIN
    IF p_raw IS NULL OR jsonb_typeof(p_segments) IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
    FOR segment IN SELECT value FROM jsonb_array_elements(p_segments) LOOP
        IF jsonb_typeof(segment) IS DISTINCT FROM 'object'
           OR jsonb_typeof(segment->'raw') IS DISTINCT FROM 'string'
           OR NOT COALESCE(segment->>'kind' IN ('lexical', 'unscored', 'whitespace'), FALSE)
           OR jsonb_typeof(segment->'start') IS DISTINCT FROM 'number'
           OR jsonb_typeof(segment->'end') IS DISTINCT FROM 'number'
           OR NOT COALESCE(segment->>'start' ~ '^[0-9]+$', FALSE)
           OR NOT COALESCE(segment->>'end' ~ '^[0-9]+$', FALSE) THEN RETURN FALSE; END IF;
        end_pos := (segment->>'end')::integer;
        IF (segment->>'start')::integer <> cursor_pos OR end_pos <= cursor_pos
           OR end_pos > char_length(p_raw)
           OR segment->>'raw' IS DISTINCT FROM substring(p_raw FROM cursor_pos + 1 FOR end_pos - cursor_pos) THEN
            RETURN FALSE;
        END IF;
        cursor_pos := end_pos;
    END LOOP;
    RETURN cursor_pos = char_length(p_raw);
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_guard_dictation_answer_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE parent public.dictation_attempts%ROWTYPE; reference_text TEXT; proof JSONB;
BEGIN
    -- Check the original identity before selecting NEW's parent: transferring a
    -- completed answer would otherwise validate only the new active attempt.
    IF TG_OP = 'UPDATE' AND (NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
                            OR NEW.sentence_idx IS DISTINCT FROM OLD.sentence_idx) THEN
        RAISE EXCEPTION 'dictation_answer_identity_immutable' USING ERRCODE = '55000';
    END IF;
    SELECT * INTO parent FROM public.dictation_attempts WHERE id = NEW.attempt_id FOR UPDATE;
    -- Existing migration224 owns status/expiry rejection; this owns policy.
    IF NOT FOUND THEN RAISE EXCEPTION 'dictation_attempt_not_found' USING ERRCODE = '23503'; END IF;
    IF parent.grading_version IS DISTINCT FROM 'lexical-v2' THEN
        IF NEW.grading_version IS NOT NULL
           AND NEW.grading_version IS DISTINCT FROM 'legacy-whitespace-v1' THEN
            RAISE EXCEPTION 'dictation_policy_conflict' USING ERRCODE = '55000';
        END IF;
        IF NEW.reference_sha256 IS NOT NULL AND NEW.reference_sha256 IS DISTINCT FROM parent.reference_sha256 THEN
            RAISE EXCEPTION 'dictation_reference_mismatch' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    END IF;
    reference_text := parent.units_snapshot->NEW.sentence_idx->>'text';
    proof := NEW.grading_evidence;
    IF NEW.grading_version IS DISTINCT FROM parent.grading_version
       OR NEW.reference_sha256 IS DISTINCT FROM parent.reference_sha256
       OR reference_text IS NULL
       OR NEW.sentence_reference_sha256 IS DISTINCT FROM encode(sha256(convert_to(reference_text, 'UTF8')), 'hex')
       OR jsonb_typeof(proof) IS DISTINCT FROM 'object'
       OR proof->>'grading_version' IS DISTINCT FROM parent.grading_version
       OR proof->>'reference_sha256' IS DISTINCT FROM parent.reference_sha256
       OR proof->>'sentence_reference_sha256' IS DISTINCT FROM NEW.sentence_reference_sha256
       OR proof->>'reference' IS DISTINCT FROM reference_text
       OR proof->>'user_text' IS DISTINCT FROM NEW.user_transcript
       OR proof->>'offset_unit' IS DISTINCT FROM 'unicode_codepoint'
       OR proof->'diff' IS DISTINCT FROM NEW.diff
       OR (proof->>'score')::numeric IS DISTINCT FROM NEW.score
       OR (proof->>'correct_words')::integer IS DISTINCT FROM NEW.correct_words
       OR (proof->>'total_words')::integer IS DISTINCT FROM NEW.total_words
       OR NOT public.fn_dictation_segments_valid(reference_text, proof->'reference_segments')
       OR NOT public.fn_dictation_segments_valid(NEW.user_transcript, proof->'user_segments') THEN
        RAISE EXCEPTION 'dictation_policy_evidence_mismatch' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_01_guard_dictation_answer_policy ON public.dictation_attempt_answers;
CREATE TRIGGER trg_01_guard_dictation_answer_policy
    BEFORE INSERT OR UPDATE ON public.dictation_attempt_answers
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_dictation_answer_policy();

CREATE OR REPLACE FUNCTION public.fn_guard_dictation_report_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE parent public.dictation_attempts%ROWTYPE; item JSONB; answer public.dictation_attempt_answers%ROWTYPE;
        answer_count INTEGER; word_count INTEGER; matched_count INTEGER;
        full_count INTEGER; mean_score NUMERIC;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- A finalized report is a receipt, including ownership, source identity,
        -- timing and retry identity. Only canonical FK erasure may detach it.
        IF (to_jsonb(NEW) - 'test_id' - 'attempt_id') IS DISTINCT FROM
           (to_jsonb(OLD) - 'test_id' - 'attempt_id') THEN
            RAISE EXCEPTION 'dictation_report_evidence_immutable' USING ERRCODE = '55000';
        END IF;
        IF NEW.test_id IS DISTINCT FROM OLD.test_id AND NOT (
            OLD.test_id IS NOT NULL AND NEW.test_id IS NULL AND NOT EXISTS (
                SELECT 1 FROM public.listening_tests WHERE id = OLD.test_id)) THEN
            RAISE EXCEPTION 'dictation_report_identity_immutable' USING ERRCODE = '55000';
        END IF;
        IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id AND NOT (
            OLD.attempt_id IS NOT NULL AND NEW.attempt_id IS NULL AND NOT EXISTS (
                SELECT 1 FROM public.dictation_attempts WHERE id = OLD.attempt_id)) THEN
            RAISE EXCEPTION 'dictation_report_identity_immutable' USING ERRCODE = '55000';
        END IF;
        -- The deleted canonical parent is absent inside its FK action; a direct
        -- NULL/reassignment with a live parent is rejected. Existing user
        -- deletion still cascades and frozen evidence survives test erasure.
        RETURN NEW;
    END IF;
    IF NEW.attempt_id IS NULL THEN
        IF NEW.grading_version = 'lexical-v2' THEN
            RAISE EXCEPTION 'dictation_versioned_attempt_required' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO parent FROM public.dictation_attempts WHERE id = NEW.attempt_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'dictation_attempt_not_found' USING ERRCODE = '23503'; END IF;
    IF parent.grading_version IS DISTINCT FROM 'lexical-v2' THEN
        IF NEW.grading_version IS NOT NULL AND NEW.grading_version IS DISTINCT FROM 'legacy-whitespace-v1' THEN
            RAISE EXCEPTION 'dictation_policy_conflict' USING ERRCODE = '55000';
        END IF;
        IF NEW.reference_sha256 IS NOT NULL AND NEW.reference_sha256 IS DISTINCT FROM parent.reference_sha256 THEN
            RAISE EXCEPTION 'dictation_reference_mismatch' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.grading_version IS DISTINCT FROM parent.grading_version
       OR NEW.reference_sha256 IS DISTINCT FROM parent.reference_sha256
       OR jsonb_typeof(NEW.results) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'dictation_policy_evidence_mismatch' USING ERRCODE = '55000';
    END IF;
    IF jsonb_array_length(NEW.results) <> jsonb_array_length(parent.units_snapshot) THEN
        RAISE EXCEPTION 'dictation_policy_evidence_mismatch' USING ERRCODE = '55000';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(NEW.results) LOOP
        SELECT * INTO answer FROM public.dictation_attempt_answers
          WHERE attempt_id = NEW.attempt_id AND sentence_idx = (item->>'sentence_idx')::integer;
        IF NOT FOUND OR answer.grading_version IS DISTINCT FROM parent.grading_version
           OR answer.reference_sha256 IS DISTINCT FROM parent.reference_sha256
           OR item->>'grading_version' IS DISTINCT FROM answer.grading_version
           OR item->>'reference_sha256' IS DISTINCT FROM answer.reference_sha256
           OR item->>'sentence_reference_sha256' IS DISTINCT FROM answer.sentence_reference_sha256
           OR item->'grading_evidence' IS DISTINCT FROM answer.grading_evidence
           OR item->>'reference' IS DISTINCT FROM answer.grading_evidence->>'reference' THEN
            RAISE EXCEPTION 'dictation_policy_evidence_mismatch' USING ERRCODE = '55000';
        END IF;
    END LOOP;
    SELECT count(*), COALESCE(sum(total_words),0), COALESCE(sum(correct_words),0),
           count(*) FILTER (WHERE score >= 1), avg(score)
      INTO answer_count, word_count, matched_count, full_count, mean_score
      FROM public.dictation_attempt_answers WHERE attempt_id = NEW.attempt_id;
    IF NEW.total_sentences IS DISTINCT FROM answer_count
       OR NEW.total_words IS DISTINCT FROM word_count
       OR NEW.correct_words IS DISTINCT FROM matched_count
       OR NEW.correct_count IS DISTINCT FROM full_count
       -- The deployed aggregate rounds Python IEEE-754 means to four digits.
       -- PostgreSQL numeric round uses a different tie rule (e.g. .3333/2).
       -- Check the nearest four-digit rounding interval, preserving the exact
       -- existing server value instead of changing its aggregation policy.
       OR mean_score IS NULL OR abs(NEW.accuracy - mean_score) > .00005 THEN
        RAISE EXCEPTION 'dictation_policy_aggregate_mismatch' USING ERRCODE = '55000';
    END IF;
    -- Migration220 still checks unique indexes, ownership and every saved
    -- score/diff/counter before atomically closing the parent in this INSERT.
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_01_guard_dictation_report_policy ON public.dictation_sessions;
CREATE TRIGGER trg_01_guard_dictation_report_policy
    BEFORE INSERT OR UPDATE ON public.dictation_sessions
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_dictation_report_policy();

REVOKE ALL ON FUNCTION public.fn_dictation_has_lexical_words(TEXT),
    public.fn_dictation_reference_sha256(JSONB),
    public.fn_dictation_segments_valid(TEXT,JSONB),
    public.fn_guard_dictation_frozen_policy(), public.fn_guard_dictation_answer_policy(),
    public.fn_guard_dictation_report_policy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dictation_has_lexical_words(TEXT),
    public.fn_dictation_reference_sha256(JSONB),
    public.fn_dictation_segments_valid(TEXT,JSONB) TO service_role;

COMMENT ON COLUMN public.dictation_attempts.grading_version IS
    'Frozen explicit policy. NULL is legacy-whitespace-v1; lexical-v2 requires a compatible acknowledged consumer.';
COMMENT ON COLUMN public.dictation_attempt_answers.grading_evidence IS
    'Exact v2 raw reference/user segments, Unicode-codepoint spans and server grade bound to the frozen attempt.';
NOTIFY pgrst, 'reload schema';
COMMIT;
