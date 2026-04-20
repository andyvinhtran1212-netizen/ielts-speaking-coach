# IELTS Speaking Coach — Production Smoke Test Checklist

Use this checklist after each production deploy.

---

## Deploy info
- Date:
- Commit:
- Environment:
- Tester:

---

## A. Auth / account

### 1. Login
- [ ] Open login page
- [ ] Log in with a test account

**Pass when**
- Login succeeds
- App loads normally
- User is not redirected back to login unexpectedly

### 2. Profile save
- [ ] Open profile page
- [ ] Change one simple field
- [ ] Save
- [ ] Reload page

**Pass when**
- Save succeeds
- Updated value persists after reload

---

## B. Practice mode

### 3. Create practice session
- [ ] Start a new practice session

**Pass when**
- Session is created successfully
- Practice page opens correctly
- No route/query-param error occurs

### 4. Submit one response
- [ ] Record or submit one test response
- [ ] Wait for grading

**Pass when**
- Transcript appears
- Feedback appears
- Overall band appears
- No infinite loading or blank page

### 5. Complete practice session
- [ ] Complete the session
- [ ] Open result page
- [ ] Reload result page

**Pass when**
- Result page loads
- Session data is present
- Overall band is visible
- Reload does not lose data

---

## C. Pronunciation

### 6. Run pronunciation for practice
- [ ] Run pronunciation assessment after grading

**Pass when**
- Pronunciation finishes successfully
- Updated pronunciation-related score/feedback appears
- Reloaded result/dashboard stays consistent

---

## D. Dashboard / history

### 7. Dashboard stats and history
- [ ] Open dashboard after finishing a session

**Pass when**
- Latest session appears
- Stats are present
- No obvious null/blank state bug
- Grammar block loads normally

### 8. Continue / retry CTA
- [ ] Click “Luyện tiếp ngay” if available
- [ ] Click “retry same topic” if available

**Pass when**
- Navigation succeeds
- Correct session is created or resumed
- No API/route mismatch occurs

---

## E. Full test

### 9. Create full test
- [ ] Start a new full test

**Pass when**
- Full test initializes normally
- Part 1 / Part 2 / Part 3 flow is created successfully

### 10. Finalize full test
- [ ] Finish a full test
- [ ] Wait for finalization
- [ ] Reload the full-test result page

**Pass when**
- Session does not get stuck in a bad state
- Result page loads with real data
- Reload preserves correct data

### 11. Full-test pronunciation
- [ ] Run full pronunciation flow if enabled
- [ ] Hard refresh result page

**Pass when**
- Flow completes successfully
- Reloaded result still matches persisted session truth

### 12. PDF export
- [ ] Click PDF export on the full-test result page

**Pass when**
- Export works
- No 404 / bad route / blank file issue occurs

---

## F. Admin

### 13. Open admin session detail
- [ ] Open admin page
- [ ] Open one real session detail

**Pass when**
- Session detail loads
- Responses are listed correctly

### 14. Regrade one response
- [ ] Trigger response regrade for one response

**Pass when**
- No 500 / CORS / fetch failure
- Regrade completes
- Session summary updates correctly if expected

### 15. Regrade or rebuild one session
- [ ] Trigger admin session regrade or rebuild summary

**Pass when**
- No mixed-state bug is obvious
- Session status and aggregate fields remain coherent
- No false “completed” state appears after a failed repair

---

## G. Grammar Wiki

### 16. Public article access
- [ ] Log out
- [ ] Open one grammar article directly

**Pass when**
- Article opens normally
- No forced redirect to login

### 17. Grammar landing and dashboard links
- [ ] Click “Grammar Wiki” from landing page
- [ ] Click “Xem tất cả” from dashboard grammar section
- [ ] Click one grammar article from dashboard

**Pass when**
- No 404 occurs
- Correct page opens
- Article route works with valid category + slug

### 18. Search / compare / roadmap
- [ ] Open grammar search page
- [ ] Open grammar compare page
- [ ] Open grammar roadmap page if available

**Pass when**
- Pages load
- No obvious dead links or route errors appear

---

# Quick go / no-go checklist

Use this shorter version when you need a fast post-deploy check.

- [ ] Login
- [ ] Create one practice session
- [ ] Submit one graded response
- [ ] Open and reload result page
- [ ] Run pronunciation
- [ ] Open dashboard/history
- [ ] Finalize one full test
- [ ] Run one admin regrade
- [ ] Open Grammar Wiki from landing page
- [ ] Open one public grammar article

---

# Notes
- 
- 
- 

---

# Final deploy verdict
- [ ] PASS
- [ ] FAIL

If FAIL, record:
- Broken flow:
- Error observed:
- Suspected route/file:
- Commit / deployment:
