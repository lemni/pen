import { useEffect, useMemo, useState } from "react";
import {
	defaultPageId,
	sitePages,
	siteSections,
	type SitePage,
} from "./content/siteContent";

const pageIds = new Set(sitePages.map((page) => page.id));
const docsUtilityLinks = [
	{
		href: "https://github.com/lemni/pen",
		label: "GitHub",
	},
	{
		href: "https://github.com/lemni/pen/blob/main/README.md",
		label: "README",
	},
	{
		href: "https://github.com/lemni/pen/tree/main/spec",
		label: "Specs",
	},
] as const;
const docsTopNavItems = ["Docs", "Examples", "Guides"] as const;

function resolvePageId(hash: string): string {
	const normalizedHash = hash.startsWith("#") ? hash.slice(1) : hash;
	return pageIds.has(normalizedHash) ? normalizedHash : defaultPageId;
}

export function App() {
	const [currentPageId, setCurrentPageId] = useState(() =>
		resolvePageId(window.location.hash),
	);
	const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

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
				</button>
			);
		});

		return (
			<section key={group.section.id} className="docs-nav-group">
				<h2>{group.section.title}</h2>
				<div className="docs-nav-links">{pageButtons}</div>
			</section>
		);
	});

	const topbarLink = docsUtilityLinks[0];
	const topbarSecondaryLinks = docsUtilityLinks.slice(1).map((link) => {
		return (
			<a
				key={link.href}
				className="docs-topbar-text-link"
				href={link.href}
				target="_blank"
				rel="noreferrer"
			>
				{link.label}
			</a>
		);
	});
	const railLinkItems = docsUtilityLinks.slice(1).map((link) => {
		return (
			<a
				key={link.href}
				className="docs-rail-utility-link"
				href={link.href}
				target="_blank"
				rel="noreferrer"
			>
				{link.label}
			</a>
		);
	});

	const currentSectionPages =
		pageGroups.find((group) => group.section.id === currentPage.sectionId)?.pages ?? [];

	const handleCopyPage = async () => {
		try {
			await navigator.clipboard.writeText(window.location.href);
			setCopyState("copied");
			window.setTimeout(() => {
				setCopyState("idle");
			}, 1200);
		} catch {
			setCopyState("idle");
		}
	};

	const topNavItems = docsTopNavItems.map((item) => {
		const isActive = item === "Docs";

		return (
			<button
				key={item}
				type="button"
				className={isActive ? "docs-top-nav-item is-active" : "docs-top-nav-item"}
			>
				{item}
			</button>
		);
	});

	const sectionRailItems = currentSectionPages.map((page) => {
		const isActive = page.id === currentPage.id;

		return (
			<button
				key={page.id}
				type="button"
				className={isActive ? "docs-rail-link is-active" : "docs-rail-link"}
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
					<div className="docs-sidebar-brand">
						<span className="docs-sidebar-brand-mark" />
						<span className="docs-sidebar-brand-name">Pen</span>
					</div>
				</div>
				<nav aria-label="Documentation navigation">{navGroups}</nav>
			</aside>
			<main className="docs-main">
				<div className="docs-topbar">
					<div className="docs-top-nav">{topNavItems}</div>
					<div className="docs-topbar-actions">
						{topbarSecondaryLinks}
						<a
							className="docs-topbar-action"
							href={topbarLink.href}
							target="_blank"
							rel="noreferrer"
						>
							{topbarLink.label}
						</a>
					</div>
				</div>
				<div className="docs-main-grid">
					<section className="docs-content-column">
						<header className="docs-main-header">
							<div className="docs-hero-meta">
								<span className="docs-hero-badge">
									{currentSection?.title ?? "Documentation"}
								</span>
								<button type="button" className="docs-copy-button" onClick={handleCopyPage}>
									{copyState === "copied" ? "Copied" : "Copy page"}
								</button>
							</div>
							<h1>{currentPage.title}</h1>
							<p>{currentPage.summary}</p>
						</header>
						{article}
					</section>
					<aside className="docs-rail">
						<div className="docs-rail-panel">
							<span className="docs-rail-label">On this page</span>
							<div className="docs-rail-links">{sectionRailItems}</div>
							<div className="docs-rail-divider" />
							<span className="docs-rail-card-label">Resources</span>
							<div className="docs-rail-card-links">{railLinkItems}</div>
						</div>
					</aside>
				</div>
			</main>
		</div>
	);
}

function renderArticle(page: SitePage, sectionTitle: string) {
	return (
		<article className="docs-article">
			<div className="docs-article-meta">
				<span>{sectionTitle}</span>
			</div>
			<div className="docs-article-body">{page.content}</div>
		</article>
	);
}
