// PUBLICSITE-0059 FR-026 (G05-T23): shape of GET /api/public/site-info as the
// pages use it. Pure, so the server reader and the tests share one rule.
//
// A field the backend did not send, sent blank, or sent as a placeholder
// ("0900 XXX XXX") is null: the contact block hides that line rather than
// printing a value nobody can use. Flags are true only for a literal `true`.

/**
 * @typedef {{ email: string | null, phone: string | null, zalo: string | null, reply_hours: string | null }} SiteContact
 * @typedef {{ office_hours: string | null, confirm_sla: string | null, escalate_after: string | null }} SiteEnroll
 * @typedef {{ contact: SiteContact, enroll: SiteEnroll, login_code_enabled: boolean, enroll_prelearn_chapter1: boolean }} SiteInfo
 */

const PLACEHOLDER = /XXX/;

/** @param {unknown} value @returns {string | null} */
export function siteText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && !PLACEHOLDER.test(text) ? text : null;
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value) : {};
}

/** Every field null/false: what a page shows when the read fails. @returns {SiteInfo} */
export function emptySiteInfo() {
  return normalizeSiteInfo(null);
}

/** @param {unknown} raw @returns {SiteInfo} */
export function normalizeSiteInfo(raw) {
  const body = record(raw);
  const contact = record(body.contact);
  const enroll = record(body.enroll);
  return {
    contact: {
      email: siteText(contact.email),
      phone: siteText(contact.phone),
      zalo: siteText(contact.zalo),
      reply_hours: siteText(contact.reply_hours),
    },
    enroll: {
      office_hours: siteText(enroll.office_hours),
      confirm_sla: siteText(enroll.confirm_sla),
      escalate_after: siteText(enroll.escalate_after),
    },
    login_code_enabled: body.login_code_enabled === true,
    enroll_prelearn_chapter1: body.enroll_prelearn_chapter1 === true,
  };
}

/**
 * @typedef {{ key: 'email' | 'phone' | 'zalo' | 'reply_hours', label: string, value: string, href: string | null }} ContactRow
 */

/**
 * The visible rows of the contact block, always in the order
 * Email · Điện thoại · Zalo · Giờ trả lời, without the empty ones.
 * @param {Partial<SiteContact> | null | undefined} contact
 * @returns {ContactRow[]}
 */
export function contactRows(contact) {
  const c = contact ?? {};
  const email = siteText(c.email);
  const phone = siteText(c.phone);
  const dial = phone ? phone.replace(/[^\d+]/g, '') : '';
  const zalo = siteText(c.zalo);
  const hours = siteText(c.reply_hours);
  /** @type {ContactRow[]} */
  const rows = [];
  if (email) rows.push({ key: 'email', label: 'Email', value: email, href: `mailto:${email}` });
  if (phone) rows.push({ key: 'phone', label: 'Điện thoại', value: phone, href: dial ? `tel:${dial}` : null });
  // Only an https link opens Zalo; a bare number or name is shown as text.
  if (zalo) rows.push({ key: 'zalo', label: 'Zalo', value: zalo, href: /^https:\/\//.test(zalo) ? zalo : null });
  if (hours) rows.push({ key: 'reply_hours', label: 'Giờ trả lời', value: hours, href: null });
  return rows;
}
