import { useEffect, useMemo, useState } from "react";
import {
  defaultPageId,
  sitePages,
  siteSections,
  type SitePage,
} from "./content/siteContent";

const pageIds = new Set(sitePages.map((page) => page.id));

function resolvePageId(hash: string): string {
  const normalizedHash = hash.startsWith("#") ? hash.slice(1) : hash;
  return pageIds.has(normalizedHash) ? normalizedHash : defaultPageId;
}

export function App() {
  const [currentPageId, setCurrentPageId] = useState(() =>
    resolvePageId(window.location.hash),
  );

  const currentPage = useMemo(() => {
    return (
      sitePages.find((page) => page.id === currentPageId) ??
      sitePages.find((page) => page.id === defaultPageId) ??
      sitePages[0]
    );
  }, [currentPageId]);

  const currentSection = useMemo(() => {
    return siteSections.find((section) => section.id === currentPage.sectionId);
  }, [currentPage.sectionId]);

  const pageGroups = useMemo(() => {
    return siteSections.map((section) => {
      return {
        section,
        pages: sitePages.filter((page) => page.sectionId === section.id),
      };
    });
  }, []);

  const handlePageSelect = (pageId: string) => {
    if (window.location.hash !== `#${pageId}`) {
      window.location.hash = pageId;
    }
    setCurrentPageId(pageId);
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };

  useEffect(() => {
    const nextPageId = resolvePageId(window.location.hash);
    if (window.location.hash !== `#${nextPageId}`) {
      window.history.replaceState(null, "", `#${nextPageId}`);
    }
    setCurrentPageId(nextPageId);

    const handleHashChange = () => {
      setCurrentPageId(resolvePageId(window.location.hash));
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  const navGroups = pageGroups.map((group) => {
    const pageButtons = group.pages.map((page) => {
      const isActive = page.id === currentPage.id;

      return (
        <button
          key={page.id}
          type="button"
          className={isActive ? "docs-nav-link is-active" : "docs-nav-link"}
          onClick={() => handlePageSelect(page.id)}
        >
          <span className="docs-nav-link-title">{page.title}</span>
          <span className="docs-nav-link-summary">{page.summary}</span>
        </button>
      );
    });

    return (
      <section key={group.section.id} className="docs-nav-group">
        <h2>{group.section.title}</h2>
        <p>{group.section.description}</p>
        <div className="docs-nav-links">{pageButtons}</div>
      </section>
    );
  });

  const pagePills = pageGroups
    .find((group) => group.section.id === currentPage.sectionId)
    ?.pages.map((page) => {
      const isActive = page.id === currentPage.id;

      return (
        <button
          key={page.id}
          type="button"
          className={isActive ? "docs-page-pill is-active" : "docs-page-pill"}
          onClick={() => handlePageSelect(page.id)}
        >
          {page.title}
        </button>
      );
    });

  const article = renderArticle(currentPage, currentSection?.title ?? "Docs");

  return (
    <div className="docs-shell">
      <aside className="docs-sidebar">
        <div className="docs-sidebar-header">
          <span className="docs-eyebrow">Current Surface</span>
          <h1>Pen Docs</h1>
          <p>
            Reference docs for the shipped Pen surface area: React-first adoption, the
            Vue renderer, canonical JSON, XML interoperability, and shipped extensions.
          </p>
        </div>
        <nav aria-label="Documentation navigation">{navGroups}</nav>
      </aside>
      <main className="docs-main">
        <header className="docs-main-header">
          <div>
            <span className="docs-section-label">
              {currentSection?.title ?? "Documentation"}
            </span>
            <h1>{currentPage.title}</h1>
            <p>{currentPage.summary}</p>
          </div>
          <div className="docs-status-card">
            <strong>Scope guard</strong>
            <span>
              This site documents shipped editor surfaces only. Deferred areas such as
              layout, apps, execution, and auth platform features stay out of scope.
            </span>
          </div>
        </header>
        <div className="docs-page-pills" aria-label="Section pages">
          {pagePills}
        </div>
        {article}
      </main>
    </div>
  );
}

function renderArticle(page: SitePage, sectionTitle: string) {
  return (
    <article className="docs-article">
      <div className="docs-article-meta">
        <span>{sectionTitle}</span>
        <span>{page.id}</span>
      </div>
      <div className="docs-article-body">{page.content}</div>
    </article>
  );
}
