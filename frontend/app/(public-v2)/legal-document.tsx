import { PLACEHOLDER, type LegalDocument as LegalDoc } from './legal-content';
import { LegalPage } from './legal-page';
import { LegalToc } from './legal-toc';
import styles from './legal.module.css';

/**
 * Long-document template shared by Điều khoản and Quyền riêng tư
 * (PhapLy.dc.html §1, §4): a 640px text column, the table of contents built
 * from the article headings, articles anchored as #dieu-N.
 */
export function LegalDocument({ doc }: { doc: LegalDoc }) {
  const toc = doc.articles.map((article, i) => ({ id: `dieu-${i + 1}`, n: i + 1, title: article.title }));
  return (
    <LegalPage
      title={doc.title}
      meta={<>Có hiệu lực từ <strong>{PLACEHOLDER}</strong> · Cập nhật lần cuối <strong>{PLACEHOLDER}</strong></>}
    >
      <div className={styles.doc}>
        <LegalToc items={toc} />
        <div className={styles.body}>
          {doc.articles.map((article, i) => (
            <section key={article.title} id={`dieu-${i + 1}`} className={styles.article} aria-labelledby={`dieu-${i + 1}-title`}>
              <h2 id={`dieu-${i + 1}-title`}>{i + 1}. {article.title}</h2>
              <p className={styles.about}>{article.about}</p>
              <ol className={styles.clauses}>
                {article.clauses.map((clause) => (
                  <li key={clause.n} className={styles.clause}>
                    <span className={styles.clauseN}>{clause.n}</span>
                    <p><strong>{clause.title}.</strong> {clause.body ?? PLACEHOLDER}</p>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </LegalPage>
  );
}
