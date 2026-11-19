import { PLACEHOLDER, type LegalDocument as LegalDoc } from './legal-content';
import { LegalShell } from './legal-shell';
import { LegalTocSpy } from './legal-toc-spy';

/** Mẫu trang văn bản dài dùng chung cho Điều khoản và Quyền riêng tư. */
export function LegalDocument({ doc }: { doc: LegalDoc }) {
  const toc = doc.articles.map((article, i) => ({ id: `dieu-${i + 1}`, n: i + 1, title: article.title }));
  const tocList = (
    <ol className="lg-toc__list">
      {toc.map((item) => (
        <li key={item.id}>
          <a href={`#${item.id}`} data-toc-target={item.id}>
            <span className="lg-toc__n">{item.n}</span> {item.title}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <LegalShell title={doc.title}>
      <h1 className="lg-h1">{doc.title}</h1>
      <p className="lg-meta">Có hiệu lực từ {PLACEHOLDER} · Cập nhật lần cuối {PLACEHOLDER}</p>

      <div className="lg-doc">
        <aside className="lg-toc" aria-label="Mục lục">
          <details className="lg-toc__mobile">
            <summary>Mục lục</summary>
            {tocList}
          </details>
          <div className="lg-toc__desktop">
            <p className="lg-toc__heading">Mục lục</p>
            {tocList}
          </div>
        </aside>

        <div className="lg-body">
          {doc.articles.map((article, i) => (
            <section key={article.title} id={`dieu-${i + 1}`} className="lg-article" aria-labelledby={`dieu-${i + 1}-title`}>
              <h2 id={`dieu-${i + 1}-title`}>{i + 1}. {article.title}</h2>
              <p className="lg-about">{article.about}</p>
              {article.clauses.map((clause) => (
                <p key={clause.n} className="lg-clause">
                  <span className="lg-clause__n">{clause.n}</span>{' '}
                  <strong>{clause.title}.</strong> {clause.body ?? PLACEHOLDER}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
      <LegalTocSpy />
    </LegalShell>
  );
}
